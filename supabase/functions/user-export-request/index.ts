// DATA-005 Phase 1 — user-export-request edge function.
//
// Records a self-service subject-access export request. Phase 1 only
// captures the request, resolves which categories are allowed, applies
// rate-limit + legal-hold guards, and writes canonical audit rows.
//
// Phase 1 NEVER:
//   • generates a payload file
//   • returns user data
//   • produces a signed URL
//   • emits data.user_export_generated / _downloaded / _file_destroyed
//
// Phase 2 (DATA-005-FU-EXPORT-LIFECYCLE-001) will share a signed-URL
// TTL/file-destruction module with DATA-010-FU-EXPORT-LIFECYCLE-001.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";
import { ApiException } from "../_shared/errors.ts";
import {
  ALLOWED_USER_EXPORT_CATEGORIES,
  FORBIDDEN_USER_EXPORT_CATEGORIES,
  resolveExportScope,
} from "../_shared/user-export-categories.ts";
import { assertNoLegalHold, type LegalHoldScope } from "../_shared/legal-hold.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ALLOWED_SET = new Set<string>(ALLOWED_USER_EXPORT_CATEGORIES);

// `categories` validated as non-empty strings; full allow-list semantics
// applied later by resolveExportScope so we still record what the user
// asked for in `requested_categories` (even unknowns) for audit.
const BodySchema = z.object({
  categories: z.array(z.string().trim().min(1).max(64)).min(1).max(32),
  reason: z.string().trim().max(500).optional(),
}).strict();

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function extractIp(req: Request): string | null {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip");
}

/**
 * Phase 1 legal/security-hold check. The formal `legal_holds` model
 * does not yet exist (see DATA-005-FU-LEGAL-HOLD-001). This helper is
 * future-safe: if the table is absent it returns "no active hold"; if
 * the table appears later we can extend it without touching callers.
 */
// deno-lint-ignore no-explicit-any
async function checkLegalHold(admin: any, userId: string, orgIds: string[]):
  Promise<{ blocked: boolean; reason: string | null }> {
  try {
    const { data, error } = await admin
      .from("legal_holds")
      .select("id, scope_type, scope_id, status")
      .or(
        [
          `and(scope_type.eq.user,scope_id.eq.${userId})`,
          ...orgIds.map((o) => `and(scope_type.eq.org,scope_id.eq.${o})`),
        ].join(","),
      )
      .eq("status", "active")
      .limit(1);
    // Table missing or any error: treat as no hold (future-safe).
    if (error) return { blocked: false, reason: null };
    if (data && data.length > 0) {
      return { blocked: true, reason: "legal_or_security_hold_active" };
    }
    return { blocked: false, reason: null };
  } catch {
    return { blocked: false, reason: null };
  }
}

// deno-lint-ignore no-explicit-any
async function writeCanonical(
  admin: any,
  name: string,
  payload: Record<string, unknown>,
  orgId: string | null,
) {
  try {
    await admin.from("audit_logs").insert({
      org_id: orgId,
      actor_user_id: payload.user_id ?? null,
      action: name,
      entity_type: "user_export_request",
      entity_id: payload.request_id ?? null,
      metadata: payload,
    });
  } catch (e) {
    console.error(`[user-export-request] audit write failed (${name}):`, e);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return json({ error: "unauthorized" }, 401);
  }

  const userClient = createClient(SUPABASE_URL, ANON, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);
  const user = userData.user;

  const admin = createClient(SUPABASE_URL, SERVICE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Resolve authorised org memberships server-side. Profiles is the
  // canonical single-org link in this project.
  const { data: prof } = await admin
    .from("profiles")
    .select("org_id")
    .eq("id", user.id)
    .maybeSingle();
  const orgIds: string[] = prof?.org_id ? [prof.org_id] : [];
  const primaryOrgId: string | null = prof?.org_id ?? null;
  const ip = extractIp(req);
  const ua = (req.headers.get("user-agent") ?? "").slice(0, 500) || null;

  // Validate body.
  let raw: unknown;
  try { raw = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    await writeCanonical(admin, "data.user_export_blocked_or_declined", {
      user_id: user.id,
      reason_for_block: "invalid_body",
      validation_errors: parsed.error.flatten().fieldErrors,
      actor_ip: ip,
      user_agent: ua,
      blocked_at: new Date().toISOString(),
    }, primaryOrgId);
    return json(
      { error: "invalid_body", details: parsed.error.flatten().fieldErrors },
      400,
    );
  }
  const { categories: requestedCategories, reason } = parsed.data;

  // Rate-limit: e.g. 3 requests / user / 24h.
  try {
    await checkRateLimit(
      admin,
      // org_id is the rate-limit partition; fall back to user_id for users
      // without a profile org so a missing org cannot bypass the throttle.
      primaryOrgId ?? user.id,
      null,
      `user-export-request:${user.id}`,
      undefined,
      { actorIp: ip, userAgent: ua, requestId: req.headers.get("x-request-id") },
    );
  } catch (e) {
    if (e instanceof ApiException && e.code === "RATE_LIMIT_EXCEEDED") {
      await writeCanonical(admin, "data.user_export_blocked_or_declined", {
        user_id: user.id,
        reason_for_block: "rate_limited",
        actor_ip: ip,
        user_agent: ua,
        blocked_at: new Date().toISOString(),
      }, primaryOrgId);
      return json({ error: "rate_limited", code: "RATE_LIMIT_EXCEEDED" }, 429);
    }
    // Fail closed on unknown rate-limit errors.
    return json({ error: "rate_limit_check_failed" }, 500);
  }

  // Legal / security hold check.
  const hold = await checkLegalHold(admin, user.id, orgIds);

  // Insert the request row at status=requested. Service-role bypasses RLS.
  const { data: inserted, error: insertErr } = await admin
    .from("user_export_requests")
    .insert({
      user_id: user.id,
      org_id: primaryOrgId,
      status: "requested",
      requested_categories: requestedCategories,
      resolved_categories: [],
      block_reason: null,
      request_metadata: {
        reason: reason ?? null,
        actor_ip: ip,
        user_agent: ua,
      },
    })
    .select("id, status, requested_categories, resolved_categories, block_reason, requested_at")
    .single();

  if (insertErr || !inserted) {
    console.error("[user-export-request] insert failed:", insertErr);
    return json({ error: "request_create_failed" }, 500);
  }

  await writeCanonical(admin, "data.user_export_requested", {
    request_id: inserted.id,
    user_id: user.id,
    org_id: primaryOrgId,
    requested_categories: requestedCategories,
    reason: reason ?? null,
    actor_ip: ip,
    user_agent: ua,
    requested_at: inserted.requested_at,
  }, primaryOrgId);

  // Blocked by legal/security hold: transition straight to `blocked`.
  if (hold.blocked) {
    await admin
      .from("user_export_requests")
      .update({
        status: "blocked",
        block_reason: hold.reason,
      })
      .eq("id", inserted.id);
    await writeCanonical(admin, "data.user_export_blocked_or_declined", {
      request_id: inserted.id,
      user_id: user.id,
      org_id: primaryOrgId,
      reason_for_block: hold.reason,
      actor_ip: ip,
      user_agent: ua,
      blocked_at: new Date().toISOString(),
    }, primaryOrgId);
    return json({
      ok: true,
      request_id: inserted.id,
      status: "blocked",
      requested_categories: requestedCategories,
      resolved_categories: [],
      block_reason: hold.reason,
      next_step:
        "Your account or organisation is currently under a legal or security hold. " +
        "Please contact support to discuss your subject-access request.",
    }, 200);
  }

  // Resolve scope (pure function — no payload fetched).
  const scope = resolveExportScope(user.id, orgIds, requestedCategories);

  if (scope.empty) {
    await admin
      .from("user_export_requests")
      .update({
        status: "blocked",
        block_reason: "no_allowed_categories_after_scope_resolution",
        resolved_categories: [],
      })
      .eq("id", inserted.id);
    await writeCanonical(admin, "data.user_export_blocked_or_declined", {
      request_id: inserted.id,
      user_id: user.id,
      org_id: primaryOrgId,
      reason_for_block: "no_allowed_categories",
      requested_categories: requestedCategories,
      stripped: scope.stripped,
      actor_ip: ip,
      user_agent: ua,
      blocked_at: new Date().toISOString(),
    }, primaryOrgId);
    return json({
      ok: true,
      request_id: inserted.id,
      status: "blocked",
      requested_categories: requestedCategories,
      resolved_categories: [],
      block_reason: "no_allowed_categories_after_scope_resolution",
      next_step:
        "None of the categories you requested are eligible for self-export. " +
        "Please choose from the listed categories and try again.",
    }, 200);
  }

  // Happy path: scope_resolved. No payload generated in Phase 1.
  await admin
    .from("user_export_requests")
    .update({
      status: "scope_resolved",
      resolved_categories: scope.resolved,
    })
    .eq("id", inserted.id);
  await writeCanonical(admin, "data.user_export_scope_resolved", {
    request_id: inserted.id,
    user_id: user.id,
    org_id: primaryOrgId,
    requested_categories: requestedCategories,
    resolved_categories: scope.resolved,
    stripped: scope.stripped,
    actor_ip: ip,
    user_agent: ua,
    scope_resolved_at: new Date().toISOString(),
  }, primaryOrgId);

  return json({
    ok: true,
    request_id: inserted.id,
    status: "scope_resolved",
    requested_categories: requestedCategories,
    resolved_categories: scope.resolved,
    block_reason: null,
    next_step:
      "Your export request has been recorded and the eligible categories " +
      "have been confirmed. File generation is not yet available — you " +
      "will be notified when your download is ready.",
  }, 200);
});

// Forbidden-category list re-exported so the prebuild guard can detect
// accidental promotion of a forbidden name to an allowed enum elsewhere.
export const _FORBIDDEN_USER_EXPORT_CATEGORIES = FORBIDDEN_USER_EXPORT_CATEGORIES;
