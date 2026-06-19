/**
 * DATA-004 Batch 20 — Email Anonymisation Readiness Probe
 *
 * ASSESSMENT-ONLY. READ-ONLY. NO LIVE ANONYMISATION PATH.
 *
 * Returns a STATIC, schema-level readiness report for a future
 * `email_send_log` anonymisation pathway. It does NOT:
 *   - SELECT row-level data from email_send_log
 *   - return any PII (recipient_email, message_id, error_message, metadata, subject/body)
 *   - mutate email_send_log
 *   - schedule any cron entry
 *   - touch purge-email-send-log-daily{,-live} or its dry-run twin
 *   - touch the per-org retention policy table / effective-days helper / admin-org-retention
 *
 * Security model (mirrors admin-org-retention):
 *   1. Valid Bearer token
 *   2. Caller is platform_admin (has_role)
 *   3. Caller's session is AAL2 (MFA) — assertAal2
 *   4. Legal-hold short-circuit on email_send_log_anonymise record_group
 *
 * Canonical audit (CI-guarded):
 *   - data.email_anonymisation_readiness_probed
 */

// deno-lint-ignore-file no-explicit-any

import { createClient } from "npm:@supabase/supabase-js@2.39.3";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import { assertAal2 } from "../_shared/aal.ts";
import { ApiException } from "../_shared/errors.ts";
import { assertNoLegalHold, RECORD_GROUP_IDS } from "../_shared/legal-hold.ts";

const corsHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const READINESS_AUDIT_NAME = "data.email_anonymisation_readiness_probed" as const;

/**
 * Static schema-level inventory for email_send_log.
 *
 * Sourced from migration 20260408124436_email_infra.sql. This is a
 * deliberate copy — the probe MUST NOT introspect information_schema
 * at runtime either, because introspection results could vary by
 * environment and would invite "while we're here, just read one row"
 * drift. The contract guard enforces no SELECT against email_send_log.
 *
 * Disposition vocabulary:
 *   keep          — non-PII, retain as-is for analytics/audit
 *   null          — clear to NULL after retention window
 *   hash          — replace with deterministic SHA-256 (for dedup metrics)
 *   truncate      — keep coarse shape only (e.g. domain of email)
 *   aggregate_only — drop row-level value, bucket into counters
 *   do_not_retain — hard delete (current `purge-email-send-log-daily-live` path)
 */
const EMAIL_SEND_LOG_SCHEMA_INVENTORY = [
  { column: "id", type: "uuid", pii: false, disposition: "keep",
    note: "Primary key. Not PII." },
  { column: "message_id", type: "text", pii: "indirect",
    disposition: "hash",
    note: "Provider message id. Indirect PII via provider join. Hash for dedup." },
  { column: "template_name", type: "text", pii: false, disposition: "keep",
    note: "Template identifier. Operational metric. Not PII." },
  { column: "recipient_email", type: "text", pii: true,
    disposition: "truncate",
    note: "Direct PII. Retain domain only for deliverability metrics." },
  { column: "status", type: "text", pii: false, disposition: "keep",
    note: "Delivery state enum. Required for analytics." },
  { column: "error_message", type: "text", pii: "possible",
    disposition: "null",
    note: "Provider error text may echo recipient address. Null after window." },
  { column: "metadata", type: "jsonb", pii: "possible",
    disposition: "aggregate_only",
    note: "Free-shape JSON. Cannot guarantee PII-free. Reduce to template/status counters." },
  { column: "created_at", type: "timestamptz", pii: false, disposition: "keep",
    note: "Required for retention/lifecycle reporting." },
] as const;

/**
 * Static readiness verdict. Captured here so the response is
 * deterministic across environments and the assessment is auditable
 * as a single artefact.
 */
const READINESS_VERDICT = {
  verdict: "needed_only_if_long_horizon_analytics_required",
  rationale:
    "Current posture (jobid 42 fail-closed hard-delete after retention window) " +
    "is sufficient for compliance. A separate anonymisation pathway is only " +
    "required if the platform must retain long-horizon delivery analytics " +
    "(>retention window) beyond what aggregate counters provide. No such " +
    "requirement is currently scoped.",
  recommendation_if_pursued: [
    "Introduce anonymise_old_email_send_log(p_days, p_dry_run) SECURITY DEFINER fn",
    "Schedule as dry-run-only first (no live cron insert)",
    "Add per-org policy interaction via get_effective_retention_days(record_class)",
    "Require fresh legal-hold gate on the email_send_log_anonymise record_group",
    "Add separate audit family data.email_anonymise.* with pinned names",
  ],
  not_pursuing_because: [
    "No accepted requirement for >retention-window analytics on email_send_log",
    "Hard-delete path already legal-hold gated and fail-closed",
    "Anonymisation introduces new mutation surface; net risk > net value today",
  ],
} as const;

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
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    await admin.from("audit_logs").insert({
      org_id: null,
      actor_user_id: (payload.actor_user_id as string | null) ?? null,
      action: READINESS_AUDIT_NAME,
      entity_type: "email_send_log",
      entity_id: null,
      metadata: payload,
    });
  } catch (e) {
    console.error(`[email-anonymisation-readiness-probe] audit write failed:`, e);
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

    // 2. RBAC — platform_admin only
    const { data: hasAdmin, error: roleError } = await admin.rpc("has_role", {
      _user_id: callerId,
      _role: "platform_admin",
    });
    if (roleError) {
      return jsonResponse(req, { error: "Authorisation check failed" }, 500);
    }
    if (!hasAdmin) {
      return jsonResponse(req, { error: "Platform admin access required" }, 403);
    }

    // 3. AAL2 / MFA — required (parity with admin-org-retention mutating actions)
    try {
      await assertAal2(authHeader, {
        adminClient: admin,
        callerUserId: callerId,
        action: "admin.email_anonymisation_readiness_probe",
      });
    } catch (mfaErr) {
      if (mfaErr instanceof ApiException && mfaErr.code === "MFA_REQUIRED") {
        return jsonResponse(req, { error: mfaErr.message, code: "MFA_REQUIRED" }, 403);
      }
      throw mfaErr;
    }

    // 4. Legal-hold short-circuit
    const hold = await assertNoLegalHold(admin, [
      { scope_type: "record_group", scope_id: RECORD_GROUP_IDS.email_send_log_anonymise },
    ], {
      action: "email-anonymisation-readiness-probe",
      actorUserId: callerId,
      actorOrgId: null,
      requestId,
    });
    if (hold.blocked) {
      return jsonResponse(req, {
        ok: false,
        legal_hold_active: true,
        legal_hold_id: hold.activeHold?.id ?? null,
        message:
          "Legal hold active on email_send_log_anonymise record_group; " +
          "readiness probe short-circuited without inspecting further.",
        request_id: requestId,
      });
    }

    // 5. Emit canonical audit BEFORE returning the report.
    await writeCanonicalAudit(admin, {
      actor_user_id: callerId,
      request_id: requestId,
      verdict: READINESS_VERDICT.verdict,
    });

    // 6. Return STATIC schema-level readiness report.
    //    No row-level data. No PII. Schema/disposition/verdict only.
    return jsonResponse(req, {
      ok: true,
      assessment_only: true,
      live_anonymisation_path_present: false,
      scheduled_anonymisation_job: false,
      current_retention_posture: {
        hard_delete_job: "purge-email-send-log-daily-live",
        hard_delete_active: true,
        hard_delete_fail_closed: true,
        legal_hold_gated: true,
      },
      schema_inventory: EMAIL_SEND_LOG_SCHEMA_INVENTORY,
      legal_hold_interaction: {
        record_group: "email_send_log_anonymise",
        behaviour: "any active hold short-circuits before inspection",
      },
      per_org_policy_interaction: {
        source: "org_retention_policies.record_class = 'email_send_log'",
        floor_days: 90,
        note:
          "If anonymisation is ever introduced, retention_days for the " +
          "anonymisation window MUST resolve via get_effective_retention_days " +
          "and MUST NOT be earlier than the platform floor.",
      },
      readiness_verdict: READINESS_VERDICT,
      request_id: requestId,
    });
  } catch (err) {
    console.error("[email-anonymisation-readiness-probe] error:", err);
    return jsonResponse(req, { error: "Internal error" }, 500);
  }
});
