// Batch 12 — registry-authority-dispute-manage
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "../_shared/cors.ts";
import { REGISTRY_AUTHORITY_DISPUTE_OUTCOMES } from "../_shared/registry-authority-workflow.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: userData } = await supabase.auth.getUser(req.headers.get("Authorization")?.replace("Bearer ", "") ?? "");
    const user = userData?.user;
    if (!user) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: corsHeaders });
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
    const isAdmin = (roles ?? []).some((r: any) => ["platform_admin","compliance_owner"].includes(r.role));
    if (!isAdmin) return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: corsHeaders });

    const { authority_request_id, action, reason, outcome } = await req.json();
    if (action === "open") {
      if (!reason) return new Response(JSON.stringify({ error: "reason_required" }), { status: 400, headers: corsHeaders });
      await supabase.from("registry_authority_disputes").insert({
        authority_request_id, opened_by: user.id, reason, status: "open",
      });
      await supabase.from("registry_authority_requests").update({
        status: "disputed", disputed_at: new Date().toISOString(), dispute_reason: reason, last_activity_at: new Date().toISOString(),
      }).eq("id", authority_request_id);
      // Suspend sensitive scopes in active cache
      await supabase.rpc("noop_placeholder", {}).catch(() => null);
      const { data: ar } = await supabase.from("registry_authority_requests").select("requester_user_id,company_reference").eq("id", authority_request_id).maybeSingle();
      if (ar) {
        await supabase.from("registry_active_authorities").update({ suspended_at: new Date().toISOString(), status: "suspended", updated_at: new Date().toISOString() })
          .eq("user_id", ar.requester_user_id).eq("company_reference", ar.company_reference);
      }
      await supabase.from("registry_authority_events").insert({
        authority_request_id, audit_event_name: "registry_authority_disputed", new_status: "disputed", actor_id: user.id, reason,
      });
      return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (action === "resolve") {
      if (!REGISTRY_AUTHORITY_DISPUTE_OUTCOMES.includes(outcome)) {
        return new Response(JSON.stringify({ error: "invalid_outcome" }), { status: 400, headers: corsHeaders });
      }
      await supabase.from("registry_authority_disputes").update({
        status: "resolved", resolved_at: new Date().toISOString(), resolved_by: user.id, resolution: outcome,
      }).eq("authority_request_id", authority_request_id).eq("status", "open");
      await supabase.from("registry_authority_events").insert({
        authority_request_id, audit_event_name: "registry_authority_dispute_resolved", actor_id: user.id, reason: reason ?? null,
        payload: { outcome },
      });
      return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ error: "invalid_action" }), { status: 400, headers: corsHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message ?? e) }), { status: 500, headers: corsHeaders });
  }
});
