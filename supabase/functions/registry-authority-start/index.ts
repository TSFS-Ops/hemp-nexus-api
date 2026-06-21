// Batch 12 — registry-authority-start
// Starts an authority-to-act request for an approved claim, or admin-initiated.
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace("Bearer ", "");
    const { data: userData } = await supabase.auth.getUser(jwt);
    const user = userData?.user;
    if (!user) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: corsHeaders });

    const body = await req.json();
    const { claim_id, company_reference, company_name, country_code, requested_scopes, admin_initiated_reason } = body ?? {};
    if (!company_reference || !company_name || !country_code) {
      return new Response(JSON.stringify({ error: "missing fields" }), { status: 400, headers: corsHeaders });
    }

    // Verify approved claim unless admin override
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
    const isAdmin = (roles ?? []).some((r: any) => ["platform_admin", "compliance_owner"].includes(r.role));
    if (!claim_id && !(isAdmin && admin_initiated_reason)) {
      return new Response(JSON.stringify({ error: "approved_claim_required" }), { status: 403, headers: corsHeaders });
    }
    if (claim_id) {
      const { data: claim } = await supabase.from("registry_company_claims").select("id,status,user_id").eq("id", claim_id).maybeSingle();
      if (!claim || claim.status !== "approved") {
        return new Response(JSON.stringify({ error: "approved_claim_required" }), { status: 403, headers: corsHeaders });
      }
    }

    const { data: ins, error } = await supabase.from("registry_authority_requests").insert({
      requester_user_id: user.id,
      claim_id: claim_id ?? null,
      company_reference,
      company_name,
      country_code,
      authority_basis: "representative_declaration",
      status: "draft",
      requested_scopes: Array.isArray(requested_scopes) ? requested_scopes : [],
      is_sensitive: false,
      declaration_acknowledged: false,
    }).select().single();
    if (error) throw error;

    await supabase.from("registry_authority_events").insert({
      authority_request_id: ins.id,
      audit_event_name: "registry_authority_started",
      new_status: "draft",
      actor_id: user.id,
      reason: admin_initiated_reason ?? null,
      payload: { admin_initiated: !!admin_initiated_reason },
    });

    return new Response(JSON.stringify({ ok: true, authority_request_id: ins.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message ?? e) }), { status: 500, headers: corsHeaders });
  }
});
