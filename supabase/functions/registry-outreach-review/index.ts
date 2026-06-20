// Batch 6 — M014 Human Approval Queue writer.
//
// Approving a draft is NOT sending. Sending is a separate, logged-only
// action handled by registry-outreach-log-send.
//
// Actions:
//   start_review        — claim a queued approval; status queued → in_review
//   approve             — approves the draft for manual send
//   reject              — rejects the draft
//   request_changes     — sends draft back for edits
//   cancel              — cancels the approval (and the draft if not terminal)
//   mark_do_not_contact — adds the recipient/company to the DNC list
//   suppress_contact    — alias for DNC + cancel the in-flight draft
//
// Audit events:
//   registry_outreach_draft_approved, registry_outreach_draft_rejected,
//   registry_outreach_changes_requested, registry_outreach_cancelled,
//   registry_outreach_do_not_contact_added, registry_outreach_suppressed
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import { REGISTRY_OUTREACH_NO_AUTO_SEND_COPY } from "../_shared/registry-outreach.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const StartReviewSchema = z.object({
  action: z.literal("start_review"),
  approval_id: z.string().uuid(),
});
const DecisionSchema = z.object({
  action: z.enum(["approve", "reject", "request_changes", "cancel"]),
  approval_id: z.string().uuid(),
  rationale: z.string().min(10).max(2000),
  acknowledged_no_auto_send: z.literal(true),
});
const DncSchema = z.object({
  action: z.literal("mark_do_not_contact"),
  company_reference: z.string().max(120).optional(),
  contact_email: z.string().email().max(200).optional(),
  contact_phone: z.string().max(60).optional(),
  reason: z.string().min(10).max(2000),
});
const SuppressSchema = z.object({
  action: z.literal("suppress_contact"),
  approval_id: z.string().uuid(),
  company_reference: z.string().max(120).optional(),
  contact_email: z.string().email().max(200).optional(),
  reason: z.string().min(10).max(2000),
});
const Body = z.discriminatedUnion("action", [
  StartReviewSchema, DecisionSchema, DncSchema, SuppressSchema,
]);

async function isAuthorisedReviewer(svc: ReturnType<typeof createClient>, uid: string) {
  const { data: roles } = await svc.from("user_roles").select("role").eq("user_id", uid);
  const set = new Set((roles ?? []).map((r: { role: string }) => r.role));
  return set.has("platform_admin") || set.has("compliance_owner");
}

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
    const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    if (!(await isAuthorisedReviewer(svc, user.id))) {
      return withCors(req, new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { "Content-Type": "application/json" } }));
    }
    const input = parsed.data;
    const now = new Date().toISOString();

    if (input.action === "start_review") {
      const { data: ap } = await svc.from("registry_outreach_approvals").select("id, status, draft_id").eq("id", input.approval_id).maybeSingle();
      if (!ap) return withCors(req, new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: { "Content-Type": "application/json" } }));
      if (ap.status !== "queued") {
        return withCors(req, new Response(JSON.stringify({ error: "invalid_transition", current: ap.status }), { status: 409, headers: { "Content-Type": "application/json" } }));
      }
      await svc.from("registry_outreach_approvals").update({ status: "in_review", reviewer_id: user.id }).eq("id", ap.id);
      return withCors(req, new Response(JSON.stringify({ ok: true, status: "in_review" }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }

    if (input.action === "mark_do_not_contact") {
      if (!input.company_reference && !input.contact_email && !input.contact_phone) {
        return withCors(req, new Response(JSON.stringify({ error: "missing_identifier" }), { status: 400, headers: { "Content-Type": "application/json" } }));
      }
      const { data: row, error } = await svc.from("registry_outreach_do_not_contact").insert({
        company_reference: input.company_reference ?? null,
        contact_email: input.contact_email ?? null,
        contact_phone: input.contact_phone ?? null,
        reason: input.reason,
        added_by: user.id,
      }).select("id").single();
      if (error) throw error;
      await svc.from("event_store").insert({
        event_name: "registry_outreach_do_not_contact_added",
        aggregate_id: row.id,
        aggregate_type: "registry_outreach_dnc",
        actor_id: user.id,
        payload: {
          company_reference: input.company_reference ?? null,
          contact_email: input.contact_email ?? null,
        },
      }).catch(() => {});
      return withCors(req, new Response(JSON.stringify({ ok: true, dnc_id: row.id }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }

    if (input.action === "suppress_contact") {
      const { data: ap } = await svc.from("registry_outreach_approvals").select("id, draft_id").eq("id", input.approval_id).maybeSingle();
      if (!ap) return withCors(req, new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: { "Content-Type": "application/json" } }));
      await svc.from("registry_outreach_do_not_contact").insert({
        company_reference: input.company_reference ?? null,
        contact_email: input.contact_email ?? null,
        reason: input.reason,
        added_by: user.id,
      });
      await svc.from("registry_outreach_approvals").update({ status: "cancelled", decision: "cancel", rationale: input.reason, reviewer_id: user.id, reviewed_at: now }).eq("id", ap.id);
      await svc.from("registry_outreach_drafts").update({ status: "cancelled", cancelled_at: now }).eq("id", ap.draft_id);
      await svc.from("registry_outreach_draft_events").insert([
        { draft_id: ap.draft_id, audit_event_name: "registry_outreach_suppressed", previous_status: null, new_status: "cancelled", reason: input.reason, actor_id: user.id, payload: {} },
        { draft_id: ap.draft_id, audit_event_name: "registry_outreach_cancelled", previous_status: null, new_status: "cancelled", reason: input.reason, actor_id: user.id, payload: {} },
      ]);
      return withCors(req, new Response(JSON.stringify({ ok: true, status: "suppressed" }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }

    // approve / reject / request_changes / cancel
    const decision = input.action;
    const { data: ap } = await svc.from("registry_outreach_approvals").select("id, status, draft_id").eq("id", input.approval_id).maybeSingle();
    if (!ap) return withCors(req, new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: { "Content-Type": "application/json" } }));
    if (!["queued", "in_review"].includes(ap.status)) {
      return withCors(req, new Response(JSON.stringify({ error: "invalid_transition", current: ap.status }), { status: 409, headers: { "Content-Type": "application/json" } }));
    }
    const { data: draft } = await svc.from("registry_outreach_drafts").select("id, status, company_reference, recipient_label").eq("id", ap.draft_id).maybeSingle();
    if (!draft) return withCors(req, new Response(JSON.stringify({ error: "draft_missing" }), { status: 404, headers: { "Content-Type": "application/json" } }));

    if (decision === "approve") {
      const { data: dnc } = await svc.from("registry_outreach_do_not_contact").select("id").eq("active", true).or(`company_reference.eq.${draft.company_reference},contact_email.eq.${draft.recipient_label}`);
      if ((dnc ?? []).length > 0) {
        return withCors(req, new Response(JSON.stringify({ error: "do_not_contact" }), { status: 409, headers: { "Content-Type": "application/json" } }));
      }
    }

    const nextApprovalStatus = decision === "approve" ? "approved" : decision === "reject" ? "rejected" : decision === "request_changes" ? "changes_requested" : "cancelled";
    const nextDraftStatus = decision === "approve" ? "approved_for_send" : decision === "reject" ? "rejected" : decision === "request_changes" ? "needs_review" : "cancelled";
    const eventName = decision === "approve" ? "registry_outreach_draft_approved"
      : decision === "reject" ? "registry_outreach_draft_rejected"
      : decision === "request_changes" ? "registry_outreach_changes_requested"
      : "registry_outreach_cancelled";

    await svc.from("registry_outreach_approvals").update({
      status: nextApprovalStatus,
      decision,
      rationale: input.rationale,
      acknowledged_no_auto_send: true,
      reviewer_id: user.id,
      reviewed_at: now,
    }).eq("id", ap.id);

    const updateDraft: Record<string, unknown> = { status: nextDraftStatus };
    if (decision === "approve") { updateDraft.approved_at = now; updateDraft.approved_by = user.id; }
    if (decision === "reject") updateDraft.rejected_at = now;
    if (decision === "cancel") updateDraft.cancelled_at = now;
    await svc.from("registry_outreach_drafts").update(updateDraft).eq("id", draft.id);

    await svc.from("registry_outreach_draft_events").insert({
      draft_id: draft.id,
      audit_event_name: eventName,
      previous_status: draft.status,
      new_status: nextDraftStatus,
      reason: input.rationale,
      actor_id: user.id,
      payload: { approval_id: ap.id, no_auto_send_copy: REGISTRY_OUTREACH_NO_AUTO_SEND_COPY },
    });
    await svc.from("event_store").insert({
      event_name: eventName,
      aggregate_id: draft.id,
      aggregate_type: "registry_outreach_draft",
      actor_id: user.id,
      payload: { approval_id: ap.id, decision, no_auto_send_copy: REGISTRY_OUTREACH_NO_AUTO_SEND_COPY },
    }).catch(() => {});

    return withCors(req, new Response(JSON.stringify({ ok: true, status: nextApprovalStatus, draft_status: nextDraftStatus, no_auto_send_copy: REGISTRY_OUTREACH_NO_AUTO_SEND_COPY }), { status: 200, headers: { "Content-Type": "application/json" } }));
  } catch (err) {
    console.error("registry-outreach-review error", err);
    return withCors(req, new Response(JSON.stringify({ error: "internal_error", message: String(err) }), { status: 500, headers: { "Content-Type": "application/json" } }));
  }
});
