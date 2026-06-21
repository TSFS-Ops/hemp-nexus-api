/**
 * registry-record-lifecycle-manage
 * --------------------------------
 * Batch 10 — Admin/compliance-gated lifecycle transitions.
 * Enforces transition matrix, requires reason, role check, AAL2,
 * audits applied/blocked transitions and writes lifecycle event row.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { errorResponse, ApiException } from "../_shared/errors.ts";
import { authenticateRequest, requireRole } from "../_shared/auth.ts";
import { assertAal2 } from "../_shared/aal.ts";
import {
  isAllowedLifecycleTransition,
  REGISTRY_LIFECYCLE_APPROVAL_ROLES,
  REGISTRY_RECORD_LIFECYCLE_STATES,
  type RegistryRecordLifecycleState,
} from "../_shared/registry-record-lifecycle.ts";

Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID();
  const allowed = Deno.env.get("ALLOWED_ORIGINS") || '';
  const headers = corsHeaders(allowed, req.headers.get("origin"));
  try {
    const cors = handleCors(req, allowed);
    if (cors) return cors;
    if (req.method !== "POST") throw new ApiException("METHOD_NOT_ALLOWED", "Method not allowed", 405);

    const url = Deno.env.get("SUPABASE_URL")!;
    const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(url, svc);

    const auth = await authenticateRequest(req, url, svc);
    if (auth.isApiKey) throw new ApiException("FORBIDDEN", "API keys cannot manage lifecycle", 403);

    const hasRole = REGISTRY_LIFECYCLE_APPROVAL_ROLES.some((r) => auth.roles?.includes(r));
    if (!hasRole) throw new ApiException("FORBIDDEN", "Requires platform_admin or compliance_owner", 403);

    await assertAal2(req.headers.get("Authorization"), {
      adminClient: supabase,
      callerUserId: auth.userId,
      action: "registry.record_lifecycle.manage",
    });

    const body = await req.json().catch(() => ({}));
    const { record_id, next_state, reason, transition_kind } = body as {
      record_id?: string;
      next_state?: string;
      reason?: string;
      transition_kind?: string;
    };
    if (!record_id || !next_state || !reason || reason.trim().length < 10) {
      throw new ApiException("INVALID_INPUT", "record_id, next_state and reason (>=10 chars) required", 400);
    }
    if (!REGISTRY_RECORD_LIFECYCLE_STATES.includes(next_state as RegistryRecordLifecycleState)) {
      throw new ApiException("INVALID_INPUT", "Unknown next_state", 400);
    }

    const { data: rec } = await supabase
      .from("registry_company_records")
      .select("id, lifecycle_state, claim_activation_state")
      .eq("id", record_id)
      .maybeSingle();
    if (!rec) throw new ApiException("NOT_FOUND", "record not found", 404);

    const from = rec.lifecycle_state as RegistryRecordLifecycleState;
    const to = next_state as RegistryRecordLifecycleState;

    if (!isAllowedLifecycleTransition(from, to)) {
      await supabase.from("audit_logs").insert({
        action: "registry_record_lifecycle_transition_blocked",
        actor_user_id: auth.userId,
        metadata: { request_id: requestId, record_id, from, to, reason },
      });
      throw new ApiException("INVALID_TRANSITION", `Transition ${from} → ${to} not allowed`, 422);
    }

    // Build patch.
    const patch: Record<string, unknown> = { lifecycle_state: to, updated_at: new Date().toISOString() };
    const now = new Date().toISOString();
    if (to === "claim_enabled") {
      patch.claim_activation_state = "claim_enabled";
      patch.claim_allowed = true;
      patch.claim_enabled_at = now;
      patch.claim_enabled_by = auth.userId;
    } else if (to === "claim_suspended") {
      patch.claim_activation_state = "claim_suspended";
      patch.claim_allowed = false;
      patch.claim_suspended_at = now;
      patch.claim_suspended_by = auth.userId;
    } else if (to === "claim_conflict_locked") {
      patch.claim_activation_state = "claim_conflict_locked";
      patch.claim_allowed = false;
    } else if (to === "claim_pending_business_decision") {
      patch.claim_activation_state = "claim_pending_business_decision";
      patch.claim_allowed = false;
    } else if (to === "disabled") {
      patch.disabled_at = now;
      patch.disabled_by = auth.userId;
      patch.public_display_allowed = false;
      patch.claim_allowed = false;
    } else if (to === "archived") {
      patch.archived_at = now;
      patch.archived_by = auth.userId;
      patch.public_display_allowed = false;
      patch.claim_allowed = false;
    }

    await supabase.from("registry_company_records").update(patch).eq("id", record_id);
    await supabase.from("registry_company_record_lifecycle_events").insert({
      record_id,
      previous_state: from,
      next_state: to,
      transition_kind: transition_kind ?? "admin_manual",
      reason,
      actor_user_id: auth.userId,
      actor_role: auth.roles?.[0] ?? null,
    });
    await supabase.from("audit_logs").insert({
      action: "registry_record_lifecycle_transition_applied",
      actor_user_id: auth.userId,
      metadata: { request_id: requestId, record_id, from, to },
    });

    // Specialised audits.
    if (to === "claim_enabled" && from !== "claim_suspended") {
      await supabase.from("audit_logs").insert({
        action: "registry_claim_activation_approved",
        actor_user_id: auth.userId,
        metadata: { request_id: requestId, record_id },
      });
    } else if (to === "claim_enabled" && from === "claim_suspended") {
      await supabase.from("audit_logs").insert({
        action: "registry_claim_activation_reenabled",
        actor_user_id: auth.userId,
        metadata: { request_id: requestId, record_id },
      });
    } else if (to === "claim_suspended") {
      await supabase.from("audit_logs").insert({
        action: "registry_claim_activation_suspended",
        actor_user_id: auth.userId,
        metadata: { request_id: requestId, record_id },
      });
    } else if (to === "disabled") {
      await supabase.from("audit_logs").insert({
        action: "registry_record_disabled",
        actor_user_id: auth.userId,
        metadata: { request_id: requestId, record_id },
      });
    } else if (to === "archived") {
      await supabase.from("audit_logs").insert({
        action: "registry_record_archived",
        actor_user_id: auth.userId,
        metadata: { request_id: requestId, record_id },
      });
    }

    return new Response(
      JSON.stringify({ ok: true, from, to, requestId }),
      { status: 200, headers: { ...headers, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error(`[${requestId}] registry-record-lifecycle-manage error`, err);
    return errorResponse(err as Error, requestId, headers);
  }
});
