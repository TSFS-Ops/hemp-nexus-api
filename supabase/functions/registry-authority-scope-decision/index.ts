// Batch 12 — registry-authority-scope-decision (per-scope decision; populates active authority on approval)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "../_shared/cors.ts";
import {
  REGISTRY_AUTHORITY_SCOPE_DECISION_STATES,
  REGISTRY_AUTHORITY_SENSITIVE_SCOPES,
  REGISTRY_AUTHORITY_DEFAULT_EXPIRY_DAYS,
  REGISTRY_AUTHORITY_DELEGATION_SCOPE,
  REGISTRY_AUTHORITY_B12_APPROVAL_ACKNOWLEDGEMENT,
  reduceAuthorityStatusFromScopeDecisions,
  type RegistryAuthorityScope,
} from "../_shared/registry-authority-workflow.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: userData } = await supabase.auth.getUser(req.headers.get("Authorization")?.replace("Bearer ", "") ?? "");
    const user = userData?.user;
    if (!user) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: corsHeaders });
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
    const userRoles = (roles ?? []).map((r: any) => r.role);
    const isAdmin = userRoles.some((r: string) => ["platform_admin", "compliance_owner"].includes(r));
    if (!isAdmin) return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: corsHeaders });

    const { authority_request_id, scope_code, decision, rationale, evidence_basis, acknowledgement, second_reviewer_id } = await req.json();
    if (!REGISTRY_AUTHORITY_SCOPE_DECISION_STATES.includes(decision)) {
      return new Response(JSON.stringify({ error: "invalid_decision" }), { status: 400, headers: corsHeaders });
    }
    if (!rationale) return new Response(JSON.stringify({ error: "rationale_required" }), { status: 400, headers: corsHeaders });

    const isSensitive = REGISTRY_AUTHORITY_SENSITIVE_SCOPES.includes(scope_code as RegistryAuthorityScope);
    const isDelegation = scope_code === REGISTRY_AUTHORITY_DELEGATION_SCOPE;
    if (decision === "approved" && isSensitive && !userRoles.includes("compliance_owner")) {
      return new Response(JSON.stringify({ error: "compliance_review_required" }), { status: 403, headers: corsHeaders });
    }
    if (decision === "approved" && isDelegation && !second_reviewer_id) {
      return new Response(JSON.stringify({ error: "two_person_approval_required" }), { status: 403, headers: corsHeaders });
    }
    if (decision === "approved" && acknowledgement !== REGISTRY_AUTHORITY_B12_APPROVAL_ACKNOWLEDGEMENT) {
      return new Response(JSON.stringify({ error: "acknowledgement_required" }), { status: 400, headers: corsHeaders });
    }

    const expiryDays = REGISTRY_AUTHORITY_DEFAULT_EXPIRY_DAYS[scope_code as RegistryAuthorityScope] ?? 90;
    const expiryAt = decision === "approved" ? new Date(Date.now() + expiryDays * 86400000).toISOString() : null;

    await supabase.from("registry_authority_scope_decisions").insert({
      authority_request_id, scope_code, decision,
      reviewer_id: user.id,
      reviewer_role: userRoles.includes("compliance_owner") ? "compliance_owner" : "platform_admin",
      rationale, evidence_basis: evidence_basis ?? null,
      expiry_at: expiryAt,
      acknowledged_not_company_verification: decision === "approved",
      acknowledged_not_bank_verification: decision === "approved",
    });

    await supabase.from("registry_authority_request_scopes").update({
      status: decision, updated_at: new Date().toISOString(),
    }).eq("authority_request_id", authority_request_id).eq("scope_code", scope_code);

    // Update derived active authority cache on approve / revoke / expire / suspend
    const { data: ar } = await supabase.from("registry_authority_requests")
      .select("requester_user_id,company_reference").eq("id", authority_request_id).maybeSingle();
    if (ar && decision === "approved") {
      await supabase.from("registry_active_authorities").upsert({
        authority_request_id, user_id: ar.requester_user_id, company_reference: ar.company_reference,
        scope_code, status: "active", expiry_at: expiryAt, approved_at: new Date().toISOString(),
      }, { onConflict: "user_id,company_reference,scope_code" });
    } else if (ar && ["suspended","revoked","expired","rejected"].includes(decision)) {
      await supabase.from("registry_active_authorities").update({
        status: decision === "rejected" ? "revoked" : decision,
        suspended_at: decision === "suspended" ? new Date().toISOString() : null,
        revoked_at: decision === "revoked" || decision === "rejected" ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      }).eq("user_id", ar.requester_user_id).eq("company_reference", ar.company_reference).eq("scope_code", scope_code);
    }

    await supabase.from("registry_authority_events").insert({
      authority_request_id,
      audit_event_name: decision === "approved" ? "registry_authority_scope_approved" : "registry_authority_scope_rejected",
      new_status: decision, actor_id: user.id, reason: rationale,
      payload: { scope_code, expiry_at: expiryAt, sensitive: isSensitive, delegation: isDelegation },
    });

    // Reduce overall status
    const { data: allDecisions } = await supabase.from("registry_authority_scope_decisions")
      .select("decision,scope_code").eq("authority_request_id", authority_request_id);
    // dedupe by scope, keeping latest by id ordering (created_at desc not enforced here — sufficient for SSOT signal)
    const overall = reduceAuthorityStatusFromScopeDecisions(allDecisions ?? []);
    await supabase.from("registry_authority_requests").update({
      status: overall, last_activity_at: new Date().toISOString(),
    }).eq("id", authority_request_id);

    return new Response(JSON.stringify({ ok: true, overall_status: overall, expiry_at: expiryAt }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message ?? e) }), { status: 500, headers: corsHeaders });
  }
});
