// Admin Export Controls Batch 2 — admin-governance-export-request
//
// Platform-admin only. AAL2 required. Records a Governance Record export
// request in `export_requests` with kind='admin_export',
// status='awaiting_approval', governance_record_id + redaction_mode set.
//
// This function NEVER:
//   - generates a file
//   - returns export data
//   - mints a signed URL
//   - approves or downloads anything
//
// Emits canonical DATA-010 audits:
//   data.admin_export_requested           (on success)
//   data.admin_export_blocked_or_declined (on any 4xx)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { assertAal2 } from "../_shared/aal.ts";
import { ApiException } from "../_shared/errors.ts";
import {
  EXPORT_PURPOSES,
  MIN_EXPORT_REASON_LENGTH,
} from "../_shared/export-purpose.ts";
import {
  corsHeaders as __buildCorsHeaders,
  handleCors as __handleCors,
} from "../_shared/cors.ts";
import {
  DATA_010_AUDIT_ACTIONS,
  writeLifecycleAudit,
} from "../_shared/export-lifecycle-audit.ts";
import {
  detectGovernanceRecordLegalHold,
  sanitiseOperatorLegalHoldContext,
} from "../_shared/legal-hold-detection.ts";

export const ADMIN_GOVERNANCE_EXPORT_REDACTION_MODES = [
  "redacted_client_safe",
  "evidence_only",
  "metadata_only",
  "full_internal",
] as const;

const BodySchema = z.object({
  governance_record_id: z.string().uuid(),
  purpose: z.enum(EXPORT_PURPOSES),
  reason: z.string().trim().min(MIN_EXPORT_REASON_LENGTH).max(500),
  requested_categories: z.array(z.string().min(1).max(64)).min(1).max(32),
  target_org_id: z.string().uuid().nullable().optional().default(null),
  redaction_mode: z
    .enum(ADMIN_GOVERNANCE_EXPORT_REDACTION_MODES)
    .optional()
    .default("redacted_client_safe"),
  date_range: z
    .object({ from: z.string().optional(), to: z.string().optional() })
    .nullable()
    .optional()
    .default(null),
  legal_hold_context: z
    .object({
      hold_id: z.string().optional(),
      scope: z.string().optional(),
      reason: z.string().max(500).optional(),
    })
    .nullable()
    .optional()
    .default(null),
}).strict();

Deno.serve(async (req) => {
  const corsHeaders = __buildCorsHeaders(
    Deno.env.get("ALLOWED_ORIGINS") || "",
    req.headers.get("origin"),
  );
  const __pf = __handleCors(req, Deno.env.get("ALLOWED_ORIGINS") || "");
  if (__pf) return __pf;
  function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

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
  const adminUser = userData.user;

  const admin = createClient(SUPABASE_URL, SERVICE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // platform_admin gate (defence in depth — RLS also enforces this).
  const { data: isAdmin } = await admin.rpc("is_admin", {
    user_id: adminUser.id,
  });
  if (!isAdmin) {
    await writeLifecycleAudit(
      admin,
      DATA_010_AUDIT_ACTIONS.blocked_or_declined,
      {
        actor_user_id: adminUser.id,
        reason: "not_platform_admin",
        surface: "admin-governance-export-request",
      },
      null,
      null,
    );
    return json({ error: "forbidden", code: "NOT_PLATFORM_ADMIN" }, 403);
  }

  // AAL2 gate.
  try {
    await assertAal2(authHeader, {
      adminClient: admin,
      callerUserId: adminUser.id,
      action: "admin-governance-export-request",
    });
  } catch (e) {
    if (e instanceof ApiException && e.code === "MFA_REQUIRED") {
      await writeLifecycleAudit(
        admin,
        DATA_010_AUDIT_ACTIONS.blocked_or_declined,
        {
          actor_user_id: adminUser.id,
          reason: "mfa_required",
          surface: "admin-governance-export-request",
        },
        null,
        null,
      );
      return json({ error: "mfa_required", code: "MFA_REQUIRED" }, 403);
    }
    return json({ error: "aal_check_failed" }, 500);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    await writeLifecycleAudit(
      admin,
      DATA_010_AUDIT_ACTIONS.blocked_or_declined,
      {
        actor_user_id: adminUser.id,
        reason: "invalid_body",
        surface: "admin-governance-export-request",
        errors: parsed.error.flatten().fieldErrors,
      },
      null,
      null,
    );
    return json(
      {
        error: "invalid_body",
        details: parsed.error.flatten().fieldErrors,
      },
      400,
    );
  }
  const b = parsed.data;

  const { data: requestId, error: rpcErr } = await admin.rpc(
    "request_admin_governance_export",
    {
      p_requester_user_id: adminUser.id,
      p_governance_record_id: b.governance_record_id,
      p_purpose: b.purpose,
      p_reason: b.reason,
      p_requested_categories: b.requested_categories,
      p_target_org_id: b.target_org_id,
      p_redaction_mode: b.redaction_mode,
      p_date_range: b.date_range,
      p_legal_hold_context: b.legal_hold_context,
    },
  );
  if (rpcErr || !requestId) {
    console.error("[admin-governance-export-request] rpc failed:", rpcErr);
    await writeLifecycleAudit(
      admin,
      DATA_010_AUDIT_ACTIONS.blocked_or_declined,
      {
        actor_user_id: adminUser.id,
        reason: "request_create_failed",
        surface: "admin-governance-export-request",
        rpc_error: rpcErr?.message ?? null,
      },
      b.target_org_id,
      null,
    );
    return json({ error: "request_create_failed" }, 500);
  }

  await writeLifecycleAudit(
    admin,
    DATA_010_AUDIT_ACTIONS.requested,
    {
      actor_user_id: adminUser.id,
      requested_by_admin_user_id: adminUser.id,
      surface: "admin-governance-export-request",
      request_id: requestId,
      governance_record_id: b.governance_record_id,
      target_org_id: b.target_org_id,
      purpose: b.purpose,
      reason: b.reason,
      requested_categories: b.requested_categories,
      redaction_mode: b.redaction_mode,
      legal_hold_context: b.legal_hold_context,
    },
    b.target_org_id,
    requestId,
  );

  return json({
    ok: true,
    request_id: requestId,
    status: "awaiting_approval",
    redaction_mode: b.redaction_mode,
    next_step:
      "Recorded. A second platform admin must approve before any file is generated. No file has been generated and no download link exists.",
  });
});
