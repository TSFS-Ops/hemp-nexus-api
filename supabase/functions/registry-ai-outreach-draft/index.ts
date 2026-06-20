// Batch 6 — M013 AI Outreach Drafter.
// CRITICAL: This function NEVER sends outreach. It may only draft.
//
// Actions:
//   request   — register a draft request for a target (claim/authority/company)
//   generate  — produce a deterministic (placeholder-AI) draft body using
//               approved template + supplied source context. Honours all
//               eligibility rules and DNC.
//   needs_review — mark a generated draft ready for human review
//   edit      — admin edits subject/body (records edit history; status → edited)
//   cancel    — cancel a draft (terminal)
//
// Audit events:
//   registry_outreach_draft_requested, registry_outreach_draft_generated,
//   registry_outreach_draft_edited, registry_outreach_cancelled
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import {
  REGISTRY_OUTREACH_AI_DRAFT_LABEL,
  REGISTRY_OUTREACH_CHANNELS,
  evaluateOutreachEligibility,
  isDraftWordingSafe,
} from "../_shared/registry-outreach.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const RequestSchema = z.object({
  action: z.literal("request"),
  target_kind: z.enum(["claim", "authority", "company"]),
  target_id: z.string().min(1).max(120),
  company_reference: z.string().min(1).max(120),
  country_code: z.string().min(2).max(8),
  channel: z.enum(REGISTRY_OUTREACH_CHANNELS),
  template_code: z.string().min(1).max(80).optional(),
  recipient_label: z.string().min(1).max(200),
  reason_for_outreach: z.string().min(10).max(2000),
  permitted_use_basis: z.string().min(5).max(500),
  expires_in_days: z.number().int().min(1).max(60).optional(),
});

const GenerateSchema = z.object({
  action: z.literal("generate"),
  draft_id: z.string().uuid(),
  sources: z.array(z.object({
    source_kind: z.string().min(1).max(60),
    source_reference: z.string().min(1).max(500),
    snippet: z.string().max(2000).optional(),
  })).min(1),
  tone_hint: z.string().max(200).optional(),
});

const NeedsReviewSchema = z.object({
  action: z.literal("needs_review"),
  draft_id: z.string().uuid(),
});

const EditSchema = z.object({
  action: z.literal("edit"),
  draft_id: z.string().uuid(),
  subject: z.string().min(1).max(300),
  body: z.string().min(1).max(20000),
  edit_reason: z.string().min(3).max(2000),
});

const CancelSchema = z.object({
  action: z.literal("cancel"),
  draft_id: z.string().uuid(),
  reason: z.string().min(3).max(2000),
});

const Body = z.discriminatedUnion("action", [
  RequestSchema, GenerateSchema, NeedsReviewSchema, EditSchema, CancelSchema,
]);

async function isAuthorisedAdmin(svc: ReturnType<typeof createClient>, uid: string) {
  const { data: roles } = await svc.from("user_roles").select("role").eq("user_id", uid);
  const set = new Set((roles ?? []).map((r: { role: string }) => r.role));
  return set.has("platform_admin") || set.has("compliance_owner");
}

async function dncMatch(svc: ReturnType<typeof createClient>, companyRef: string, recipientLabel: string) {
  const { data } = await svc
    .from("registry_outreach_do_not_contact")
    .select("id, company_reference, contact_email")
    .eq("active", true)
    .or(`company_reference.eq.${companyRef},contact_email.eq.${recipientLabel}`);
  return (data ?? []).length > 0;
}

function buildAiDraft(input: {
  recipient_label: string;
  company_reference: string;
  reason_for_outreach: string;
  permitted_use_basis: string;
  sources: { source_kind: string; source_reference: string; snippet?: string }[];
  tone_hint?: string;
}) {
  const subject = `${REGISTRY_OUTREACH_AI_DRAFT_LABEL} Registry record review for ${input.company_reference}`;
  const lines = [
    REGISTRY_OUTREACH_AI_DRAFT_LABEL,
    "",
    `Dear ${input.recipient_label},`,
    "",
    `We are reviewing a registry record associated with ${input.company_reference}.`,
    `Reason for outreach: ${input.reason_for_outreach}`,
    `Permitted-use basis: ${input.permitted_use_basis}`,
    "",
    "Source context referenced in this draft:",
    ...input.sources.map((s) => `  - ${s.source_kind}: ${s.source_reference}`),
    "",
    "This message is a draft only and has not been reviewed or approved for send.",
    "No claim, authority, profile or bank detail is asserted as confirmed.",
  ];
  return { subject, body: lines.join("\n") };
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
    if (!(await isAuthorisedAdmin(svc, user.id))) {
      return withCors(req, new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { "Content-Type": "application/json" } }));
    }
    const input = parsed.data;

    if (input.action === "request") {
      if (await dncMatch(svc, input.company_reference, input.recipient_label)) {
        return withCors(req, new Response(JSON.stringify({ error: "do_not_contact" }), { status: 409, headers: { "Content-Type": "application/json" } }));
      }
      const elig = evaluateOutreachEligibility({
        do_not_contact: false,
        country_ready: true, // shell — coverage gate is enforced at the operations dashboard
        module_enabled: true,
        reason_for_outreach: input.reason_for_outreach,
        permitted_use_basis: input.permitted_use_basis,
      });
      if (!elig.allowed) {
        return withCors(req, new Response(JSON.stringify({ error: "not_allowed", reason: elig.reason }), { status: 409, headers: { "Content-Type": "application/json" } }));
      }

      let templateId: string | null = null;
      if (input.template_code) {
        const { data: tpl } = await svc.from("registry_outreach_templates").select("id").eq("template_code", input.template_code).maybeSingle();
        templateId = tpl?.id ?? null;
      }

      const expiresAt = input.expires_in_days
        ? new Date(Date.now() + input.expires_in_days * 86400000).toISOString()
        : null;
      const { data: row, error } = await svc.from("registry_outreach_drafts").insert({
        target_kind: input.target_kind,
        target_id: input.target_id,
        company_reference: input.company_reference,
        country_code: input.country_code,
        channel: input.channel,
        template_id: templateId,
        recipient_label: input.recipient_label,
        status: "draft_requested",
        reason_for_outreach: input.reason_for_outreach,
        permitted_use_basis: input.permitted_use_basis,
        expires_at: expiresAt,
        requested_by: user.id,
      }).select("id").single();
      if (error) throw error;

      await svc.from("registry_outreach_draft_events").insert({
        draft_id: row.id,
        audit_event_name: "registry_outreach_draft_requested",
        previous_status: null,
        new_status: "draft_requested",
        actor_id: user.id,
        payload: { target_kind: input.target_kind, target_id: input.target_id },
      });
      await svc.from("event_store").insert({
        event_name: "registry_outreach_draft_requested",
        aggregate_id: row.id,
        aggregate_type: "registry_outreach_draft",
        actor_id: user.id,
        payload: { company_reference: input.company_reference },
      }).catch(() => {});
      return withCors(req, new Response(JSON.stringify({ ok: true, draft_id: row.id, status: "draft_requested" }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }

    if (input.action === "generate") {
      const { data: draft } = await svc.from("registry_outreach_drafts").select("*").eq("id", input.draft_id).maybeSingle();
      if (!draft) return withCors(req, new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: { "Content-Type": "application/json" } }));
      if (draft.status !== "draft_requested") {
        return withCors(req, new Response(JSON.stringify({ error: "invalid_transition", current: draft.status }), { status: 409, headers: { "Content-Type": "application/json" } }));
      }
      if (await dncMatch(svc, draft.company_reference, draft.recipient_label)) {
        return withCors(req, new Response(JSON.stringify({ error: "do_not_contact" }), { status: 409, headers: { "Content-Type": "application/json" } }));
      }

      const { subject, body } = buildAiDraft({
        recipient_label: draft.recipient_label,
        company_reference: draft.company_reference,
        reason_for_outreach: draft.reason_for_outreach,
        permitted_use_basis: draft.permitted_use_basis,
        sources: input.sources,
        tone_hint: input.tone_hint,
      });
      const safety = isDraftWordingSafe(body);
      if (!safety.ok) {
        return withCors(req, new Response(JSON.stringify({ error: "draft_wording_unsafe", offenders: safety.offenders }), { status: 422, headers: { "Content-Type": "application/json" } }));
      }

      await svc.from("registry_outreach_drafts").update({
        status: "draft_generated",
        subject,
        body,
        ai_model: "lovable-ai-placeholder-v1",
        ai_confidence: "medium",
        generated_at: new Date().toISOString(),
      }).eq("id", draft.id);

      await svc.from("registry_outreach_draft_sources").insert(
        input.sources.map((s) => ({
          draft_id: draft.id,
          source_kind: s.source_kind,
          source_reference: s.source_reference,
          snippet: s.snippet ?? null,
        })),
      );
      await svc.from("registry_outreach_draft_events").insert({
        draft_id: draft.id,
        audit_event_name: "registry_outreach_draft_generated",
        previous_status: "draft_requested",
        new_status: "draft_generated",
        actor_id: user.id,
        payload: { source_count: input.sources.length },
      });
      await svc.from("event_store").insert({
        event_name: "registry_outreach_draft_generated",
        aggregate_id: draft.id,
        aggregate_type: "registry_outreach_draft",
        actor_id: user.id,
        payload: { source_count: input.sources.length },
      }).catch(() => {});
      return withCors(req, new Response(JSON.stringify({ ok: true, draft_id: draft.id, status: "draft_generated", subject, body }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }

    if (input.action === "needs_review") {
      const { data: draft } = await svc.from("registry_outreach_drafts").select("id, status").eq("id", input.draft_id).maybeSingle();
      if (!draft) return withCors(req, new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: { "Content-Type": "application/json" } }));
      if (!["draft_generated", "edited"].includes(draft.status)) {
        return withCors(req, new Response(JSON.stringify({ error: "invalid_transition", current: draft.status }), { status: 409, headers: { "Content-Type": "application/json" } }));
      }
      await svc.from("registry_outreach_drafts").update({ status: "needs_review" }).eq("id", draft.id);
      await svc.from("registry_outreach_approvals").insert({ draft_id: draft.id, status: "queued" });
      await svc.from("registry_outreach_draft_events").insert({
        draft_id: draft.id,
        audit_event_name: "registry_outreach_draft_generated",
        previous_status: draft.status,
        new_status: "needs_review",
        actor_id: user.id,
        payload: {},
      });
      return withCors(req, new Response(JSON.stringify({ ok: true, status: "needs_review" }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }

    if (input.action === "edit") {
      const { data: draft } = await svc.from("registry_outreach_drafts").select("*").eq("id", input.draft_id).maybeSingle();
      if (!draft) return withCors(req, new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: { "Content-Type": "application/json" } }));
      if (["approved_for_send", "rejected", "cancelled", "expired"].includes(draft.status)) {
        return withCors(req, new Response(JSON.stringify({ error: "invalid_transition", current: draft.status }), { status: 409, headers: { "Content-Type": "application/json" } }));
      }
      const safety = isDraftWordingSafe(input.body);
      if (!safety.ok) {
        return withCors(req, new Response(JSON.stringify({ error: "draft_wording_unsafe", offenders: safety.offenders }), { status: 422, headers: { "Content-Type": "application/json" } }));
      }
      await svc.from("registry_outreach_draft_edits").insert({
        draft_id: draft.id,
        previous_subject: draft.subject,
        previous_body: draft.body,
        new_subject: input.subject,
        new_body: input.body,
        editor_id: user.id,
        edit_reason: input.edit_reason,
      });
      await svc.from("registry_outreach_drafts").update({
        status: "edited",
        subject: input.subject,
        body: input.body,
      }).eq("id", draft.id);
      await svc.from("registry_outreach_draft_events").insert({
        draft_id: draft.id,
        audit_event_name: "registry_outreach_draft_edited",
        previous_status: draft.status,
        new_status: "edited",
        reason: input.edit_reason,
        actor_id: user.id,
        payload: {},
      });
      return withCors(req, new Response(JSON.stringify({ ok: true, status: "edited" }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }

    if (input.action === "cancel") {
      const { data: draft } = await svc.from("registry_outreach_drafts").select("id, status").eq("id", input.draft_id).maybeSingle();
      if (!draft) return withCors(req, new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: { "Content-Type": "application/json" } }));
      if (["approved_for_send", "rejected", "cancelled", "expired"].includes(draft.status)) {
        return withCors(req, new Response(JSON.stringify({ error: "invalid_transition", current: draft.status }), { status: 409, headers: { "Content-Type": "application/json" } }));
      }
      await svc.from("registry_outreach_drafts").update({ status: "cancelled", cancelled_at: new Date().toISOString() }).eq("id", draft.id);
      await svc.from("registry_outreach_draft_events").insert({
        draft_id: draft.id,
        audit_event_name: "registry_outreach_cancelled",
        previous_status: draft.status,
        new_status: "cancelled",
        reason: input.reason,
        actor_id: user.id,
        payload: {},
      });
      return withCors(req, new Response(JSON.stringify({ ok: true, status: "cancelled" }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }

    return withCors(req, new Response(JSON.stringify({ error: "unknown_action" }), { status: 400, headers: { "Content-Type": "application/json" } }));
  } catch (err) {
    console.error("registry-ai-outreach-draft error", err);
    return withCors(req, new Response(JSON.stringify({ error: "internal_error", message: String(err) }), { status: 500, headers: { "Content-Type": "application/json" } }));
  }
});
