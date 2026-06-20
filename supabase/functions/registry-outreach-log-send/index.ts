// Batch 6 — Send-log placeholder. LOG-ONLY: this function NEVER actually
// dispatches email/SMS/WhatsApp. It records the outcome of a manual
// external send that has already been carried out by an authorised admin.
//
// Sending requires the underlying draft to be in approved_for_send AND a
// matching approved approval row. The recipient must not be on the DNC list.
//
// Audit event: registry_outreach_send_logged
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import { REGISTRY_OUTREACH_NO_AUTO_SEND_COPY } from "../_shared/registry-outreach.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const Body = z.object({
  draft_id: z.string().uuid(),
  outcome: z.enum(["sent", "failed", "no_response", "not_sent"]),
  send_method: z.enum(["manual_external", "internal_log_only"]).default("manual_external"),
  evidence_note: z.string().min(3).max(2000),
  acknowledged_no_auto_send: z.literal(true),
});

Deno.serve(async (req) => {
  const pre = handleCorsPreflight(req);
  if (pre) return pre;
  try {
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: userRes } = await userClient.auth.getUser();
    const user = userRes?.user;
    if (!user) return withCors(req, new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } }));
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) return withCors(req, new Response(JSON.stringify({ error: "invalid_body", details: parsed.error.flatten() }), { status: 400, headers: { "Content-Type": "application/json" } }));
    const input = parsed.data;

    const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { data: roles } = await svc.from("user_roles").select("role").eq("user_id", user.id);
    const set = new Set((roles ?? []).map((r: { role: string }) => r.role));
    if (!(set.has("platform_admin") || set.has("compliance_owner"))) {
      return withCors(req, new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { "Content-Type": "application/json" } }));
    }

    const { data: draft } = await svc.from("registry_outreach_drafts").select("*").eq("id", input.draft_id).maybeSingle();
    if (!draft) return withCors(req, new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: { "Content-Type": "application/json" } }));
    if (draft.status !== "approved_for_send") {
      return withCors(req, new Response(JSON.stringify({ error: "send_not_allowed_from_state", current: draft.status }), { status: 409, headers: { "Content-Type": "application/json" } }));
    }
    const { data: approval } = await svc.from("registry_outreach_approvals").select("id, status").eq("draft_id", draft.id).eq("status", "approved").maybeSingle();
    if (!approval) return withCors(req, new Response(JSON.stringify({ error: "no_approval_record" }), { status: 409, headers: { "Content-Type": "application/json" } }));

    const { data: dnc } = await svc.from("registry_outreach_do_not_contact").select("id").eq("active", true).or(`company_reference.eq.${draft.company_reference},contact_email.eq.${draft.recipient_label}`);
    if ((dnc ?? []).length > 0) {
      return withCors(req, new Response(JSON.stringify({ error: "do_not_contact" }), { status: 409, headers: { "Content-Type": "application/json" } }));
    }

    const { data: row, error } = await svc.from("registry_outreach_send_log").insert({
      draft_id: draft.id,
      approval_id: approval.id,
      channel: draft.channel,
      recipient_label: draft.recipient_label,
      send_method: input.send_method,
      outcome: input.outcome,
      evidence_note: input.evidence_note,
      sent_by: user.id,
    }).select("id").single();
    if (error) throw error;

    await svc.from("registry_outreach_draft_events").insert({
      draft_id: draft.id,
      audit_event_name: "registry_outreach_send_logged",
      previous_status: draft.status,
      new_status: draft.status,
      reason: input.evidence_note,
      actor_id: user.id,
      payload: { send_log_id: row.id, outcome: input.outcome, send_method: input.send_method, no_auto_send_copy: REGISTRY_OUTREACH_NO_AUTO_SEND_COPY },
    });
    await svc.from("event_store").insert({
      event_name: "registry_outreach_send_logged",
      aggregate_id: draft.id,
      aggregate_type: "registry_outreach_draft",
      actor_id: user.id,
      payload: { send_log_id: row.id, outcome: input.outcome, send_method: input.send_method },
    }).catch(() => {});
    return withCors(req, new Response(JSON.stringify({ ok: true, send_log_id: row.id, no_auto_send_copy: REGISTRY_OUTREACH_NO_AUTO_SEND_COPY }), { status: 200, headers: { "Content-Type": "application/json" } }));
  } catch (err) {
    console.error("registry-outreach-log-send error", err);
    return withCors(req, new Response(JSON.stringify({ error: "internal_error", message: String(err) }), { status: 500, headers: { "Content-Type": "application/json" } }));
  }
});
