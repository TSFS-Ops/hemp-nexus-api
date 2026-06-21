// Public API V1 · Sandprod Batch 3 — Production access approval workflow.
//
// platform_admin-only, AAL2-gated. Records platform_admin approval,
// commercial_owner sign-off, compliance_owner sign-off, rejection, and
// reset events into the append-only api_production_approvals register
// and updates the matching dual sign-off fields on api_clients.
//
// This function NEVER:
//   • mutates raw API key secrets,
//   • bypasses the production checklist trigger on api_clients,
//   • writes UPDATE/DELETE to api_production_approvals (DB trigger blocks it).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { ApiException, errorResponse, handleDatabaseError } from "../_shared/errors.ts";
import { authenticateRequest, requireRole } from "../_shared/auth.ts";
import { deriveActorIds } from "../_shared/actor-context.ts";
import { assertAal2 } from "../_shared/aal.ts";

type Action =
  | "platform_admin_approve"
  | "commercial_owner_sign_off"
  | "compliance_owner_sign_off"
  | "reject_production_access"
  | "reset_production_approval";

const APPROVED_ROLE_BY_ACTION: Record<Action, string> = {
  platform_admin_approve: "platform_admin",
  commercial_owner_sign_off: "commercial_owner",
  compliance_owner_sign_off: "compliance_owner",
  reject_production_access: "platform_admin",
  reset_production_approval: "platform_admin",
};

const APPROVAL_EVENT_BY_ACTION: Record<Action, string> = {
  platform_admin_approve: "platform_admin_approved",
  commercial_owner_sign_off: "commercial_owner_signed_off",
  compliance_owner_sign_off: "compliance_owner_signed_off",
  reject_production_access: "rejected",
  reset_production_approval: "revoked",
};

const AUDIT_NAME_BY_ACTION: Record<Action, string> = {
  platform_admin_approve: "api.production_access.platform_admin_approved",
  commercial_owner_sign_off: "api.production_access.commercial_owner_signed_off",
  compliance_owner_sign_off: "api.production_access.compliance_owner_signed_off",
  reject_production_access: "api.production_access.rejected",
  reset_production_approval: "api.production_access.reset",
};

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  const allowedOrigins = Deno.env.get("ALLOWED_ORIGINS") || '';
  const origin = req.headers.get("origin");
  const headers = corsHeaders(allowedOrigins, origin);

  try {
    const corsResp = handleCors(req, allowedOrigins);
    if (corsResp) return corsResp;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const authCtx = await authenticateRequest(req, supabaseUrl, supabaseKey);
    requireRole(authCtx, "platform_admin");
    await assertAal2(req.headers.get("authorization"), {
      adminClient: supabase,
      callerUserId: authCtx.userId ?? null,
      action: "admin.api_production_approve",
    });

    const { actorUserId } = deriveActorIds(authCtx);
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const action = body.action as Action | undefined;
    const api_client_id = body.api_client_id as string | undefined;
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    const approved_scopes = Array.isArray(body.approved_scopes)
      ? (body.approved_scopes as string[]).filter((s) => typeof s === "string")
      : null;

    if (!action || !APPROVAL_EVENT_BY_ACTION[action]) {
      throw new ApiException("VALIDATION_ERROR", "Unknown action", 400);
    }
    if (!api_client_id) {
      throw new ApiException("VALIDATION_ERROR", "api_client_id required", 400);
    }
    if ((action === "reject_production_access" || action === "reset_production_approval") && reason.length < 10) {
      throw new ApiException("VALIDATION_ERROR", "Reason (min 10 chars) required for reject/reset.", 400);
    }

    // Fetch client to validate checklist state where relevant.
    const { data: client, error: fetchErr } = await supabase
      .from("api_clients")
      .select("*")
      .eq("id", api_client_id)
      .single();
    if (fetchErr || !client) throw new ApiException("NOT_FOUND", "api_client not found", 404);

    // Checklist required for any positive approval action.
    if (action === "platform_admin_approve"
        || action === "commercial_owner_sign_off"
        || action === "compliance_owner_sign_off") {
      const checklistOk =
        client.signed_api_agreement_confirmed &&
        client.commercial_plan_approved &&
        client.sandbox_checklist_completed &&
        client.production_scopes_approved &&
        client.production_technical_contact_confirmed &&
        client.billing_details_confirmed &&
        client.retention_rules_confirmed &&
        client.security_contact_confirmed &&
        client.sandbox_approved;
      if (!checklistOk) {
        await supabase.from("audit_logs").insert({
          org_id: client.org_id ?? null,
          actor_user_id: actorUserId,
          action: "api.production_access.checklist_failed",
          entity_type: "api_client",
          entity_id: api_client_id,
          metadata: { request_id: requestId, attempted_action: action },
        });
        throw new ApiException("CHECKLIST_INCOMPLETE",
          "Production checklist is incomplete on the api_client.", 409);
      }
    }

    // Insert append-only approval row.
    const { error: insertErr } = await supabase
      .from("api_production_approvals")
      .insert({
        api_client_id,
        approval_event: APPROVAL_EVENT_BY_ACTION[action],
        approved_role: APPROVED_ROLE_BY_ACTION[action],
        actor_user_id: actorUserId,
        approved_scopes,
        notes: reason || null,
        metadata: { request_id: requestId },
      });
    if (insertErr) handleDatabaseError(insertErr, requestId);

    // Update matching field(s) on api_clients.
    const nowIso = new Date().toISOString();
    const patch: Record<string, unknown> = {};
    switch (action) {
      case "platform_admin_approve":
        patch.production_approved_by = actorUserId;
        patch.production_approved_at = nowIso;
        break;
      case "commercial_owner_sign_off":
        patch.commercial_owner_sign_off_by = actorUserId;
        patch.commercial_owner_sign_off_at = nowIso;
        break;
      case "compliance_owner_sign_off":
        patch.compliance_owner_sign_off_by = actorUserId;
        patch.compliance_owner_sign_off_at = nowIso;
        break;
      case "reject_production_access":
        patch.production_approved = false;
        patch.production_approved_by = null;
        patch.production_approved_at = null;
        break;
      case "reset_production_approval":
        patch.production_approved = false;
        patch.production_approved_by = null;
        patch.production_approved_at = null;
        patch.commercial_owner_sign_off_by = null;
        patch.commercial_owner_sign_off_at = null;
        patch.compliance_owner_sign_off_by = null;
        patch.compliance_owner_sign_off_at = null;
        break;
    }
    if (Object.keys(patch).length > 0) {
      const { error: updErr } = await supabase
        .from("api_clients").update(patch).eq("id", api_client_id);
      if (updErr) handleDatabaseError(updErr, requestId);
    }

    // Flip production_approved=true ONLY when all three are recorded and
    // checklist is complete. The api_clients trigger validates checklist;
    // we just propose the flag here.
    if (action === "platform_admin_approve"
        || action === "commercial_owner_sign_off"
        || action === "compliance_owner_sign_off") {
      const { data: refreshed } = await supabase
        .from("api_clients")
        .select("commercial_owner_sign_off_at, compliance_owner_sign_off_at, production_approved_at, production_approved")
        .eq("id", api_client_id).single();
      if (refreshed
          && refreshed.commercial_owner_sign_off_at
          && refreshed.compliance_owner_sign_off_at
          && refreshed.production_approved_at
          && refreshed.production_approved !== true) {
        const { error: flipErr } = await supabase
          .from("api_clients")
          .update({ production_approved: true })
          .eq("id", api_client_id);
        if (!flipErr) {
          await supabase.from("api_production_approvals").insert({
            api_client_id,
            approval_event: "fully_approved",
            approved_role: "system",
            actor_user_id: actorUserId,
            metadata: { request_id: requestId },
          });
          await supabase.from("audit_logs").insert({
            org_id: client.org_id ?? null,
            actor_user_id: actorUserId,
            action: "api.production_access.approved",
            entity_type: "api_client",
            entity_id: api_client_id,
            metadata: { request_id: requestId },
          });
        }
      }
    }

    await supabase.from("audit_logs").insert({
      org_id: client.org_id ?? null,
      actor_user_id: actorUserId,
      action: AUDIT_NAME_BY_ACTION[action],
      entity_type: "api_client",
      entity_id: api_client_id,
      metadata: { request_id: requestId, reason: reason || null },
    });

    return new Response(JSON.stringify({ ok: true, action, api_client_id }), {
      status: 200, headers: { "Content-Type": "application/json", ...headers },
    });
  } catch (error) {
    return errorResponse(error as Error, requestId, headers);
  }
});
