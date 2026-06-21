/**
 * manual-outreach-contact-log — Phase 1 manual contact recorder for
 * unknown-counterparty facilitation cases ONLY.
 *
 * This function does NOT send any SMS or WhatsApp message. It records that
 * an authorised admin/support user made manual contact OUTSIDE the
 * platform. The stored display label always reads:
 *   "Izenzo logged manual contact outside the platform. This is not a
 *    system-sent message."
 *
 * Authorisation: only `platform_admin` or `support_admin` may create.
 * Requester/trader/counterparty users are forbidden by role check.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import {
  MANUAL_OUTREACH_AUTHORISED_ROLES,
  looksLikeRawPhone,
  maskPhone,
} from "../_shared/notification-channel-readiness.ts";

const MANUAL_LABEL =
  "Izenzo logged manual contact outside the platform. This is not a system-sent message.";

Deno.serve(async (req) => {
  const allowed = Deno.env.get("ALLOWED_ORIGINS") || '';
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
    const { data: rolesRows } = await sb.from("user_roles").select("role").eq("user_id", userRes.user.id);
    const roles = (rolesRows ?? []).map((r: any) => r.role as string);
    const actingRole = (MANUAL_OUTREACH_AUTHORISED_ROLES as readonly string[]).find((r) => roles.includes(r));
    if (!actingRole) {
      return new Response(JSON.stringify({ error: "forbidden", message: "Manual outreach logging is restricted to platform_admin/support_admin." }), { status: 403, headers: { ...headers, "Content-Type": "application/json" } });
    }

    const body = await req.json().catch(() => ({}));
    const {
      case_id,
      contact_method,
      manual_channel_used,
      contact_role,
      contact_identifier, // raw — will be masked server-side and never stored
      outcome,
      admin_note,
      next_action,
      engagement_complete,
      evidence_reference,
    } = body ?? {};

    if (!case_id || !contact_method || !manual_channel_used || !contact_role || !outcome) {
      return new Response(JSON.stringify({ error: "missing_required_fields" }), { status: 400, headers: { ...headers, "Content-Type": "application/json" } });
    }
    if (!["sms", "whatsapp", "phone_call", "in_person", "other"].includes(contact_method)) {
      return new Response(JSON.stringify({ error: "invalid_contact_method" }), { status: 400, headers: { ...headers, "Content-Type": "application/json" } });
    }
    if (!contact_identifier || typeof contact_identifier !== "string") {
      return new Response(JSON.stringify({ error: "contact_identifier_required" }), { status: 400, headers: { ...headers, "Content-Type": "application/json" } });
    }

    // Always mask before insert. The DB trigger rejects raw phone numbers.
    const masked = looksLikeRawPhone(contact_identifier) ? maskPhone(contact_identifier) : contact_identifier;

    const { data, error } = await sb
      .from("manual_outreach_contact_logs")
      .insert({
        case_id,
        contact_method,
        manual_channel_used,
        contact_role,
        masked_contact: masked,
        outcome,
        admin_note: admin_note ?? null,
        next_action: next_action ?? null,
        engagement_complete: !!engagement_complete,
        evidence_reference: evidence_reference ?? null,
        display_label: MANUAL_LABEL,
        logged_by: userRes.user.id,
        logged_by_role: actingRole,
      })
      .select()
      .single();
    if (error) throw error;

    await sb.from("audit_logs").insert({
      org_id: "00000000-0000-0000-0000-000000000000",
      action: "manual_outreach_logged",
      entity_type: "manual_outreach_contact_logs",
      entity_id: data.id,
      metadata: {
        case_id,
        contact_method,
        actor: userRes.user.id,
        actor_role: actingRole,
        provider_message_id: "not_applicable",
        phase: 1,
      },
    });

    if (engagement_complete) {
      await sb.from("audit_logs").insert({
        org_id: "00000000-0000-0000-0000-000000000000",
        action: "unknown_counterparty_engagement_confirmed",
        entity_type: "manual_outreach_contact_logs",
        entity_id: data.id,
        metadata: { case_id, actor: userRes.user.id, actor_role: actingRole },
      });
    }

    return new Response(JSON.stringify({ ok: true, log: data, label: MANUAL_LABEL }), {
      headers: { ...headers, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }
});
