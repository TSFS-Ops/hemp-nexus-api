/**
 * Batch B Phase 4 — engagement-scoped progression guard.
 *
 * Single source of truth for the rule: workflow progression on a match
 * (POI mint, POI state advance, WaD create/seal, completion/finality,
 * engagement-scoped credit burn, engagement-scoped payment events) is
 * permitted ONLY when the *current* engagement (per the canonical
 * read-model resolver) is in the `accepted` state.
 *
 * Critical invariants this helper enforces:
 *   • The decision uses ONLY `current_engagement` from the read-model
 *     envelope. A historical `accepted` row that has since been
 *     superseded by a renewed `notification_sent` / `contacted` /
 *     `late_acceptance_pending_initiator_reconfirmation` child does
 *     NOT qualify. (This is the Phase 4 fix for `wad/index.ts` which
 *     previously selected on `engagement_status = 'accepted'`.)
 *   • A `late_acceptance_pending_initiator_reconfirmation` row never
 *     qualifies — the initiator must reconfirm (which mints a renewed
 *     child) and the counterparty must accept that child first.
 *   • Returns stable error codes so clients/UI/tests can rely on them.
 *
 * Stable error codes (HTTP 409):
 *   - ENGAGEMENT_REQUIRED                              — no engagement at all
 *   - ENGAGEMENT_NOT_ACCEPTED                          — pre-acceptance, no prior cycle
 *   - ENGAGEMENT_PENDING_RENEWED_ACCEPTANCE            — renewed child awaiting accept
 *   - LATE_ACCEPTANCE_PENDING_INITIATOR_RECONFIRMATION — initiator must reconfirm
 *   - ENGAGEMENT_EXPIRED                               — terminal expired, no current
 *   - ENGAGEMENT_DECLINED                              — terminal declined, no current
 */

import {
  fetchEngagementReadModelByMatchId,
  type EngagementRow,
} from "./engagement-read-model.ts";

export type EngagementGuardCode =
  | "ENGAGEMENT_REQUIRED"
  | "ENGAGEMENT_NOT_ACCEPTED"
  | "ENGAGEMENT_PENDING_RENEWED_ACCEPTANCE"
  | "LATE_ACCEPTANCE_PENDING_INITIATOR_RECONFIRMATION"
  | "ENGAGEMENT_EXPIRED"
  | "ENGAGEMENT_DECLINED"
  // D2a additions:
  | "DISPUTED_BEING_NAMED"
  | "BINDING_REVIEW_PENDING"
  | "CANCELLED_EMAIL_CHANGE";

export interface EngagementGuardDecision {
  allowed: boolean;
  code?: EngagementGuardCode;
  message?: string;
  currentStatus?: string | null;
  hasHistorical?: boolean;
}

const PRE_ACCEPTANCE_STATUSES = new Set([
  "pending",
  "notification_sent",
  "contacted",
]);

/**
 * D2a — pre-flight checks for engagement-scoped progression that are NOT
 * tied to the standard pre-acceptance / accepted lifecycle. Returns null
 * when none of the D2a blocks apply, so the caller falls through to the
 * existing CP-009 / accepted / expired / declined logic.
 *
 * Triggers:
 *   • engagement_status = 'disputed_being_named'   → DISPUTED_BEING_NAMED
 *   • engagement_status = 'cancelled_email_change' → CANCELLED_EMAIL_CHANGE
 *   • operational_state = 'binding_review_required'
 *     OR (binding_candidates IS NOT NULL AND binding_resolution IS NULL)
 *     → BINDING_REVIEW_PENDING
 */
function d2aBlockForRow(
  row: { engagement_status: string } & Record<string, unknown>,
  hasHistorical: boolean,
): EngagementGuardDecision | null {
  const status = row.engagement_status;

  if (status === "disputed_being_named") {
    return {
      allowed: false,
      code: "DISPUTED_BEING_NAMED",
      message:
        "This engagement has been recorded as disputed by the named counterparty. Workflow progression is blocked until the dispute is resolved.",
      currentStatus: status,
      hasHistorical,
    };
  }

  if (status === "cancelled_email_change") {
    return {
      allowed: false,
      code: "CANCELLED_EMAIL_CHANGE",
      message:
        "The previous engagement was cancelled because the counterparty email needed to change. A replacement engagement must be created before progression.",
      currentStatus: status,
      hasHistorical,
    };
  }

  const operationalState = row.operational_state as string | null | undefined;
  const bindingCandidates = row.binding_candidates as unknown;
  const bindingResolution = row.binding_resolution as string | null | undefined;
  const bindingPending =
    operationalState === "binding_review_required" ||
    (bindingCandidates != null && bindingResolution == null);
  if (bindingPending) {
    return {
      allowed: false,
      code: "BINDING_REVIEW_PENDING",
      message:
        "Counterparty contact requires a binding review (multiple candidate identities or a shared mailbox). Workflow progression is blocked until an admin resolves the binding.",
      currentStatus: status,
      hasHistorical,
    };
  }

  return null;
}

/**
 * Pure decision function — given a read-model envelope, return whether
 * engagement-scoped workflow progression is allowed.
 *
 * Pure / no I/O so it is trivially testable from both Deno and Vitest.
 */
export function decideEngagementProgression<R extends EngagementRow>(
  envelope: {
    current_engagement: R | null;
    latest_historical_engagement: R | null;
  },
): EngagementGuardDecision {
  const current = envelope.current_engagement;
  const historical = envelope.latest_historical_engagement;
  const hasHistorical = !!historical;

  // D2a — historical-only branches must be evaluated BEFORE the
  // existing terminal branches so that `cancelled_email_change` (which
  // is NOT in TERMINAL_STATUSES at the read-model level today) is still
  // surfaced when it is the only row and resolved as historical by a
  // future schema change. Today the row will most often arrive as
  // `current` and be caught below; this branch is the safety net.
  if (!current) {
    if (historical?.engagement_status === "cancelled_email_change") {
      return {
        allowed: false,
        code: "CANCELLED_EMAIL_CHANGE",
        message:
          "The previous engagement was cancelled because the counterparty email needed to change. A replacement engagement must be created before progression.",
        currentStatus: null,
        hasHistorical,
      };
    }
    if (historical?.engagement_status === "expired") {
      return {
        allowed: false,
        code: "ENGAGEMENT_EXPIRED",
        message:
          "Counterparty engagement has expired. The initiator must request a fresh engagement before this match can progress.",
        currentStatus: null,
        hasHistorical,
      };
    }
    if (historical?.engagement_status === "declined") {
      return {
        allowed: false,
        code: "ENGAGEMENT_DECLINED",
        message:
          "Counterparty has declined this engagement. This match cannot progress further.",
        currentStatus: null,
        hasHistorical,
      };
    }
    return {
      allowed: false,
      code: "ENGAGEMENT_REQUIRED",
      message:
        "No active counterparty engagement exists for this match. An engagement must be created and accepted before progression.",
      currentStatus: null,
      hasHistorical,
    };
  }

  // D2a — evaluate the new dispute / binding-review / cancelled-email
  // gates BEFORE the existing accepted/late-acceptance/pre-acceptance
  // branches so a disputed or binding-pending engagement is never
  // mis-classified as a normal pre-acceptance state.
  const d2aBlock = d2aBlockForRow(current as never, hasHistorical);
  if (d2aBlock) return d2aBlock;

  const status = current.engagement_status;

  if (status === "accepted") {
    return { allowed: true, currentStatus: status, hasHistorical };
  }

  if (status === "late_acceptance_pending_initiator_reconfirmation") {
    return {
      allowed: false,
      code: "LATE_ACCEPTANCE_PENDING_INITIATOR_RECONFIRMATION",
      message:
        "Counterparty accepted after the engagement window expired. The initiator must reconfirm before this match can progress.",
      currentStatus: status,
      hasHistorical,
    };
  }

  if (PRE_ACCEPTANCE_STATUSES.has(status)) {
    if (hasHistorical) {
      return {
        allowed: false,
        code: "ENGAGEMENT_PENDING_RENEWED_ACCEPTANCE",
        message:
          "A renewed engagement has been issued and is awaiting counterparty acceptance. Workflow progression is paused until the counterparty accepts the renewed engagement.",
        currentStatus: status,
        hasHistorical,
      };
    }
    return {
      allowed: false,
      code: "ENGAGEMENT_NOT_ACCEPTED",
      message:
        "Counterparty engagement has not been accepted. The counterparty must accept before this match can progress.",
      currentStatus: status,
      hasHistorical,
    };
  }

  // Defensive default — any unexpected status blocks progression.
  return {
    allowed: false,
    code: "ENGAGEMENT_NOT_ACCEPTED",
    message: `Counterparty engagement is in an unexpected state ('${status}'). Progression blocked.`,
    currentStatus: status,
    hasHistorical,
  };
}

/**
 * I/O wrapper. Fetches the canonical read-model envelope for the match
 * and applies the pure decision. Use this in every edge function that
 * performs engagement-scoped progression (POI mint/advance, WaD,
 * completion, engagement-scoped burns).
 */
export async function assertEngagementAllowsProgression(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  matchId: string,
): Promise<EngagementGuardDecision> {
  const { envelope, error } = await fetchEngagementReadModelByMatchId<EngagementRow>(
    supabase,
    matchId,
    "id, match_id, engagement_status, created_at, renewed_from_engagement_id",
  );
  if (error) {
    // Defensive: if we cannot read the engagement table, refuse rather
    // than silently allowing progression on stale state.
    return {
      allowed: false,
      code: "ENGAGEMENT_REQUIRED",
      message: "Unable to determine current engagement state for this match.",
      currentStatus: null,
      hasHistorical: false,
    };
  }
  return decideEngagementProgression(envelope);
}
