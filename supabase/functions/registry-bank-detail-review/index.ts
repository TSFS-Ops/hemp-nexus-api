// Batch 13 — Admin / compliance review actions on a bank-detail submission.
// Every action except `assign_reviewer` requires a reason; `accept_captured_unverified`
// additionally requires the acknowledgement boolean. No action grants `verified`.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import {
  REGISTRY_BANK_DETAIL_B13_REVIEW_ACTIONS,
  REGISTRY_BANK_DETAIL_B13_REVIEW_ACTIONS_NO_REASON,
  REGISTRY_BANK_DETAIL_B13_ACCEPT_ACKNOWLEDGEMENT,
  REGISTRY_BANK_DETAIL_B13_ACCEPT_PUBLIC_NOTICE,
  type RegistryBankDetailB13ReviewAction,
  type RegistryBankDetailB13SubmissionStatus,
} from "../_shared/registry-bank-details-b13.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const BodySchema = z.object({
  submission_id: z.string().uuid(),
  action: z.enum(REGISTRY_BANK_DETAIL_B13_REVIEW_ACTIONS),
  reason: z.string().max(2000).optional(),
  acknowledged: z.boolean().optional(),
  due_at: z.string().datetime().optional(),
  evidence_id: z.string().uuid().optional(),
  assignee_id: z.string().uuid().optional(),
  note: z.string().max(2000).optional(),
});

function json(req: Request, body: unknown, status = 200): Response {
  return withCors(req, new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

const ACTION_TO_STATUS: Partial<Record<RegistryBankDetailB13ReviewAction, RegistryBankDetailB13SubmissionStatus>> = {
  start_review: "under_review",
  request_more_evidence: "more_evidence_requested",
  accept_captured_unverified: "captured_unverified",
  reject_submission: "rejected",
  mark_disputed: "disputed",
  approve_revocation: "revoked",
  expire_submission: "expired",
  supersede_submission: "superseded",
  request_revocation: "revocation_requested",
};

const ACTION_TO_AUDIT: Record<RegistryBankDetailB13ReviewAction, string> = {
  start_review: "registry_bank_detail_review_started",
  request_more_evidence: "registry_bank_detail_more_evidence_requested",
  accept_evidence_item: "registry_bank_detail_evidence_reviewed",
  reject_evidence_item: "registry_bank_detail_evidence_reviewed",
  accept_captured_unverified: "registry_bank_detail_captured_unverified",
  reject_submission: "registry_bank_detail_rejected",
  mark_disputed: "registry_bank_detail_disputed",
  request_revocation: "registry_bank_detail_revocation_requested",
  approve_revocation: "registry_bank_detail_revoked",
  expire_submission: "registry_bank_detail_expired",
  supersede_submission: "registry_bank_detail_superseded",
  assign_reviewer: "registry_bank_detail_note_added",
  add_internal_note: "registry_bank_detail_note_added",
  request_unmask_access: "registry_bank_detail_unmask_requested",
};

Deno.serve(async (req) => {
  const pre = handleCorsPreflight(req);
  if (pre) return pre;
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: userRes } = await userClient.auth.getUser();
    const user = userRes?.user;
    if (!user) return json(req, { error: "unauthorized" }, 401);

    const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return json(req, { error: "invalid_body", details: parsed.error.flatten() }, 400);
    const input = parsed.data;

    const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { data: roles } = await svc.from("user_roles").select("role").eq("user_id", user.id);
    const roleSet = new Set((roles ?? []).map((r: { role: string }) => r.role));
    if (!roleSet.has("platform_admin") && !roleSet.has("compliance_owner")) {
      return json(req, { error: "forbidden" }, 403);
    }

    const requiresReason = !REGISTRY_BANK_DETAIL_B13_REVIEW_ACTIONS_NO_REASON.includes(input.action);
    if (requiresReason && (!input.reason || input.reason.trim().length < 5)) {
      return json(req, { error: "reason_required" }, 400);
    }

    if (input.action === "accept_captured_unverified" && input.acknowledged !== true) {
      return json(req, { error: "acknowledgement_required", required_text: REGISTRY_BANK_DETAIL_B13_ACCEPT_ACKNOWLEDGEMENT }, 400);
    }

    const { data: sub } = await svc.from("registry_bank_detail_submissions")
      .select("id, b13_status, status, risk_level").eq("id", input.submission_id).maybeSingle();
    if (!sub) return json(req, { error: "not_found" }, 404);

    if (input.action === "accept_captured_unverified" && sub.risk_level === "blocked") {
      return json(req, { error: "risk_blocked_acceptance_denied" }, 409);
    }

    const previous = sub.b13_status as string;
    const nextStatus = ACTION_TO_STATUS[input.action];

    const update: Record<string, unknown> = {};
    if (nextStatus) update.b13_status = nextStatus;
    if (input.action === "accept_captured_unverified") update.captured_unverified_at = new Date().toISOString();
    if (input.action === "approve_revocation") update.revoked_at = new Date().toISOString();
    if (input.action === "mark_disputed") update.disputed_at = new Date().toISOString();
    if (input.action === "assign_reviewer" && input.assignee_id) update.assigned_reviewer_id = input.assignee_id;
    if (input.action === "request_more_evidence" && input.due_at) update.more_evidence_due_at = input.due_at;
    if (input.action === "reject_submission") update.rejection_reason = input.reason;

    if (Object.keys(update).length > 0) {
      await svc.from("registry_bank_detail_submissions").update(update).eq("id", input.submission_id);
    }

    await svc.from("registry_bank_detail_review_events").insert({
      submission_id: input.submission_id,
      action: input.action,
      reason: input.reason ?? null,
      acknowledged: input.acknowledged ?? false,
      previous_status: previous,
      new_status: nextStatus ?? null,
      payload: {
        evidence_id: input.evidence_id ?? null,
        assignee_id: input.assignee_id ?? null,
        due_at: input.due_at ?? null,
      },
      actor_id: user.id,
    });

    if (input.action === "add_internal_note" && input.note) {
      await svc.from("registry_bank_detail_notes").insert({
        submission_id: input.submission_id, note: input.note, author_id: user.id, visibility: "internal",
      });
    }

    const eventName = ACTION_TO_AUDIT[input.action];
    await svc.from("registry_bank_detail_events").insert({
      submission_id: input.submission_id,
      audit_event_name: eventName,
      previous_status: previous,
      new_status: nextStatus ?? null,
      reason: input.reason ?? null,
      actor_id: user.id,
      payload: { action: input.action },
    });
    await svc.from("event_store").insert({
      event_name: eventName,
      aggregate_id: input.submission_id,
      aggregate_type: "registry_bank_detail_submission",
      actor_id: user.id,
      payload: { action: input.action, previous, next: nextStatus ?? null },
    }).catch(() => {});

    return json(req, {
      ok: true,
      previous_status: previous,
      new_status: nextStatus ?? previous,
      verified: false,
      public_notice: input.action === "accept_captured_unverified" ? REGISTRY_BANK_DETAIL_B13_ACCEPT_PUBLIC_NOTICE : undefined,
    });
  } catch (err) {
    console.error("registry-bank-detail-review error", err);
    return json(req, { error: "internal_error" }, 500);
  }
});
