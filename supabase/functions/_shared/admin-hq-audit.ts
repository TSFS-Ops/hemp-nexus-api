/**
 * Phase 2 Writer Adoption — shared helper for admin HQ decisions.
 *
 * Every sensitive admin endpoint (billing hold, compliance hold, refund
 * decision, residency review, payment-dispute resolution, etc.) wraps its
 * post-RPC commit with `recordAdminHqDecision` to emit a controlled
 * `admin.hq_decision_recorded` event through the canonical governance
 * writer.
 *
 * Fail-closed: throws on writer failure; callers translate that into a
 * 500 response so the operator does not see "succeeded" for an unaudited
 * sensitive action.
 *
 * Idempotency: derived from `aggregate_id + event_type + request_id +
 * action_code` so retries (operator double-click, transient 5xx) dedupe.
 */

// deno-lint-ignore-file no-explicit-any

import {
  buildPostureSnapshot,
  writeCriticalEventWithPosture,
} from "./governance-audit-integration.ts";

export interface AdminHqDecisionInput {
  admin: any;
  /** Edge function name, e.g. "admin-billing-hold-apply". */
  sourceFunction: string;
  /** Short decision identifier — REQUIRED. e.g. "billing_hold.apply". */
  actionCode: string;
  /** Operator user id. */
  actorUserId: string;
  /** Operator role for the decision. */
  actorRole?: string | null;
  /** Affected org. */
  orgId: string;
  /** Stable aggregate id (e.g. the hold_id, refund_id, dispute_id). */
  aggregateId: string;
  /** Aggregate type — e.g. "compliance_hold", "refund_request". */
  aggregateType: string;
  /** Free-form reason. Will be redacted by the writer. REQUIRED for
   *  irreversible decisions per the Phase 2 spec. */
  reason: string;
  /** Inbound request id for tracing. */
  requestId?: string | null;
  /** Optional linked ids surfaced for Governance Record drill-down. */
  matchId?: string | null;
  poiId?: string | null;
  wadId?: string | null;
  paymentReference?: string | null;
  /** Optional posture hints (policy version, evidence level). */
  policyVersion?: string | null;
  evidenceLevel?: string | null;
  /** Operator observed AAL (aal1 / aal2). */
  aal?: string | null;
  /** Extra context — redacted; do NOT pass provider payloads here. */
  extra?: Record<string, unknown>;
}

/**
 * Emit `admin.hq_decision_recorded` (fail-closed). Caller MUST translate
 * a thrown error into HTTP 500 so the decision is not reported as
 * successful when its governance proof is missing.
 */
export async function recordAdminHqDecision(
  input: AdminHqDecisionInput,
): Promise<{ event_id: string; deduplicated: boolean }> {
  if (!input.reason || input.reason.trim().length < 8) {
    throw new Error(
      "ADMIN_HQ_REASON_REQUIRED: admin.hq_decision_recorded requires a substantive reason",
    );
  }
  return await writeCriticalEventWithPosture(input.admin, {
    event_type: "admin.hq_decision_recorded",
    org_id: input.orgId,
    aggregate_type: input.aggregateType,
    aggregate_id: input.aggregateId,
    actor_user_id: input.actorUserId,
    actor_role: input.actorRole ?? "platform_admin",
    source_function: input.sourceFunction,
    request_id: input.requestId ?? null,
    match_id: input.matchId ?? null,
    poi_id: input.poiId ?? null,
    wad_id: input.wadId ?? null,
    payment_reference: input.paymentReference ?? null,
    allowed_or_blocked: "allowed",
    reason_code: input.actionCode,
    posture: buildPostureSnapshot("Standard", {
      policy_version: input.policyVersion ?? null,
      evidence_level: input.evidenceLevel ?? null,
      check_status: { aal: input.aal ?? null },
    }),
    metadata: {
      action_code: input.actionCode,
      reason: input.reason,
      aal: input.aal ?? null,
      ...(input.extra ?? {}),
    },
    idempotency_extra: input.actionCode,
  });
}
