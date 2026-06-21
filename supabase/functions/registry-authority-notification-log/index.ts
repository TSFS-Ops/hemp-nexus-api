// Batch 12 — registry-authority-notification-log
// LOG-ONLY in-app notification recorder. No external send.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "../_shared/cors.ts";
import { REGISTRY_AUTHORITY_B12_AUDIT_EVENT_NAMES } from "../_shared/registry-authority-workflow.ts";

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

    const { authority_request_id, recipient_user_id, event_name, body } = await req.json();
    if (!REGISTRY_AUTHORITY_B12_AUDIT_EVENT_NAMES.includes(event_name)) {
      return new Response(JSON.stringify({ error: "invalid_event" }), { status: 400, headers: corsHeaders });
    }
    if (!body || !recipient_user_id) {
      return new Response(JSON.stringify({ error: "missing_fields" }), { status: 400, headers: corsHeaders });
    }
    // sent_externally: false — this batch must not trigger real email/SMS/WhatsApp.
    const { data: ins, error } = await supabase.from("registry_authority_status_notifications").insert({
      authority_request_id, recipient_user_id, event_name, body, sent_externally: false,
    }).select().single();
    if (error) throw error;
    await supabase.from("registry_authority_events").insert({
      authority_request_id, audit_event_name: "registry_authority_notification_logged",
      actor_id: user.id, payload: { notification_id: ins.id, recipient_user_id, event_name },
    });
    return new Response(JSON.stringify({ ok: true, notification_id: ins.id, sent_externally: false }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message ?? e) }), { status: 500, headers: corsHeaders });
  }
});
