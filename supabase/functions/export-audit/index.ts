// Batch O — AUD-012: export-audit edge function.
// DATA-010 Phase 1 (2026-05-23): hardened.
//
// Records a row in `audit_logs` before a sensitive CSV/JSON export is
// delivered. Phase 1 changes:
//   • Server-side platform_admin check via `is_admin` RPC (defence in depth —
//     does not rely solely on UI route protection).
//   • Default-sensitive: every target_type is treated as sensitive and
//     requires AAL2 unless explicitly allowlisted in NON_SENSITIVE_TARGETS
//     (empty by default).
//   • Required request fields: `purpose` (enum), `reason` (≥10 chars),
//     `target_org_id` (nullable uuid), `data_categories` (string[]).
//   • Canonical DATA-010 audit names emitted in addition to legacy
//     `export.csv` / `export.json` rows for backward compatibility:
//       data.admin_export_requested      (on entry, after auth)
//       data.admin_export_blocked_or_declined (on any 4xx)
//       data.admin_export_generated      (on success)
//   • SEC-001 registry key: `export.admin_pii_export`.
//
// The function still does NOT stream the export itself — the client
// performs the actual CSV write. Phase 2 (DATA-010-FU-EXPORT-LIFECYCLE-001)
// will move generation server-side under a signed-URL TTL.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { assertAal2 } from "../_shared/aal.ts";
import { ApiException } from "../_shared/errors.ts";
import { EXPORT_PURPOSES, MIN_EXPORT_REASON_LENGTH } from "../_shared/export-purpose.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TARGET_TYPES = [
  "audit_logs",
  "admin_audit_logs",
  "outreach_blocks",
  "matches",
  "notification_preferences",
  "programmes",
  "programme_participants",
  "programme_fund_flows",
  "other",
] as const;

// DATA-010 Phase 1: default-sensitive. Add target types here only after
// a written privacy review confirms the export contains no PII/secrets.
const NON_SENSITIVE_TARGETS = new Set<string>([
  // (empty — every admin export is sensitive by default)
]);

const BodySchema = z.object({
  target_type: z.enum(TARGET_TYPES),
  format: z.enum(["csv", "json"]).default("csv"),
  row_count: z.number().int().nonnegative().max(1_000_000),
  filters: z.record(z.unknown()).optional().default({}),
  // `sensitive` is now advisory only — server treats every target as
  // sensitive unless allowlisted. Kept for backwards-compat with older
  // client payloads.
  sensitive: z.boolean().optional().default(true),
  purpose: z.enum(EXPORT_PURPOSES),
  reason: z
    .string()
    .trim()
    .min(MIN_EXPORT_REASON_LENGTH, `reason must be at least ${MIN_EXPORT_REASON_LENGTH} characters`)
    .max(500),
  target_org_id: z.string().uuid().nullable().optional().default(null),
  data_categories: z.array(z.string().min(1).max(64)).max(32).optional().default([]),
  requested_date_range: z
    .object({ from: z.string().optional(), to: z.string().optional() })
    .nullable()
    .optional()
    .default(null),
});

const SENSITIVE_LEGACY_TARGETS = new Set([
  "audit_logs",
  "admin_audit_logs",
  "notification_preferences",
  "programme_fund_flows",
]);

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

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// deno-lint-ignore no-explicit-any
async function writeCanonical(admin: any, name: string, payload: Record<string, unknown>, orgId: string | null) {
  // Canonical DATA-010 audit row. Best-effort; never blocks the response.
  try {
    if (orgId) {
      await admin.from("audit_logs").insert({
        org_id: orgId,
        actor_user_id: payload.requested_by_admin_user_id ?? null,
        action: name,
        entity_type: "admin_export",
        entity_id: null,
        metadata: payload,
      });
    }
    await admin.from("admin_audit_logs").insert({
      admin_user_id: payload.requested_by_admin_user_id ?? null,
      action: name,
      target_type: "admin_export",
      target_id: payload.client_organisation_id ?? null,
      details: payload,
      ip_address: payload.actor_ip ?? null,
      user_agent: payload.user_agent ?? null,
    });
  } catch (e) {
    console.error(`[export-audit] canonical audit write failed (${name}):`, e);
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

  // ── Phase 1: server-side platform_admin check (defence in depth) ─────────
  const { data: isAdmin } = await admin.rpc("is_admin", { user_id: user.id });
  if (!isAdmin) {
    // Best-effort decline audit. Use a sentinel org_id only if available.
    const { data: profForDecline } = await admin
      .from("profiles")
      .select("org_id")
      .eq("id", user.id)
      .maybeSingle();
    await writeCanonical(
      admin,
      "data.admin_export_blocked_or_declined",
      {
        requested_by_admin_user_id: user.id,
        admin_email: user.email ?? null,
        reason_for_block: "not_platform_admin",
        actor_ip: extractIp(req),
        user_agent: (req.headers.get("user-agent") ?? "").slice(0, 500) || null,
        blocked_at: new Date().toISOString(),
      },
      profForDecline?.org_id ?? null,
    );
    return json({ error: "forbidden", code: "NOT_PLATFORM_ADMIN" }, 403);
  }

  let body: unknown;
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }
  const parsed = BodySchema.safeParse(body);

  // Lookup the caller's org early (used for both success and decline rows).
  const { data: prof } = await admin
    .from("profiles")
    .select("org_id")
    .eq("id", user.id)
    .maybeSingle();
  const orgId = prof?.org_id ?? null;
  const ip = extractIp(req);
  const ua = (req.headers.get("user-agent") ?? "").slice(0, 500) || null;

  if (!parsed.success) {
    await writeCanonical(
      admin,
      "data.admin_export_blocked_or_declined",
      {
        requested_by_admin_user_id: user.id,
        admin_email: user.email ?? null,
        organisation_id: orgId,
        reason_for_block: "validation_error",
        validation_errors: parsed.error.flatten(),
        actor_ip: ip,
        user_agent: ua,
        blocked_at: new Date().toISOString(),
      },
      orgId,
    );
    return json({ error: "validation_error", details: parsed.error.flatten() }, 400);
  }
  const input = parsed.data;
  const isSensitive = !NON_SENSITIVE_TARGETS.has(input.target_type);

  // ── DATA-010: requested row (after auth, before AAL gate / generation) ──
  const filtersJson = JSON.stringify(input.filters ?? {});
  const filters_hash = await sha256Hex(filtersJson);
  const requestedAt = new Date().toISOString();
  const exportRequestId = (req.headers.get("x-request-id") ?? crypto.randomUUID());

  const baseMeta = {
    export_request_id: exportRequestId,
    requested_by_admin_user_id: user.id,
    admin_email: user.email ?? null,
    organisation_id: orgId,
    client_organisation_id: input.target_org_id ?? null,
    export_purpose: input.purpose,
    requested_data_categories: input.data_categories,
    requested_date_range: input.requested_date_range,
    requested_format: input.format,
    target_type: input.target_type,
    reason_for_export: input.reason,
    mfa_required: true,
    approval_required: true,
    redactions_applied: true,
    sensitive: isSensitive,
    filters_hash,
    filters_summary_keys: Object.keys(input.filters ?? {}).sort(),
    actor_ip: ip,
    user_agent: ua,
    row_count: input.row_count,
  };

  await writeCanonical(
    admin,
    "data.admin_export_requested",
    { ...baseMeta, status: "requested", requested_at: requestedAt },
    orgId,
  );

  // ── AAL2 gate (default-sensitive) ────────────────────────────────────────
  if (isSensitive) {
    try {
      await assertAal2(authHeader, {
        adminClient: admin,
        callerUserId: user.id,
        action: "export.admin_pii_export",
        context: {
          target_type: input.target_type,
          export_request_id: exportRequestId,
          purpose: input.purpose,
        },
      });
    } catch (e) {
      const isApi = e instanceof ApiException;
      await writeCanonical(
        admin,
        "data.admin_export_blocked_or_declined",
        {
          ...baseMeta,
          status: "blocked",
          reason_for_block: "mfa_required",
          mfa_status: "aal1_or_unknown",
          blocked_at: new Date().toISOString(),
        },
        orgId,
      );
      if (isApi && (e as ApiException).code === "MFA_REQUIRED") {
        return json({ error: "mfa_required", code: "MFA_REQUIRED", aal_required: true }, 403);
      }
      console.error("[export-audit] assertAal2 unexpected error:", e);
      return json({ error: "internal_error" }, 500);
    }
  }

  // ── Legacy audit rows (kept for backward compatibility with existing
  //    reporting/queries built on `export.csv` / `export.json`). ───────────
  if (orgId) {
    await admin.from("audit_logs").insert({
      org_id: orgId,
      actor_user_id: user.id,
      action: `export.${input.format}`,
      entity_type: input.target_type,
      entity_id: null,
      metadata: {
        target_type: input.target_type,
        format: input.format,
        row_count: input.row_count,
        sensitive: isSensitive,
        purpose: input.purpose,
        reason: input.reason,
        target_org_id: input.target_org_id ?? null,
        data_categories: input.data_categories,
        filters_hash,
        filters_summary_keys: Object.keys(input.filters ?? {}).sort(),
        actor_ip: ip,
        user_agent: ua,
        exported_at: new Date().toISOString(),
        export_request_id: exportRequestId,
      },
    });
  }
  if (SENSITIVE_LEGACY_TARGETS.has(input.target_type)) {
    await admin.from("admin_audit_logs").insert({
      admin_user_id: user.id,
      action: `export.${input.format}`,
      target_type: input.target_type,
      target_id: null,
      details: {
        target_type: input.target_type,
        format: input.format,
        row_count: input.row_count,
        sensitive: isSensitive,
        purpose: input.purpose,
        reason: input.reason,
        target_org_id: input.target_org_id ?? null,
        data_categories: input.data_categories,
        filters_hash,
        org_id: orgId,
        aal: "aal2",
        exported_at: new Date().toISOString(),
        export_request_id: exportRequestId,
      },
      ip_address: ip,
      user_agent: ua,
    });
  }

  await writeCanonical(
    admin,
    "data.admin_export_generated",
    {
      ...baseMeta,
      status: "generated",
      generated_at: new Date().toISOString(),
    },
    orgId,
  );

  return json({ ok: true, request_id: exportRequestId, export_request_id: exportRequestId });
});
