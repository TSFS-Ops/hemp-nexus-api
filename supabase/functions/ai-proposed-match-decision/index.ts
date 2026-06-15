/**
 * ai-proposed-match-decision
 * ──────────────────────────────────────────────────────────────────────
 * AI Counterparty Intelligence & Match Review — Batch 3.
 *
 * Single gated edge function for all admin decisions on `ai_proposed_matches`.
 * platform_admin only. Every action writes an `ai_review.*` audit.
 *
 * Supported actions:
 *   - approve                  → status='approved'
 *   - reject                   → status='rejected' (rejection_reason required)
 *   - archive                  → status='archived'
 *   - escalate                 → status='escalated' (escalation_reason required)
 *   - needs_more_research      → status='needs_more_research'
 *   - under_review             → status='under_review'
 *   - assign                   → set assigned_reviewer_id
 *   - reviewer_note            → set reviewer_note
 *   - confidence_override      → set confidence_override + reason
 *
 * Hard guarantees:
 *   - No outreach. No send/dispatch. No POI / WaD / formal-match write.
 *   - No "verified" claim is created or implied by any action.
 *   - Status transitions only into the existing CHECK enum on the table.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import { authenticateRequest, requireRole } from "../_shared/auth.ts";
import { writeAdminAudit, extractIp, extractUserAgent } from "../_shared/admin-audit.ts";
import { AI_REVIEW_AUDIT_NAMES } from "../_shared/ai-review-audit.ts";
import {
  ACTIONS,
  type Action,
  TERMINAL,
  CONFIDENCE,
  ESCALATION_TARGETS,
  FEEDBACK_REASONS,
  canApproveForClientView,
  canApproveForOutreach,
  buildApprovedPayload,
  buildOriginalPayloadSnapshot,
  shouldSnapshotOriginal,
} from "./validation.ts";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });



serve(async (req) => {
  const pre = handleCorsPreflight(req);
  if (pre) return pre;
  return withCors(req, await _handle(req));
});

async function _handle(req: Request): Promise<Response> {
  const requestId = crypto.randomUUID();
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);

  let userId: string | null = null;
  let action: Action | null = null;
  let proposedId: string | null = null;

  try {
    const ctx = await authenticateRequest(req, supabaseUrl, serviceKey);
    requireRole(ctx, "platform_admin");
    userId = ctx.userId;

    const body = await req.json().catch(() => ({}));
    proposedId = typeof body?.proposed_match_id === "string" ? body.proposed_match_id : null;
    action = ACTIONS.includes(body?.action) ? (body.action as Action) : null;

    if (!proposedId) return json(400, { error: "proposed_match_id is required" });
    if (!action) return json(400, { error: `action must be one of: ${ACTIONS.join(", ")}` });

    const reason: string | null = typeof body?.reason === "string" ? body.reason.trim() : null;
    const note: string | null = typeof body?.note === "string" ? body.note : null;
    const assigneeId: string | null = typeof body?.assignee_id === "string" ? body.assignee_id : null;
    const overrideLevel: string | null = typeof body?.confidence_override === "string" ? body.confidence_override : null;
    // Phase 3 inputs
    const dueAt: string | null = typeof body?.due_at === "string" ? body.due_at : null;
    const feedbackReason: string | null = typeof body?.feedback_reason === "string" ? body.feedback_reason : null;
    const escalationTarget: string | null = typeof body?.escalation_target === "string" ? body.escalation_target : null;
    const editedPayload: Record<string, unknown> | null =
      body?.edited_payload && typeof body.edited_payload === "object" ? body.edited_payload as Record<string, unknown> : null;


    // Load current row.
    const { data: row, error: loadErr } = await admin
      .from("ai_proposed_matches")
      .select("*")
      .eq("id", proposedId)
      .maybeSingle();
    if (loadErr) throw loadErr;
    if (!row) return json(404, { error: "proposed_match not found" });

    // Reject transitions out of terminal states (except archive of a non-archived row,
    // which we still permit). Once a match is approved/rejected/archived, only archive
    // remains as a follow-up admin action.
    // Actions allowed on terminal-state rows (approved/approved_internal,
    // approved_client_view, archived, rejected, expired, closed). Everything
    // else returns 409 if the row is already terminal.
    const TERMINAL_ALLOWED: Action[] = [
      "archive",
      "reviewer_note",
      "approve_for_client_view",
      "approve_for_outreach",
      "edit_payload",
      "set_feedback_reason",
      "set_due_date",
      "assign",
      "request_rerun",
    ];
    if (TERMINAL.has(row.status) && !TERMINAL_ALLOWED.includes(action)) {
      return json(409, {
        error: `proposed_match is in terminal status '${row.status}'; action '${action}' not allowed`,
      });
    }

    const now = new Date().toISOString();
    const patch: Record<string, unknown> = { updated_at: now };
    let auditAction: string;
    const auditExtra: Record<string, unknown> = { prior_status: row.status };


    switch (action) {
      case "approve":
        patch.status = "approved";
        patch.approved_at = now;
        patch.reviewed_by = userId;
        patch.reviewed_at = now;
        if (note) patch.reviewer_note = note;
        auditAction = "ai_review.proposed_match_approved";
        break;
      case "reject":
        if (!reason) return json(400, { error: "reason is required for reject" });
        patch.status = "rejected";
        patch.rejected_at = now;
        patch.reviewed_by = userId;
        patch.reviewed_at = now;
        patch.rejection_reason = reason;
        if (note) patch.reviewer_note = note;
        auditAction = "ai_review.proposed_match_rejected";
        auditExtra.reason = reason;
        break;
      case "archive":
        patch.status = "archived";
        patch.archived_at = now;
        if (reason) auditExtra.reason = reason;
        auditAction = "ai_review.proposed_match_archived";
        break;
      case "escalate":
        if (!reason) return json(400, { error: "reason is required for escalate" });
        if (escalationTarget && !ESCALATION_TARGETS.has(escalationTarget)) {
          return json(400, { error: `escalation_target must be one of: ${Array.from(ESCALATION_TARGETS).join(", ")}` });
        }
        patch.status = "escalated";
        patch.escalation_required = true;
        patch.escalation_reason = reason;
        auditAction = "ai_review.proposed_match_escalated";
        auditExtra.reason = reason;
        if (escalationTarget) auditExtra.escalation_target = escalationTarget;
        break;

      case "needs_more_research":
        patch.status = "needs_more_research";
        if (note) patch.reviewer_note = note;
        auditAction = "ai_review.proposed_match_needs_more_research";
        break;
      case "under_review":
        patch.status = "under_review";
        patch.reviewed_by = userId;
        patch.reviewed_at = now;
        auditAction = "ai_review.proposed_match_reviewed";
        break;
      case "assign":
        if (!assigneeId) return json(400, { error: "assignee_id is required for assign" });
        patch.assigned_reviewer_id = assigneeId;
        auditAction = "ai_review.proposed_match_reviewed";
        auditExtra.assignee_id = assigneeId;
        break;
      case "reviewer_note":
        if (!note || !note.trim()) return json(400, { error: "note is required for reviewer_note" });
        patch.reviewer_note = note;
        auditAction = "ai_review.proposed_match_reviewed";
        auditExtra.note_set = true;
        break;
      case "confidence_override":
        if (!overrideLevel || !CONFIDENCE.has(overrideLevel)) {
          return json(400, { error: "confidence_override must be one of low|medium|high" });
        }
        if (!reason) return json(400, { error: "reason is required for confidence_override" });
        patch.confidence_override = overrideLevel;
        patch.confidence_override_reason = reason;
        auditAction = "ai_review.confidence_overridden";
        auditExtra.prior_confidence = row.confidence_override ?? row.confidence_level;
        auditExtra.new_confidence = overrideLevel;
        auditExtra.reason = reason;
        break;
      case "set_due_date":
        if (!dueAt) return json(400, { error: "due_at (ISO timestamp) is required" });
        if (Number.isNaN(Date.parse(dueAt))) return json(400, { error: "due_at must be a valid ISO timestamp" });
        patch.due_at = dueAt;
        auditAction = "ai_review.proposed_match_reviewed";
        auditExtra.due_at = dueAt;
        auditExtra.field = "due_at";
        break;
      case "mark_duplicate":
        patch.status = "archived";
        patch.archived_at = now;
        patch.feedback_reason = "duplicate";
        auditAction = "ai_review.proposed_match_archived";
        auditExtra.feedback_reason = "duplicate";
        auditExtra.reason = reason ?? "marked_duplicate";
        break;
      case "mark_not_relevant":
        patch.status = "archived";
        patch.archived_at = now;
        patch.feedback_reason = "not_commercially_relevant";
        auditAction = "ai_review.proposed_match_archived";
        auditExtra.feedback_reason = "not_commercially_relevant";
        auditExtra.reason = reason ?? "marked_not_relevant";
        break;
      case "set_feedback_reason":
        if (!feedbackReason || !FEEDBACK_REASONS.has(feedbackReason)) {
          return json(400, { error: `feedback_reason must be one of: ${Array.from(FEEDBACK_REASONS).join(", ")}` });
        }
        patch.feedback_reason = feedbackReason;
        auditAction = "ai_review.proposed_match_reviewed";
        auditExtra.feedback_reason = feedbackReason;
        auditExtra.field = "feedback_reason";
        break;
      case "request_rerun":
        if (!reason) return json(400, { error: "reason is required for request_rerun" });
        // Audit-only: this does NOT directly call the AI source function.
        // An admin separately clicks "Source counterparties" to actually rerun.
        auditAction = "ai_review.rerun_requested";
        auditExtra.reason = reason;
        break;
      case "approve_for_client_view": {
        // Require prior approve. Snapshot approved_payload + flip client_visible.
        const priorOk =
          row.status === "approved" ||
          row.status === "approved_internal" ||
          row.status === "approved_client_view";
        if (!priorOk) {
          return json(409, {
            error: "approve_for_client_view requires the proposal to be approved (internal) first",
          });
        }
        patch.status = "approved_client_view";
        patch.client_visible = true;
        // Snapshot the approved payload from the current advisory fields.
        patch.approved_payload = {
          suggested_counterparty_name: row.suggested_counterparty_name,
          counterparty_role: row.counterparty_role,
          jurisdiction: row.jurisdiction,
          sector_or_product_fit: row.sector_or_product_fit,
          capacity_indicator: row.capacity_indicator,
          prior_activity_summary: row.prior_activity_summary,
          source_summary: row.source_summary,
          match_rationale: row.match_rationale,
          fit_label: row.fit_label,
          confidence_level: row.confidence_override ?? row.confidence_level,
          approved_at: now,
          approved_by: userId,
        };
        patch.approved_at = patch.approved_at ?? now;
        if (reason) auditExtra.reason = reason;
        auditAction = "ai_review.proposed_match_approved_for_client_view";
        break;
      }
      case "approve_for_outreach": {
        const priorOk =
          row.status === "approved" ||
          row.status === "approved_internal" ||
          row.status === "approved_client_view";
        if (!priorOk) {
          return json(409, {
            error: "approve_for_outreach requires the proposal to be approved (internal) first",
          });
        }
        // Audit-only state marker. Phase 5 owns the outreach draft state machine.
        auditAction = "ai_review.proposed_match_approved_for_outreach";
        if (reason) auditExtra.reason = reason;
        break;
      }
      case "edit_payload": {
        if (!editedPayload) return json(400, { error: "edited_payload (object) is required" });
        // Snapshot original_payload on first edit.
        if (!row.original_payload) {
          patch.original_payload = {
            suggested_counterparty_name: row.suggested_counterparty_name,
            counterparty_role: row.counterparty_role,
            jurisdiction: row.jurisdiction,
            sector_or_product_fit: row.sector_or_product_fit,
            capacity_indicator: row.capacity_indicator,
            prior_activity_summary: row.prior_activity_summary,
            source_summary: row.source_summary,
            match_rationale: row.match_rationale,
            fit_label: row.fit_label,
            confidence_level: row.confidence_level,
            snapshot_at: now,
          };
        }
        patch.edited_payload = { ...editedPayload, edited_at: now, edited_by: userId };
        auditAction = "ai_review.proposed_match_edited";
        auditExtra.had_prior_edit = !!row.edited_payload;
        if (reason) auditExtra.reason = reason;
        break;
      }
      default:
        return json(400, { error: "unsupported action" });

    }

    if (!AI_REVIEW_AUDIT_NAMES.includes(auditAction as never)) {
      return json(500, { error: `audit name not canonical: ${auditAction}` });
    }

    const { data: updated, error: upErr } = await admin
      .from("ai_proposed_matches")
      .update(patch)
      .eq("id", proposedId)
      .select()
      .maybeSingle();
    if (upErr) throw upErr;

    await writeAdminAudit({
      admin,
      action: auditAction,
      status: "success",
      actorUserId: userId,
      targetType: "ai_proposed_match",
      targetId: proposedId,
      requestId,
      endpoint: "ai-proposed-match-decision",
      ipAddress: extractIp(req),
      userAgent: extractUserAgent(req),
      extra: auditExtra,
    });

    return json(200, { proposed_match: updated });
  } catch (e: unknown) {
    const err = e as { statusCode?: number; message?: string };
    console.error("[ai-proposed-match-decision] error:", err);
    const status = err?.statusCode ?? 500;
    try {
      await writeAdminAudit({
        admin,
        action: "ai_review.admin_override_applied",
        status: "error",
        actorUserId: userId,
        targetType: "ai_proposed_match",
        targetId: proposedId ?? undefined,
        requestId,
        endpoint: "ai-proposed-match-decision",
        reason: err?.message ?? "unknown",
        ipAddress: extractIp(req),
        userAgent: extractUserAgent(req),
        extra: { action },
      });
    } catch (_) {
      // never let audit failure mask the real error
    }
    return json(status, { error: err?.message ?? "internal error" });
  }
}
