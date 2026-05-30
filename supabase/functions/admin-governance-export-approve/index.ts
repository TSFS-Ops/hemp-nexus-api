// Admin Export Controls Batch 4 — admin-governance-export-approve
//
// Platform-admin only. AAL2 required. Transitions a Governance Record export
// request from `awaiting_approval` → `approved`.
//
// "Approved means approved only — not prepared, not generated, not downloadable."
//
// This function NEVER:
//   - generates a file
//   - returns export data
//   - mints a signed URL
//   - prepares any export payload
//   - destroys or downloads anything
//   - mutates legal-hold records
//
// Emits canonical DATA-010 audits:
//   data.admin_export_approved            (on success)
//   data.admin_export_blocked_or_declined (on any 4xx)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { assertAal2 } from "../_shared/aal.ts";
import { ApiException } from "../_shared/errors.ts";
import {
  corsHeaders as __buildCorsHeaders,
  handleCors as __handleCors,
} from "../_shared/cors.ts";
import {
  DATA_010_AUDIT_ACTIONS,
  writeLifecycleAudit,
} from "../_shared/export-lifecycle-audit.ts";

const BodySchema = z.object({
  request_id: z.string().uuid(),
  approval_note: z.string().trim().max(500).optional().default(""),
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
        surface: "admin-governance-export-approve",
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
      action: "admin-governance-export-approve",
    });
  } catch (e) {
    if (e instanceof ApiException && e.code === "MFA_REQUIRED") {
      await writeLifecycleAudit(
        admin,
        DATA_010_AUDIT_ACTIONS.blocked_or_declined,
        {
          actor_user_id: adminUser.id,
          reason: "mfa_required",
          surface: "admin-governance-export-approve",
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
        surface: "admin-governance-export-approve",
        errors: parsed.error.flatten().fieldErrors,
      },
      null,
      null,
    );
    return json(
      { error: "invalid_body", details: parsed.error.flatten().fieldErrors },
      400,
    );
  }
  const b = parsed.data;

  const { data: result, error: rpcErr } = await admin.rpc(
    "approve_admin_governance_export",
    {
      p_approver_user_id: adminUser.id,
      p_request_id: b.request_id,
      p_approval_note: b.approval_note ?? "",
    },
  );

  if (rpcErr) {
    // Map structured RPC errors to stable codes.
    const msg = String(rpcErr.message ?? "");
    const reasonMap: Array<[RegExp, string, number]> = [
      [/REQUEST_NOT_FOUND/, "REQUEST_NOT_FOUND", 404],
      [/NOT_ADMIN_EXPORT/, "NOT_ADMIN_EXPORT", 409],
      [/NOT_GOVERNANCE_RECORD_REQUEST/, "NOT_GOVERNANCE_RECORD_REQUEST", 409],
      [/REQUEST_NOT_PENDING/, "REQUEST_NOT_PENDING", 409],
      [/SELF_APPROVAL_BLOCKED|SELF_APPROVAL_NOT_ALLOWED/, "SELF_APPROVAL_BLOCKED", 409],
      [/APPROVER_REQUIRED|REQUEST_ID_REQUIRED/, "INVALID_ARGS", 400],
    ];
    const matched = reasonMap.find(([re]) => re.test(msg));
    const code = matched?.[1] ?? "APPROVAL_FAILED";
    const status = matched?.[2] ?? 500;
    await writeLifecycleAudit(
      admin,
      DATA_010_AUDIT_ACTIONS.blocked_or_declined,
      {
        actor_user_id: adminUser.id,
        approver_user_id: adminUser.id,
        reason: code.toLowerCase(),
        surface: "admin-governance-export-approve",
        request_id: b.request_id,
        rpc_error: msg,
      },
      null,
      b.request_id,
    );
    return json({ error: code.toLowerCase(), code }, status);
  }

  const r = (result ?? {}) as {
    request_id?: string;
    governance_record_id?: string;
    previous_status?: string;
    new_status?: string;
    requested_by?: string;
    redaction_mode?: string;
    approved_at?: string;
  };

  // Best-effort: fetch legal_hold_context for the audit (read-only, no mutation).
  let legalHoldContext: unknown = null;
  try {
    const { data: row } = await admin
      .from("export_requests")
      .select("verification, target_org_id")
      .eq("id", b.request_id)
      .maybeSingle();
    legalHoldContext =
      (row?.verification as Record<string, unknown> | null)?.[
        "legal_hold_context"
      ] ?? null;
    var targetOrgId = (row?.target_org_id as string | null) ?? null;
  } catch {
    var targetOrgId: string | null = null;
  }

  await writeLifecycleAudit(
    admin,
    DATA_010_AUDIT_ACTIONS.approved,
    {
      actor_user_id: adminUser.id,
      approver_user_id: adminUser.id,
      surface: "admin-governance-export-approve",
      request_id: r.request_id,
      governance_record_id: r.governance_record_id,
      requested_by: r.requested_by,
      redaction_mode: r.redaction_mode,
      approval_note: b.approval_note,
      legal_hold_context: legalHoldContext,
      previous_status: r.previous_status,
      new_status: r.new_status,
    },
    targetOrgId,
    r.request_id ?? b.request_id,
  );

  return json({
    ok: true,
    request_id: r.request_id,
    governance_record_id: r.governance_record_id,
    previous_status: r.previous_status,
    new_status: r.new_status,
    redaction_mode: r.redaction_mode,
    approver_user_id: adminUser.id,
    approved_at: r.approved_at,
    next_step:
      "Approved means approved only. No file has been generated, no signed URL has been minted, and no download link exists.",
  });
});
