/**
 * ai-outreach-draft-v2-decision
 * ──────────────────────────────────────────────────────────────────────
 * AI Counterparty Intelligence & Match Review.
 *
 * Single gated edge function for admin decisions on rows in
 * `ai_outreach_drafts_v2`. platform_admin only. Every action writes a
 * canonical `ai_review.*` audit.
 *
 * Supported actions (body { draft_id, action, ... }):
 *   - edit              { subject?, body? }              draft_status='draft_created'
 *   - approve           { review_note? }                 draft_status='approved_for_send'
 *   - reject            { review_note (required) }       draft_status='rejected'
 *   - mark_sent_by_human { confirmation_acknowledged }   draft_status='sent_by_human'
 *   - archive                                             draft_status='archived'
 *   - set_outcome       { outcome }                       records V1 outcome
 *
 * Phase 5 hardening:
 *   - Approve and mark_sent_by_human re-run the first-outreach content
 *     validator server-side. UI validation is not trusted.
 *   - mark_sent_by_human REQUIRES `confirmation_acknowledged === true`
 *     and persists the exact confirmation text + actor + timestamp.
 *   - set_outcome only accepts the fixed V1 outcome vocabulary.
 *
 * HARD GUARANTEES:
 *   - No provider call. No email/SMS/WhatsApp/notification dispatch.
 *   - `mark_sent_by_human` ONLY records that a human sent it manually
 *     outside the platform; it never transmits anything.
 *   - No POI/WaD/verification/match/KYB/compliance state is mutated.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import { authenticateRequest, requireRole } from "../_shared/auth.ts";
import { writeAdminAudit, extractIp, extractUserAgent } from "../_shared/admin-audit.ts";
import { clampSubject } from "../_shared/email-subject.ts";
import {
  validateFirstOutreach,
  isApprovedOutcome,
  APPROVED_OUTCOMES,
  SEND_CONFIRMATION_TEXT,
} from "../_shared/outreach-validator.ts";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const ACTIONS = ["edit", "approve", "reject", "mark_sent_by_human", "archive", "set_outcome"] as const;
type Action = (typeof ACTIONS)[number];

const TERMINAL = new Set(["sent_by_human", "rejected", "archived"]);

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

  try {
    const ctx = await authenticateRequest(req, supabaseUrl, serviceKey);
    requireRole(ctx, "platform_admin");
    userId = ctx.userId;

    const body = await req.json().catch(() => ({}));
    const draft_id = typeof body?.draft_id === "string" ? body.draft_id : null;
    const rawAction = typeof body?.action === "string" ? body.action : null;
    if (!draft_id) return json(400, { error: "draft_id is required" });
    if (!rawAction || !(ACTIONS as readonly string[]).includes(rawAction)) {
      return json(400, { error: `action must be one of: ${ACTIONS.join(", ")}` });
    }
    action = rawAction as Action;

    const cur = await admin
      .from("ai_outreach_drafts_v2")
      .select("*")
      .eq("id", draft_id)
      .maybeSingle();
    if (cur.error) throw cur.error;
    if (!cur.data) return json(404, { error: "draft not found" });

    // set_outcome can run in any post-send state; everything else respects TERMINAL.
    if (action !== "set_outcome" && TERMINAL.has(cur.data.draft_status) && action !== "archive") {
      return json(409, {
        error: `draft is in terminal status '${cur.data.draft_status}'; further changes are blocked`,
      });
    }

    const now = new Date().toISOString();
    const patch: Record<string, unknown> = { updated_at: now };
    let auditAction: string;
    const extra: Record<string, unknown> = {};
    const isFirst = cur.data.is_first_outreach !== false;

    if (action === "edit") {
      const subject = typeof body?.subject === "string" ? clampSubject(body.subject) : null;
      const bodyText = typeof body?.body === "string" ? body.body.slice(0, 6000) : null;
      if (!subject && !bodyText) {
        return json(400, { error: "edit requires at least one of subject or body" });
      }
      if (subject) patch.draft_subject = subject;
      if (bodyText) patch.draft_body = bodyText;
      patch.reviewed_by = userId;
      auditAction = "ai_review.outreach_draft_edited";
      extra.fields_edited = [subject && "subject", bodyText && "body"].filter(Boolean);
    } else if (action === "approve") {
      // Approve must validate first-outreach content. Approval ≠ send.
      if (isFirst) {
        const failed = validateFirstOutreach(
          (patch.draft_subject as string) ?? cur.data.draft_subject,
          (patch.draft_body as string) ?? cur.data.draft_body,
        );
        if (failed.length > 0) {
          return json(422, {
            error: "first_outreach_validation_failed",
            failed_categories: failed,
            message:
              "First outreach must not contain buyer/seller identity, price, volume, bank, documents, personal phone, exact location, internal/AI commentary or sensitive commercial info. Edit and try again.",
          });
        }
      }
      const review_note = typeof body?.review_note === "string" ? body.review_note.slice(0, 1000) : null;
      patch.draft_status = "approved_for_send";
      patch.reviewed_by = userId;
      patch.approved_for_send_by = userId;
      patch.approved_at = now;
      if (review_note) patch.review_note = review_note;
      auditAction = "ai_review.outreach_draft_approved";
      extra.approval_means_send = false;
    } else if (action === "reject") {
      const review_note = typeof body?.review_note === "string" ? body.review_note.trim() : "";
      if (review_note.length < 3) {
        return json(400, { error: "reject requires a review_note (min 3 chars)" });
      }
      patch.draft_status = "rejected";
      patch.reviewed_by = userId;
      patch.review_note = review_note.slice(0, 1000);
      auditAction = "ai_review.outreach_draft_rejected";
      extra.review_note = patch.review_note;
    } else if (action === "mark_sent_by_human") {
      if (cur.data.draft_status !== "approved_for_send") {
        return json(409, {
          error: "draft must be 'approved_for_send' before it can be marked sent by a human",
          current_status: cur.data.draft_status,
        });
      }
      if (body?.confirmation_acknowledged !== true) {
        return json(400, {
          error: "confirmation_acknowledged_required",
          message: "Manual send requires explicit confirmation_acknowledged=true.",
          required_text: SEND_CONFIRMATION_TEXT,
        });
      }
      // Re-run validator at send time — never trust UI-only validation.
      if (isFirst) {
        const failed = validateFirstOutreach(cur.data.draft_subject, cur.data.draft_body);
        if (failed.length > 0) {
          return json(422, {
            error: "first_outreach_validation_failed",
            failed_categories: failed,
            message:
              "This draft cannot be marked as sent — it still contains forbidden content for first outreach.",
          });
        }
      }
      patch.draft_status = "sent_by_human";
      patch.sent_by_user_id = userId;
      patch.sent_at = now;
      patch.send_confirmation_text = SEND_CONFIRMATION_TEXT;
      patch.send_confirmed_by = userId;
      patch.send_confirmed_at = now;
      auditAction = "ai_review.outreach_sent_by_human";
      extra.manual_send = true;
      extra.platform_dispatched = false;
      extra.confirmation_acknowledged = true;
    } else if (action === "archive") {
      patch.draft_status = "archived";
      auditAction = "ai_review.outreach_draft_edited";
      extra.archived = true;
    } else if (action === "set_outcome") {
      const outcome = body?.outcome;
      if (!isApprovedOutcome(outcome)) {
        return json(400, {
          error: "invalid_outcome",
          allowed: APPROVED_OUTCOMES,
        });
      }
      patch.outcome = outcome;
      patch.outcome_set_at = now;
      patch.outcome_set_by = userId;
      auditAction = "ai_review.outreach_draft_edited";
      extra.outcome = outcome;
    } else {
      return json(400, { error: "unsupported action" });
    }

    const up = await admin
      .from("ai_outreach_drafts_v2")
      .update(patch)
      .eq("id", draft_id)
      .select()
      .maybeSingle();
    if (up.error) throw up.error;

    await writeAdminAudit({
      admin,
      action: auditAction,
      status: "success",
      actorUserId: userId,
      targetType: "ai_outreach_draft_v2",
      targetId: draft_id,
      requestId,
      endpoint: "ai-outreach-draft-v2-decision",
      ipAddress: extractIp(req),
      userAgent: extractUserAgent(req),
      extra: {
        action,
        previous_status: cur.data.draft_status,
        new_status: patch.draft_status ?? cur.data.draft_status,
        is_first_outreach: isFirst,
        ...extra,
      },
    });

    return json(200, { draft: up.data });
  } catch (e: unknown) {
    const err = e as { statusCode?: number; message?: string };
    console.error("[ai-outreach-draft-v2-decision] error:", err);
    return json(err?.statusCode ?? 500, { error: err?.message ?? "internal error", action });
  }
}
