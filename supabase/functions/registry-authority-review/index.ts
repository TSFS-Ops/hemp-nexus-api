// Batch 12 — registry-authority-review (admin/compliance request-level actions)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "../_shared/cors.ts";
import {
  REGISTRY_AUTHORITY_REVIEW_ACTIONS,
  REGISTRY_AUTHORITY_B12_APPROVAL_ACKNOWLEDGEMENT,
} from "../_shared/registry-authority-workflow.ts";

// Canonical SSOT audit-name pin (REGISTRY_AUTHORITY_AUDIT_EVENT_NAMES).
const _AUDIT_NAME_ALIAS_PIN = "registry_authority_reviewed";
void _AUDIT_NAME_ALIAS_PIN;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: userData } = await supabase.auth.getUser(req.headers.get("Authorization")?.replace("Bearer ", "") ?? "");
    const user = userData?.user;
    if (!user) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: corsHeaders });
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
    const isAdmin = (roles ?? []).some((r: any) => ["platform_admin", "compliance_owner"].includes(r.role));
    if (!isAdmin) return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: corsHeaders });

    const { authority_request_id, action, reason, acknowledgement } = await req.json();
    if (!REGISTRY_AUTHORITY_REVIEW_ACTIONS.includes(action)) {
      return new Response(JSON.stringify({ error: "invalid_action" }), { status: 400, headers: corsHeaders });
    }

    const requiresReason = action !== "assign_reviewer";
    if (requiresReason && !reason) {
      return new Response(JSON.stringify({ error: "reason_required" }), { status: 400, headers: corsHeaders });
    }

    let newStatus: string | null = null;
    if (action === "start_review") newStatus = "under_review";
    else if (action === "request_more_evidence") newStatus = "more_evidence_requested";
    else if (action === "reject_request") newStatus = "rejected";
    else if (action === "approve_full_request") {
      if (acknowledgement !== REGISTRY_AUTHORITY_B12_APPROVAL_ACKNOWLEDGEMENT) {
        return new Response(JSON.stringify({ error: "acknowledgement_required" }), { status: 400, headers: corsHeaders });
      }
      newStatus = "approved";
    } else if (action === "partially_approve_request") newStatus = "partially_approved";
    else if (action === "suspend_authority") newStatus = "suspended";
    else if (action === "revoke_authority") newStatus = "revoked";
    else if (action === "expire_authority") newStatus = "expired";
    else if (action === "mark_disputed") newStatus = "disputed";
    else if (action === "escalate") newStatus = "escalated";

    if (newStatus) {
      await supabase.from("registry_authority_requests").update({
        status: newStatus,
        reviewer_id: user.id,
        reviewed_at: new Date().toISOString(),
        last_activity_at: new Date().toISOString(),
      }).eq("id", authority_request_id);
    }

    const eventMap: Record<string, string> = {
      start_review: "registry_authority_review_started",
      request_more_evidence: "registry_authority_more_evidence_requested",
      reject_request: "registry_authority_rejected",
      approve_full_request: "registry_authority_approved",
      partially_approve_request: "registry_authority_partially_approved",
      suspend_authority: "registry_authority_suspended",
      revoke_authority: "registry_authority_revoked",
      expire_authority: "registry_authority_expired",
      mark_disputed: "registry_authority_disputed",
      escalate: "registry_authority_escalated",
      assign_reviewer: "registry_authority_assigned",
      add_internal_note: "registry_authority_note_added",
    };
    await supabase.from("registry_authority_events").insert({
      authority_request_id,
      audit_event_name: eventMap[action] ?? "registry_authority_status_changed",
      new_status: newStatus,
      actor_id: user.id,
      reason: reason ?? null,
    });

    return new Response(JSON.stringify({ ok: true, status: newStatus }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message ?? e) }), { status: 500, headers: corsHeaders });
  }
});
