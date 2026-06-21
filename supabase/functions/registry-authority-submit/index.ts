// Batch 12 — registry-authority-submit
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "../_shared/cors.ts";
import {
  getAuthorityRequirements,
  REGISTRY_AUTHORITY_SCOPES,
  REGISTRY_AUTHORITY_SENSITIVE_SCOPES,
  type RegistryAuthorityScope,
  type RegistryAuthorityEvidenceCategory,
} from "../_shared/registry-authority-workflow.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: userData } = await supabase.auth.getUser(req.headers.get("Authorization")?.replace("Bearer ", "") ?? "");
    const user = userData?.user;
    if (!user || !user.email_confirmed_at) {
      return new Response(JSON.stringify({ error: "email_verification_required" }), { status: 403, headers: corsHeaders });
    }
    const { authority_request_id, declaration_acknowledged } = await req.json();

    const { data: ar } = await supabase.from("registry_authority_requests").select("*").eq("id", authority_request_id).maybeSingle();
    if (!ar || ar.requester_user_id !== user.id) {
      return new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: corsHeaders });
    }
    if (!declaration_acknowledged) {
      return new Response(JSON.stringify({ error: "declaration_required" }), { status: 400, headers: corsHeaders });
    }
    const scopes = (ar.requested_scopes ?? []) as RegistryAuthorityScope[];
    if (!scopes.length) {
      return new Response(JSON.stringify({ error: "scope_required" }), { status: 400, headers: corsHeaders });
    }
    for (const s of scopes) {
      if (!REGISTRY_AUTHORITY_SCOPES.includes(s)) {
        return new Response(JSON.stringify({ error: `invalid_scope:${s}` }), { status: 400, headers: corsHeaders });
      }
    }

    const { data: evidence } = await supabase.from("registry_authority_evidence")
      .select("evidence_category").eq("authority_request_id", authority_request_id);
    const present = (evidence ?? []).map((e: any) => e.evidence_category as RegistryAuthorityEvidenceCategory);

    const requirements = getAuthorityRequirements({
      countryCode: ar.country_code,
      approvedClaimType: ar.claim_id ? "approved" : null,
      claimantType: "listed_director",
      requestedScopes: scopes,
      claimantListedInRegistryPeople: false,
      claimantIsProfessionalRepresentative: false,
      mandateEvidencePresent: present.includes("company_mandate"),
      presentEvidenceCategories: present,
      companyLifecycleState: "active",
      claimConflictActive: false,
    });
    if (!requirements.canSubmit) {
      return new Response(JSON.stringify({ error: "requirements_not_met", requirements }), { status: 400, headers: corsHeaders });
    }

    const isSensitive = scopes.some((s) => REGISTRY_AUTHORITY_SENSITIVE_SCOPES.includes(s));
    const twoPersonRequired = scopes.includes("authority_delegation_request");

    await supabase.from("registry_authority_requests").update({
      status: "submitted",
      declaration_acknowledged: true,
      submitted_at: new Date().toISOString(),
      is_sensitive: isSensitive,
      two_person_required: twoPersonRequired,
      last_activity_at: new Date().toISOString(),
    }).eq("id", authority_request_id);

    for (const s of scopes) {
      await supabase.from("registry_authority_request_scopes").upsert({
        authority_request_id, scope_code: s, is_sensitive: REGISTRY_AUTHORITY_SENSITIVE_SCOPES.includes(s),
        status: "requested",
      }, { onConflict: "authority_request_id,scope_code" });
    }

    await supabase.from("registry_authority_events").insert({
      authority_request_id, audit_event_name: "registry_authority_submitted",
      previous_status: ar.status, new_status: "submitted", actor_id: user.id,
      payload: { scopes, is_sensitive: isSensitive, two_person_required: twoPersonRequired },
    });

    return new Response(JSON.stringify({ ok: true, requirements }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message ?? e) }), { status: 500, headers: corsHeaders });
  }
});
