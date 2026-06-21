// Batch 12 — registry-authority-status (requester read of own authority request)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: userData } = await supabase.auth.getUser(req.headers.get("Authorization")?.replace("Bearer ", "") ?? "");
    const user = userData?.user;
    if (!user) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: corsHeaders });
    const { authority_request_id } = await req.json();
    const { data: ar } = await supabase.from("registry_authority_requests").select("*").eq("id", authority_request_id).maybeSingle();
    if (!ar || ar.requester_user_id !== user.id) {
      return new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: corsHeaders });
    }
    const [{ data: scopes }, { data: decisions }, { data: notifications }] = await Promise.all([
      supabase.from("registry_authority_request_scopes").select("*").eq("authority_request_id", authority_request_id),
      supabase.from("registry_authority_scope_decisions").select("*").eq("authority_request_id", authority_request_id),
      supabase.from("registry_authority_status_notifications").select("event_name,body,created_at").eq("authority_request_id", authority_request_id).eq("recipient_user_id", user.id),
    ]);
    return new Response(JSON.stringify({ authority: ar, scopes, decisions, notifications }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message ?? e) }), { status: 500, headers: corsHeaders });
  }
});
