// Batch 12 — registry-authority-active-check
// Server-side gate used by sensitive future flows (bank submit, user management).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "../_shared/cors.ts";
import {
  checkActiveAuthority,
  REGISTRY_AUTHORITY_SCOPES,
  type RegistryAuthorityScope,
} from "../_shared/registry-authority-workflow.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: userData } = await supabase.auth.getUser(req.headers.get("Authorization")?.replace("Bearer ", "") ?? "");
    const user = userData?.user;
    if (!user) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: corsHeaders });
    const { company_reference, scope } = await req.json();
    if (!REGISTRY_AUTHORITY_SCOPES.includes(scope)) {
      return new Response(JSON.stringify({ error: "invalid_scope" }), { status: 400, headers: corsHeaders });
    }
    const { data: active } = await supabase.from("registry_active_authorities").select("*")
      .eq("user_id", user.id).eq("company_reference", company_reference).eq("scope_code", scope).maybeSingle();
    const { data: company } = await supabase.from("registry_company_records").select("lifecycle_state")
      .eq("company_reference", company_reference).maybeSingle();
    const { data: conflicts } = await supabase.from("registry_claim_conflicts").select("id")
      .eq("company_reference", company_reference).maybeSingle();

    const result = checkActiveAuthority({
      scope: scope as RegistryAuthorityScope,
      scopeStatus: active ? (active.status === "active" ? "approved" : (active.status as any)) : "not_present",
      authorityStatus: active ? "approved" : "not_present",
      expiryAt: active?.expiry_at ?? null,
      suspended: !!active?.suspended_at,
      revoked: !!active?.revoked_at,
      disputed: false,
      claimConflictActive: !!conflicts,
      companyLifecycleState: company?.lifecycle_state ?? "active",
    });

    await supabase.from("registry_authority_events").insert({
      authority_request_id: active?.authority_request_id ?? null,
      audit_event_name: "registry_authority_active_check_performed",
      actor_id: user.id,
      payload: { company_reference, scope, result },
    });

    return new Response(JSON.stringify({ result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message ?? e) }), { status: 500, headers: corsHeaders });
  }
});
