/**
 * notification-channel-readiness-update — Phase 1 label-only update.
 *
 * The DB trigger blocks any attempt to enable live sending, test sends, or
 * activate SMS/WhatsApp. This endpoint only allows platform_admin to:
 *   - update the human-readable safe_label for a channel
 *   - flip status between not_configured ↔ disabled for sms/whatsapp
 *
 * It NEVER calls any external provider, NEVER stores credentials, NEVER
 * configures webhooks, NEVER sends a test message.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, handleCors } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  const allowed = Deno.env.get("ALLOWED_ORIGINS") || "*";
  const headers = corsHeaders(allowed, req.headers.get("origin"));
  const pre = handleCors(req, allowed);
  if (pre) return pre;

  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const token = (req.headers.get("authorization") || "").replace("Bearer ", "");
    const { data: userRes } = await sb.auth.getUser(token);
    if (!userRes?.user) {
      return new Response(JSON.stringify({ error: "unauthenticated" }), { status: 401, headers: { ...headers, "Content-Type": "application/json" } });
    }
    const { data: roles } = await sb.from("user_roles").select("role").eq("user_id", userRes.user.id);
    const isAdmin = (roles ?? []).some((r: any) => r.role === "platform_admin");
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { ...headers, "Content-Type": "application/json" } });
    }

    const body = await req.json().catch(() => ({}));
    const { channel, safe_label, status } = body ?? {};
    if (!channel || !["in_app", "email", "sms", "whatsapp"].includes(channel)) {
      return new Response(JSON.stringify({ error: "invalid_channel" }), { status: 400, headers: { ...headers, "Content-Type": "application/json" } });
    }

    const patch: Record<string, unknown> = { updated_by: userRes.user.id };
    if (typeof safe_label === "string" && safe_label.length > 0 && safe_label.length <= 240) {
      patch.safe_label = safe_label;
    }
    if (status && ["not_configured", "disabled"].includes(status) && (channel === "sms" || channel === "whatsapp")) {
      patch.status = status;
    }
    // Explicit Phase 1 hard guard — never accept these from clients
    if ("live_sending_enabled" in body || "test_send_enabled" in body || "credentials_status" in body || "webhook_status" in body) {
      return new Response(JSON.stringify({ error: "phase_1_locked", message: "Live sending, test send, credentials and webhooks cannot be enabled in Phase 1." }), { status: 400, headers: { ...headers, "Content-Type": "application/json" } });
    }

    const { data, error } = await sb
      .from("notification_channel_readiness")
      .update(patch)
      .eq("channel", channel)
      .select()
      .maybeSingle();
    if (error) throw error;

    await sb.from("audit_logs").insert({
      org_id: "00000000-0000-0000-0000-000000000000",
      action: "notification_channel_readiness_label_updated",
      entity_type: "notification_channel_readiness",
      entity_id: data?.id,
      metadata: { channel, patch, actor: userRes.user.id, phase: 1 },
    });

    return new Response(JSON.stringify({ ok: true, channel: data }), {
      headers: { ...headers, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }
});
