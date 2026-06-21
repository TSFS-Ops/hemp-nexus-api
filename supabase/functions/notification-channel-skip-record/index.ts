/**
 * notification-channel-skip-record — Phase 1 safe-skip auditor.
 *
 * Any workflow that evaluates SMS/WhatsApp as a candidate channel MUST call
 * this function instead of attempting to send. There is NO send path in
 * Phase 1. The function records a structured skip event, mandates a masked
 * contact identifier (rejects raw phone numbers), and returns the
 * fallback channel the caller should use.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { NOTIFICATION_SKIP_REASONS, looksLikeRawPhone } from "../_shared/notification-channel-readiness.ts";

Deno.serve(async (req) => {
  const allowed = Deno.env.get("ALLOWED_ORIGINS") || '';
  const headers = corsHeaders(allowed, req.headers.get("origin"));
  const pre = handleCors(req, allowed);
  if (pre) return pre;

  // Internal callers: cron key OR service role
  const cronKey = Deno.env.get("INTERNAL_CRON_KEY");
  const provided = req.headers.get("x-internal-key");
  const authHeader = req.headers.get("authorization") || "";
  const isServiceRole = authHeader.includes(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "NEVER_MATCH");
  if ((!cronKey || provided !== cronKey) && !isServiceRole) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...headers, "Content-Type": "application/json" } });
  }

  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const body = await req.json().catch(() => ({}));
    const { channel, reason, source_event_type, target_entity_type, target_entity_id, masked_contact, fallback_channel, template_name, metadata } = body ?? {};

    if (!channel || !["sms", "whatsapp", "email", "in_app"].includes(channel)) {
      return new Response(JSON.stringify({ error: "invalid_channel" }), { status: 400, headers: { ...headers, "Content-Type": "application/json" } });
    }
    if (!reason || !(NOTIFICATION_SKIP_REASONS as readonly string[]).includes(reason)) {
      return new Response(JSON.stringify({ error: "invalid_reason" }), { status: 400, headers: { ...headers, "Content-Type": "application/json" } });
    }
    if (masked_contact && looksLikeRawPhone(masked_contact)) {
      return new Response(JSON.stringify({ error: "masked_contact_required", message: "Raw phone numbers are forbidden in skip audit." }), { status: 400, headers: { ...headers, "Content-Type": "application/json" } });
    }

    const { data, error } = await sb
      .from("notification_channel_skipped_events")
      .insert({
        channel,
        reason,
        source_event_type: source_event_type ?? null,
        target_entity_type: target_entity_type ?? null,
        target_entity_id: target_entity_id ?? null,
        masked_contact: masked_contact ?? null,
        fallback_channel: fallback_channel ?? null,
        template_name: template_name ?? null,
        metadata: metadata ?? {},
      })
      .select()
      .single();
    if (error) throw error;

    await sb.from("audit_logs").insert({
      org_id: "00000000-0000-0000-0000-000000000000",
      action: "notification_channel_skip_recorded",
      entity_type: "notification_channel_skipped_events",
      entity_id: data.id,
      metadata: { channel, reason, provider_message_id: "not_applicable", phase: 1 },
    });

    return new Response(JSON.stringify({ ok: true, skipped: data }), {
      headers: { ...headers, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }
});
