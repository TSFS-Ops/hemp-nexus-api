/**
 * DATA-004 Phase 1 — Per-org retention policy admin edge function (SHELL).
 *
 * Single endpoint, action-discriminated:
 *   POST /admin-org-retention { action: "list" | "set" | "clear", ... }
 *
 * Security model (mirrors admin-legal-hold):
 *   1. Valid Bearer token
 *   2. Caller is platform_admin (has_role check via service-role)
 *   3. Caller's session is aal2 (MFA) — assertAal2  [skipped for "list"]
 *   4. set: retention_days >= platform floor; reason >=10 chars
 *   5. clear: reason >=10 chars
 *
 * Canonical audits (CI-guarded by check-data-org-retention-audit-names.mjs):
 *   - data.org_retention_policy.set
 *   - data.org_retention_policy.cleared
 *
 * Phase 1 = SHELL only. No sweeper reads this table yet; values are recorded
 * + audited + surfaced in HQ. Phase 2 will wire storage-retention-cleanup,
 * account-deletion-sweeper, purge-email-send-log, cold-storage-archive.
 */

// deno-lint-ignore-file no-explicit-any

import { createClient } from "npm:@supabase/supabase-js@2.39.3";
import { z } from "npm:zod@3.23.8";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import { assertAal2, readAal } from "../_shared/aal.ts";
import { ApiException } from "../_shared/errors.ts";

const corsHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const RECORD_CLASSES = [
  "matches",
  "trade_requests",
  "pois",
  "wads",
  "evidence",
  "audit_logs",
  "email_send_log",
  "governance_records",
] as const;

const ORG_RETENTION_AUDIT_NAMES = {
  set: "data.org_retention_policy.set",
  cleared: "data.org_retention_policy.cleared",
} as const;

const ListSchema = z.object({
  action: z.literal("list"),
  org_id: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(500).default(200),
});

const SetSchema = z.object({
  action: z.literal("set"),
  org_id: z.string().uuid(),
  record_class: z.enum(RECORD_CLASSES),
  retention_days: z.number().int().positive().max(36500), // 100y ceiling
  reason: z.string().trim().min(10).max(500),
  metadata: z.record(z.unknown()).optional(),
});

const ClearSchema = z.object({
  action: z.literal("clear"),
  org_id: z.string().uuid(),
  record_class: z.enum(RECORD_CLASSES),
  reason: z.string().trim().min(10).max(500),
});

// DATA-004 Phase 2 — non-destructive evidence / read model.
// Read-only. Platform-admin only. Does NOT require AAL2 (parity with `list`).
const HealthSchema = z.object({
  action: z.literal("health"),
  limit_orgs: z.number().int().min(1).max(500).default(200),
});

const BodySchema = z.discriminatedUnion(
  "action",
  [ListSchema, SetSchema, ClearSchema, HealthSchema],
);

function jsonResponse(req: Request, body: unknown, status = 200) {
  return withCors(
    req,
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }),
  );
}

async function writeCanonicalAudit(
  admin: any,
  action: typeof ORG_RETENTION_AUDIT_NAMES.set | typeof ORG_RETENTION_AUDIT_NAMES.cleared,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    await admin.from("audit_logs").insert({
      org_id: (payload.org_id as string | null) ?? null,
      actor_user_id: (payload.actor_user_id as string | null) ?? null,
      action,
      entity_type: "org_retention_policy",
      entity_id: (payload.policy_id as string | null) ?? null,
      metadata: payload,
    });
  } catch (e) {
    console.error(`[admin-org-retention] canonical audit write failed (${action}):`, e);
  }
}

async function writeAdminAudit(
  admin: any,
  callerUserId: string | null,
  action: string,
  targetId: string | null,
  details: Record<string, unknown>,
): Promise<void> {
  try {
    await admin.from("admin_audit_logs").insert({
      admin_user_id: callerUserId,
      action,
      target_type: "org_retention_policy",
      target_id: targetId,
      details,
    });
  } catch (e) {
    console.error(`[admin-org-retention] admin audit write failed (${action}):`, e);
  }
}

Deno.serve(async (req) => {
  const __pf = handleCorsPreflight(req);
  if (__pf) return __pf;

  if (req.method !== "POST") {
    return jsonResponse(req, { error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  let callerId: string | null = null;

  try {
    // 1. Auth
    const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorisation");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return jsonResponse(req, { error: "Unauthorised" }, 401);
    }
    const token = authHeader.replace("Bearer ", "");
    const { data: userRes, error: authError } = await admin.auth.getUser(token);
    if (authError || !userRes?.user) {
      return jsonResponse(req, { error: "Invalid token" }, 401);
    }
    callerId = userRes.user.id;
    const observedAal = readAal(authHeader);

    // 2. RBAC
    const { data: hasAdmin, error: roleError } = await admin.rpc("has_role", {
      _user_id: callerId,
      _role: "platform_admin",
    });
    if (roleError) {
      console.error("[admin-org-retention] has_role failed:", roleError);
      return jsonResponse(req, { error: "Authorisation check failed" }, 500);
    }
    if (!hasAdmin) {
      await writeAdminAudit(admin, callerId, "admin.org_retention.forbidden", null, {
        request_id: requestId,
        reason: "caller_not_platform_admin",
      });
      return jsonResponse(req, { error: "Platform admin access required" }, 403);
    }

    // 3. Parse body first (need action to decide AAL2 enforcement)
    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return jsonResponse(req, { error: "Invalid JSON body" }, 400);
    }
    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) {
      return jsonResponse(
        req,
        { error: "Invalid input", details: parsed.error.flatten() },
        400,
      );
    }

    // 4. AAL2 — required for mutating actions only.
    if (parsed.data.action === "set" || parsed.data.action === "clear") {
      try {
        await assertAal2(authHeader, {
          adminClient: admin,
          callerUserId: callerId,
          action: "admin.org_retention",
        });
      } catch (mfaErr) {
        if (mfaErr instanceof ApiException && mfaErr.code === "MFA_REQUIRED") {
          return jsonResponse(req, { error: mfaErr.message, code: "MFA_REQUIRED" }, 403);
        }
        throw mfaErr;
      }
    }

    // ── ACTION: list ─────────────────────────────────────────────────
    if (parsed.data.action === "list") {
      let q = admin
        .from("org_retention_policies")
        .select("*, organizations!inner(id, name)")
        .order("updated_at", { ascending: false })
        .limit(parsed.data.limit);
      if (parsed.data.org_id) q = q.eq("org_id", parsed.data.org_id);
      const { data, error } = await q;
      if (error) {
        return jsonResponse(req, { error: "Query failed", detail: error.message }, 500);
      }
      // Also return platform floors so the UI never hard-codes them.
      const floors = Object.fromEntries(
        RECORD_CLASSES.map((c) => [c, c === "email_send_log" ? 90 : 2555]),
      );
      return jsonResponse(req, {
        ok: true,
        policies: data ?? [],
        record_classes: RECORD_CLASSES,
        floors,
        request_id: requestId,
      });
    }

    // ── ACTION: set ──────────────────────────────────────────────────
    if (parsed.data.action === "set") {
      const { org_id, record_class, retention_days, reason, metadata } = parsed.data;
      const { data: result, error: rpcErr } = await admin.rpc(
        "atomic_org_retention_set",
        {
          p_input: {
            org_id,
            record_class,
            retention_days,
            reason,
            set_by: callerId,
            metadata: {
              ...(metadata ?? {}),
              request_id: requestId,
              applied_via: "admin-org-retention",
            },
          },
        },
      );
      if (rpcErr) {
        return jsonResponse(req, { error: "Set failed", detail: rpcErr.message }, 500);
      }
      const r = result as {
        success: boolean;
        error?: string;
        action?: string;
        policy_id?: string;
        floor_days?: number;
        requested_days?: number;
        previous_retention_days?: number | null;
        set_at?: string;
      } | null;
      if (!r?.success) {
        if (r?.error === "BELOW_FLOOR") {
          return jsonResponse(req, {
            ok: false,
            code: "BELOW_FLOOR",
            message: `Requested ${r.requested_days}d is below the platform floor of ${r.floor_days}d for ${record_class}.`,
            floor_days: r.floor_days,
            requested_days: r.requested_days,
          }, 409);
        }
        if (r?.error === "INVALID_INPUT") {
          return jsonResponse(req, { error: "Invalid input" }, 400);
        }
        return jsonResponse(req, { error: "Set failed", detail: r?.error ?? "unknown" }, 500);
      }

      await writeCanonicalAudit(admin, ORG_RETENTION_AUDIT_NAMES.set, {
        policy_id: r.policy_id,
        org_id,
        record_class,
        retention_days,
        floor_days: r.floor_days,
        previous_retention_days: r.previous_retention_days ?? null,
        action_kind: r.action,
        reason,
        actor_user_id: callerId,
        aal: observedAal,
        set_at: r.set_at,
        request_id: requestId,
      });
      await writeAdminAudit(admin, callerId, "admin.org_retention.set", r.policy_id ?? null, {
        request_id: requestId,
        org_id,
        record_class,
        retention_days,
        previous_retention_days: r.previous_retention_days ?? null,
        reason,
        aal: observedAal,
      });

      return jsonResponse(req, {
        ok: true,
        policy_id: r.policy_id,
        action: r.action,
        retention_days,
        floor_days: r.floor_days,
        previous_retention_days: r.previous_retention_days ?? null,
        message: `Per-org retention recorded (${r.action}). NOTE: Phase 1 shell — sweepers do not yet enforce this value.`,
        request_id: requestId,
      });
    }

    // ── ACTION: clear ────────────────────────────────────────────────
    if (parsed.data.action === "clear") {
      const { org_id, record_class, reason } = parsed.data;
      const { data: result, error: rpcErr } = await admin.rpc(
        "atomic_org_retention_clear",
        { p_input: { org_id, record_class, reason } },
      );
      if (rpcErr) {
        return jsonResponse(req, { error: "Clear failed", detail: rpcErr.message }, 500);
      }
      const r = result as {
        success: boolean;
        error?: string;
        cleared_policy_id?: string;
        previous_retention_days?: number;
        floor_days?: number;
      } | null;
      if (!r?.success) {
        if (r?.error === "NOT_FOUND") {
          return jsonResponse(req, { error: "Policy not found", code: "NOT_FOUND" }, 404);
        }
        if (r?.error === "INVALID_INPUT") {
          return jsonResponse(req, { error: "Invalid input" }, 400);
        }
        return jsonResponse(req, { error: "Clear failed", detail: r?.error ?? "unknown" }, 500);
      }

      await writeCanonicalAudit(admin, ORG_RETENTION_AUDIT_NAMES.cleared, {
        policy_id: r.cleared_policy_id,
        org_id,
        record_class,
        previous_retention_days: r.previous_retention_days,
        floor_days: r.floor_days,
        reason,
        actor_user_id: callerId,
        aal: observedAal,
        request_id: requestId,
      });
      await writeAdminAudit(admin, callerId, "admin.org_retention.cleared", r.cleared_policy_id ?? null, {
        request_id: requestId,
        org_id,
        record_class,
        previous_retention_days: r.previous_retention_days,
        reason,
        aal: observedAal,
      });

      return jsonResponse(req, {
        ok: true,
        cleared_policy_id: r.cleared_policy_id,
        floor_days: r.floor_days,
        message: `Per-org retention cleared — effective value falls back to platform floor (${r.floor_days}d).`,
        request_id: requestId,
      });
    }

    return jsonResponse(req, { error: "Unknown action" }, 400);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    console.error("[admin-org-retention] unhandled error:", err);
    if (callerId) {
      await writeAdminAudit(admin, callerId, "admin.org_retention.unhandled_error", null, {
        request_id: requestId,
        error: message,
      });
    }
    return jsonResponse(req, { error: "Internal error" }, 500);
  }
});
