// DATA-010 Phase 2A — admin-export-approve
//
// Approves an admin export request. Requires platform_admin + AAL2.
// Server-side AND DB-trigger reject approver_user_id == requester_user_id.
// On success transitions status from 'awaiting_approval' to
// 'export_preparation_required' and emits data.admin_export_approved.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { assertAal2 } from "../_shared/aal.ts";
import { ApiException } from "../_shared/errors.ts";
import {
import { corsHeaders as __buildCorsHeaders, handleCors as __handleCors } from "../_shared/cors.ts";
  DATA_010_AUDIT_ACTIONS,
  writeLifecycleAudit,
} from "../_shared/export-lifecycle-audit.ts";

const BodySchema = z.object({
  request_id: z.string().uuid(),
  approval_method: z.enum(["manual", "step_up_aal2"]).default("manual"),
  decline: z.boolean().optional().default(false),
  decline_reason: z.string().trim().max(500).optional(),
}).strict();

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  const corsHeaders = __buildCorsHeaders(Deno.env.get("ALLOWED_ORIGINS") || "", req.headers.get("origin"));
  const __pf = __handleCors(req, Deno.env.get("ALLOWED_ORIGINS") || "");
  if (__pf) return __pf;
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

  const userClient = createClient(SUPABASE_URL, ANON, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);
  const approver = userData.user;

  const admin = createClient(SUPABASE_URL, SERVICE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: isAdmin } = await admin.rpc("is_admin", { user_id: approver.id });
  if (!isAdmin) return json({ error: "forbidden", code: "NOT_PLATFORM_ADMIN" }, 403);

  try {
    await assertAal2(authHeader, {
      adminClient: admin,
      callerUserId: approver.id,
      action: "admin-export-approve",
    });
  } catch (e) {
    if (e instanceof ApiException && e.code === "MFA_REQUIRED") {
      return json({ error: "mfa_required", code: "MFA_REQUIRED" }, 403);
    }
    return json({ error: "aal_check_failed" }, 500);
  }

  let raw: unknown;
  try { raw = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return json({ error: "invalid_body", details: parsed.error.flatten().fieldErrors }, 400);
  }
  const { request_id, approval_method, decline, decline_reason } = parsed.data;

  // Load the request to check requester (for self-approval guard + audit org).
  const { data: reqRow, error: reqErr } = await admin
    .from("export_requests")
    .select("id, kind, status, requester_user_id, target_org_id")
    .eq("id", request_id)
    .single();
  if (reqErr || !reqRow) return json({ error: "not_found" }, 404);
  if (reqRow.kind !== "admin_export") return json({ error: "invalid_kind" }, 422);

  // Handle decline branch first.
  if (decline) {
    const { error: declineErr } = await admin.rpc("atomic_export_transition", {
      p_request_id: request_id,
      p_expected_from: "awaiting_approval",
      p_new_status: "blocked_or_declined",
      p_patch: { block_reason: decline_reason ?? "declined_by_approver" },
    });
    if (declineErr) {
      console.error("[admin-export-approve] decline failed:", declineErr);
      return json({ error: "decline_failed", message: declineErr.message }, 409);
    }
    await writeLifecycleAudit(
      admin,
      DATA_010_AUDIT_ACTIONS.blocked_or_declined,
      {
        actor_user_id: approver.id,
        request_id,
        reason: decline_reason ?? "declined_by_approver",
        approver_user_id: approver.id,
      },
      reqRow.target_org_id,
      request_id,
    );
    return json({ ok: true, request_id, status: "blocked_or_declined" });
  }

  // Server-side self-approval guard (DB trigger is the authoritative one).
  if (approver.id === reqRow.requester_user_id) {
    await writeLifecycleAudit(
      admin,
      DATA_010_AUDIT_ACTIONS.blocked_or_declined,
      {
        actor_user_id: approver.id,
        request_id,
        reason: "self_approval_blocked",
        approver_user_id: approver.id,
        requester_user_id: reqRow.requester_user_id,
      },
      reqRow.target_org_id,
      request_id,
    );
    return json({ error: "self_approval_not_allowed", code: "SELF_APPROVAL_BLOCKED" }, 409);
  }

  const { data: approved, error: apprErr } = await admin.rpc("approve_admin_export", {
    p_request_id: request_id,
    p_approver_user_id: approver.id,
    p_approval_method: approval_method,
  });
  if (apprErr) {
    console.error("[admin-export-approve] approve rpc failed:", apprErr);
    return json({ error: "approve_failed", message: apprErr.message }, 409);
  }

  await writeLifecycleAudit(
    admin,
    DATA_010_AUDIT_ACTIONS.approved,
    {
      actor_user_id: approver.id,
      request_id,
      approver_user_id: approver.id,
      requester_user_id: reqRow.requester_user_id,
      approval_method,
    },
    reqRow.target_org_id,
    request_id,
  );

  return json({
    ok: true,
    request_id,
    status: "export_preparation_required",
    approval: approved?.approval ?? null,
  });
});
