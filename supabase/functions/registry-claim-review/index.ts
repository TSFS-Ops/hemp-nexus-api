// Batch 11 — registry-claim-review
// Admin/compliance review actions on a claim. Approval requires
// acknowledged_not_verification:true. Approval never grants authority,
// company verification or bank verification. Approval emits the canonical
// non-verification public wording.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import {
  REGISTRY_CLAIM_REVIEW_ACTIONS,
  REGISTRY_CLAIM_APPROVAL_PUBLIC_WORDING,
  REGISTRY_CLAIM_EXPIRY_DAYS,
} from "../_shared/registry-claim-workflow.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const Body = z.object({
  claim_id: z.string().uuid(),
  action: z.enum(REGISTRY_CLAIM_REVIEW_ACTIONS as unknown as [string, ...string[]]),
  reason: z.string().max(2000).optional(),
  evidence_id: z.string().uuid().optional(),
  assigned_user_id: z.string().uuid().optional(),
  acknowledged_not_verification: z.boolean().optional(),
  note: z.string().max(4000).optional(),
});

const ACTION_TO_AUDIT: Record<string, string> = {
  start_review: "registry_claim_review_started",
  request_more_evidence: "registry_claim_more_evidence_requested",
  accept_evidence_item: "registry_claim_evidence_reviewed",
  reject_evidence_item: "registry_claim_evidence_reviewed",
  approve_claim: "registry_claim_approved",
  reject_claim: "registry_claim_rejected",
  escalate_claim: "registry_claim_escalated",
  cancel_claim: "registry_claim_cancelled",
  expire_claim: "registry_claim_expired",
  assign_reviewer: "registry_claim_assigned",
  add_internal_note: "registry_claim_note_added",
  // Claimant-initiated transitions reach this map when invoked via the
  // claim-status surface (cancel by claimant maps to withdraw audit name).
  withdraw_claim: "registry_claim_withdrawn",
  draft_claim: "registry_claim_drafted",
};

Deno.serve(async (req) => {
  const pre = handleCorsPreflight(req);
  if (pre) return pre;
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: userRes } = await userClient.auth.getUser();
    const user = userRes?.user;
    if (!user) return withCors(req, new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }));

    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) return withCors(req, new Response(JSON.stringify({ error: "invalid_body", details: parsed.error.flatten() }), { status: 400 }));

    const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { data: rolesRows } = await svc.from("user_roles").select("role").eq("user_id", user.id);
    const roles = (rolesRows ?? []).map((r: any) => r.role);
    const isAdmin = roles.includes("platform_admin") || roles.includes("compliance_owner");
    if (!isAdmin) return withCors(req, new Response(JSON.stringify({ error: "forbidden_admin_required" }), { status: 403 }));

    const { data: claim } = await svc.from("registry_company_claims").select("*").eq("id", parsed.data.claim_id).maybeSingle();
    if (!claim) return withCors(req, new Response(JSON.stringify({ error: "claim_not_found" }), { status: 404 }));

    const { action } = parsed.data;
    const auditName = ACTION_TO_AUDIT[action];
    let newStatus: string | null = null;

    // Mandatory reason for state-changing actions
    const needsReason = ["request_more_evidence", "reject_claim", "reject_evidence_item", "escalate_claim", "cancel_claim", "expire_claim"];
    if (needsReason.includes(action) && !(parsed.data.reason && parsed.data.reason.trim().length >= 10)) {
      return withCors(req, new Response(JSON.stringify({ error: "reason_required" }), { status: 400 }));
    }

    if (action === "approve_claim" && parsed.data.acknowledged_not_verification !== true) {
      return withCors(req, new Response(JSON.stringify({ error: "approval_acknowledgement_required" }), { status: 400 }));
    }

    switch (action) {
      case "start_review":
        newStatus = "under_review";
        break;
      case "request_more_evidence":
        newStatus = "more_evidence_requested";
        // bump SLA to evidence-requested window
        await svc.from("registry_company_claims").update({
          sla_due_at: new Date(Date.now() + REGISTRY_CLAIM_EXPIRY_DAYS.evidence_requested * 24 * 60 * 60 * 1000).toISOString(),
        }).eq("id", claim.id);
        break;
      case "approve_claim":
        newStatus = "approved";
        // CRITICAL: do NOT touch authority/profile/bank/api fields.
        break;
      case "reject_claim":
        newStatus = "rejected";
        await svc.from("registry_company_claims").update({ rejection_reason: parsed.data.reason ?? null }).eq("id", claim.id);
        break;
      case "escalate_claim":
        newStatus = "escalated";
        break;
      case "cancel_claim":
        newStatus = "cancelled";
        break;
      case "expire_claim":
        newStatus = "expired";
        break;
      case "assign_reviewer":
        if (!parsed.data.assigned_user_id) {
          return withCors(req, new Response(JSON.stringify({ error: "assigned_user_id_required" }), { status: 400 }));
        }
        await svc.from("registry_company_claims")
          .update({ assigned_reviewer_user_id: parsed.data.assigned_user_id })
          .eq("id", claim.id);
        await svc.from("registry_company_claim_assignments").insert({
          claim_id: claim.id, assigned_user_id: parsed.data.assigned_user_id, assigned_by_user_id: user.id, assignment_type: "reviewer",
        });
        break;
      case "add_internal_note":
        if (!parsed.data.note) return withCors(req, new Response(JSON.stringify({ error: "note_required" }), { status: 400 }));
        await svc.from("registry_company_claim_notes").insert({
          claim_id: claim.id, author_user_id: user.id, note: parsed.data.note,
        });
        break;
      case "accept_evidence_item":
      case "reject_evidence_item":
        if (!parsed.data.evidence_id) return withCors(req, new Response(JSON.stringify({ error: "evidence_id_required" }), { status: 400 }));
        await svc.from("registry_company_claim_evidence")
          .update({
            evidence_state: action === "accept_evidence_item" ? "accepted" : "rejected",
            reviewer_user_id: user.id,
            review_notes: parsed.data.note ?? null,
            rejection_reason: action === "reject_evidence_item" ? (parsed.data.reason ?? null) : null,
          })
          .eq("id", parsed.data.evidence_id).eq("claim_id", claim.id);
        break;
    }

    if (newStatus) {
      await svc.from("registry_company_claims").update({
        workflow_status: newStatus,
        status: newStatus === "approved" ? "approved" : newStatus === "rejected" ? "rejected" : claim.status,
        last_status_change_at: new Date().toISOString(),
      }).eq("id", claim.id);
    }

    await svc.from("registry_company_claim_review_events").insert({
      claim_id: claim.id,
      reviewer_user_id: user.id,
      reviewer_role: roles.includes("platform_admin") ? "platform_admin" : "compliance_owner",
      action,
      previous_status: claim.workflow_status,
      new_status: newStatus,
      reason: parsed.data.reason ?? null,
      evidence_id: parsed.data.evidence_id ?? null,
      metadata: { acknowledged_not_verification: parsed.data.acknowledged_not_verification ?? null },
    });
    await svc.from("registry_company_claim_events").insert({
      claim_id: claim.id, audit_event_name: auditName,
      actor_user_id: user.id, previous_status: claim.workflow_status, new_status: newStatus, reason: parsed.data.reason ?? null,
    });
    await svc.from("audit_logs").insert({
      action: auditName,
      actor_user_id: user.id,
      metadata: { claim_id: claim.id, review_action: action, new_status: newStatus },
    });

    // Log-only in-app notification on user-visible transitions
    const notifyAudit = ["approve_claim", "reject_claim", "request_more_evidence", "expire_claim", "cancel_claim", "escalate_claim", "start_review"];
    if (notifyAudit.includes(action)) {
      await svc.from("registry_company_claim_status_notifications").insert({
        claim_id: claim.id,
        recipient_user_id: claim.claimant_user_id,
        channel: "in_app",
        audit_event_name: auditName,
        subject: action === "approve_claim" ? "Claim approved" : action === "reject_claim" ? "Claim not approved" : "Claim update",
        body: action === "approve_claim"
          ? REGISTRY_CLAIM_APPROVAL_PUBLIC_WORDING
          : (parsed.data.reason ?? "Your claim has been updated."),
        delivery_state: "logged_only",
      });
      await svc.from("audit_logs").insert({
        action: "registry_claim_notification_logged",
        actor_user_id: user.id,
        metadata: { claim_id: claim.id, kind: action },
      });
    }

    const body: any = { ok: true, action, new_status: newStatus };
    if (action === "approve_claim") body.public_wording = REGISTRY_CLAIM_APPROVAL_PUBLIC_WORDING;
    return withCors(req, new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }));
  } catch (e) {
    return withCors(req, new Response(JSON.stringify({ error: "internal", message: (e as Error).message }), { status: 500 }));
  }
});
