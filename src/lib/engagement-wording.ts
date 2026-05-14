/**
 * Batch B Phase 5 — Engagement Wording Engine (SSOT).
 *
 * Single source of truth for the user-facing language used to describe a
 * `poi_engagements` row across UI badges, descriptions, toasts, emails and
 * generated documents. Centralising this here keeps the discipline imposed
 * by Batch B intact:
 *
 *   • Before valid counterparty acceptance we MUST NOT say accepted /
 *     mutual / binding / final / sealed / completed / executed / settled,
 *     and MUST NOT imply both parties have confirmed.
 *
 *   • Late acceptance after expiry is described as "late acceptance
 *     recorded" with the original engagement still expired and progression
 *     blocked until the initiator reconfirms.
 *
 *   • If the initiator does not reconfirm within 7 calendar days we MUST
 *     NOT describe this as the system declining on their behalf. The late
 *     acceptance simply remains recorded
 *     recorded and the original engagement remains expired.
 *
 *   • Renewed child engagements pending counterparty re-acceptance MUST
 *     NOT use accepted/mutual/binding wording until the counterparty
 *     accepts the renewed engagement.
 *
 *   • WaD / settlement / execution / finality wording remains reserved for
 *     the actual WaD or completion stage — never for engagement copy.
 *
 * Scope: this module produces text. It does NOT change state-machine,
 * RPC, or progression-guard behaviour — those live in
 * `engagement-progression-guard.ts`, the `atomic_*_late_acceptance` RPCs,
 * and the `poi-engagements` edge function.
 */

export type EngagementStatusValue =
  | "pending"
  | "notification_sent"
  | "contacted"
  | "accepted"
  | "declined"
  | "expired"
  | "late_acceptance_pending_initiator_reconfirmation";

export type EngagementWordingTone = "neutral" | "pending" | "active" | "ok" | "warn" | "fail";

export interface EngagementWordingContext {
  /** Canonical engagement_status from the current row. */
  status: EngagementStatusValue | string | null | undefined;
  /** True when this row is itself a renewed child (has renewed_from_engagement_id). */
  isRenewedChild?: boolean;
  /**
   * True when this row has been superseded by a renewed child engagement.
   * Used to distinguish a stale `expired` parent that already kicked off
   * a renewal from a plain expired window.
   */
  hasRenewedChild?: boolean;
  /** True when the row's counterparty_response is `accepted_after_expiry`. */
  acceptedAfterExpiry?: boolean;
  /**
   * Optional override for the late-acceptance reconfirmation window
   * (defaults to 7 calendar days). Used in copy only.
   */
  reconfirmationWindowDays?: number;
}

export interface EngagementWording {
  /** Short label for badges. Never implies finality pre-acceptance. */
  badgeLabel: string;
  /** Visual tone hint for surface colouring. */
  tone: EngagementWordingTone;
  /** One-line headline suitable for card titles. */
  headline: string;
  /** Multi-sentence description suitable for card body / email body. */
  description: string;
  /**
   * True when the engagement state allows the POI/WaD/completion workflow
   * to progress. Mirrors `engagement-progression-guard.decideEngagementProgression`
   * — wording must agree with the guard.
   */
  progressionAllowed: boolean;
  /**
   * Stable wording-engine key for tests and analytics. Format:
   *   `engagement.<status>[.renewed_child][.accepted_after_expiry]`
   */
  key: string;
}

const DEFAULT_WINDOW_DAYS = 7;

/**
 * Get user-facing wording for an engagement row.
 * Always returns a populated object — unknown statuses fall through to a
 * neutral, non-committal label.
 */
export function getEngagementWording(ctx: EngagementWordingContext): EngagementWording {
  const status = (ctx.status ?? "") as EngagementStatusValue | string;
  const renewed = !!ctx.isRenewedChild;
  const lateRecorded = !!ctx.acceptedAfterExpiry;
  const windowDays = ctx.reconfirmationWindowDays ?? DEFAULT_WINDOW_DAYS;

  switch (status) {
    case "pending":
    case "notification_sent": {
      const key = renewed
        ? "engagement.notification_sent.renewed_child"
        : "engagement.notification_sent";
      return {
        key,
        badgeLabel: renewed ? "Renewed engagement — awaiting trading partner" : "Awaiting outreach",
        tone: "pending",
        headline: renewed
          ? "Renewed engagement pending trading partner acceptance"
          : "Pending engagement recorded",
        description: renewed
          ? "A renewed engagement has been created. The trading partner must accept the renewed engagement before the workflow can proceed. The original engagement remains expired."
          : "Counterparty details have been recorded. The compliance desk has been notified and will reach out manually. No reply has been received yet.",
        progressionAllowed: false,
      };
    }

    case "contacted": {
      const key = renewed
        ? "engagement.contacted.renewed_child"
        : "engagement.contacted";
      return {
        key,
        badgeLabel: renewed ? "Renewed engagement — awaiting trading partner" : "Outreach queued",
        tone: "active",
        headline: renewed
          ? "Renewed engagement pending trading partner acceptance"
          : "Trading partner contacted",
        description: renewed
          ? "The compliance desk has reached out about the renewed engagement. The trading partner must accept the renewed engagement before the workflow can proceed."
          : "The compliance desk has reached out to the trading partner. Awaiting their reply. No counterparty response has been recorded yet.",
        progressionAllowed: false,
      };
    }

    case "accepted": {
      const key = renewed
        ? "engagement.accepted.renewed_child"
        : "engagement.accepted";
      return {
        key,
        badgeLabel: renewed ? "Renewed engagement accepted" : "Trading partner accepted",
        tone: "ok",
        headline: renewed
          ? "Renewed engagement accepted by trading partner"
          : "Trading partner accepted the engagement",
        description: renewed
          ? "The trading partner has accepted the renewed engagement. The trade may now progress to the next workflow stage. Acceptance alone does not imply later workflow stages have occurred."
          : "The trading partner has accepted this engagement. The trade may now progress to the next workflow stage. Acceptance alone does not imply later workflow stages have occurred.",
        progressionAllowed: true,
      };
    }

    case "declined":
      return {
        key: "engagement.declined",
        badgeLabel: "Trading partner declined",
        tone: "fail",
        headline: "Trading partner declined this engagement",
        description: "The trading partner declined this engagement. The trade does not progress. You can restart the trade with the same or a different trading partner.",
        progressionAllowed: false,
      };

    case "expired": {
      // Distinguish three expired sub-shapes:
      //   • plain expired (window elapsed, no late acceptance, no renewal)
      //   • expired with late acceptance recorded but no reconfirmation
      //   • expired parent that has been superseded by a renewed child
      if (ctx.hasRenewedChild) {
        return {
          key: "engagement.expired.superseded_by_renewal",
          badgeLabel: "Original engagement expired",
          tone: "neutral",
          headline: "Original engagement expired — renewed engagement created",
          description: "The original engagement remains expired. A renewed engagement has been created and the trading partner must accept it before the workflow can proceed.",
          progressionAllowed: false,
        };
      }
      if (lateRecorded) {
        return {
          key: "engagement.expired.accepted_after_expiry",
          badgeLabel: "Late acceptance recorded",
          tone: "warn",
          headline: "Late acceptance recorded — original engagement expired",
          description: `The trading partner accepted after the engagement window elapsed. The late acceptance is recorded. The original engagement remains expired and cannot proceed unless the initiator reconfirms within ${windowDays} calendar days.`,
          progressionAllowed: false,
        };
      }
      return {
        key: "engagement.expired",
        badgeLabel: "Engagement window elapsed",
        tone: "fail",
        headline: "Engagement window elapsed",
        description: "The response window elapsed without a reply from the trading partner. The trade does not progress. You can restart the trade with the same or a different trading partner.",
        progressionAllowed: false,
      };
    }

    case "late_acceptance_pending_initiator_reconfirmation":
      return {
        key: "engagement.late_acceptance_pending_initiator_reconfirmation",
        badgeLabel: "Late acceptance — awaiting initiator reconfirmation",
        tone: "warn",
        headline: "Late acceptance recorded — awaiting initiator reconfirmation",
        description: `The trading partner accepted after the engagement window elapsed. The late acceptance is recorded and we are awaiting initiator reconfirmation. The original engagement remains expired. This does not progress the POI or WaD workflow. The initiator has ${windowDays} calendar days to reconfirm; if no reconfirmation arrives, the late acceptance remains recorded and the original engagement remains expired.`,
        progressionAllowed: false,
      };

    default:
      return {
        key: status ? `engagement.unknown.${status}` : "engagement.unknown",
        badgeLabel: status ? `Status: ${status}` : "Unknown engagement status",
        tone: "neutral",
        headline: "Engagement status unrecognised",
        description: "This engagement is in an unrecognised state. The trade cannot be assumed to have progressed. Contact support@izenzo.co.za if this persists.",
        progressionAllowed: false,
      };
  }
}

/**
 * Wording for the "no reconfirmation within window" outcome. This MUST
 * NOT be described as the system declining on the initiator's behalf —
 * the late acceptance remains recorded and the original engagement
 * remains expired.
 */
export function getReconfirmationWindowElapsedWording(
  windowDays: number = DEFAULT_WINDOW_DAYS,
): EngagementWording {
  return {
    key: "engagement.late_acceptance.reconfirmation_window_elapsed",
    badgeLabel: "Late acceptance unresolved",
    tone: "warn",
    headline: "Initiator did not reconfirm",
    description: `The initiator did not reconfirm within ${windowDays} calendar days. The late acceptance remains recorded. The original engagement remains expired and cannot proceed.`,
    progressionAllowed: false,
  };
}

/**
 * Wording for the post-reconfirmation state, before the trading partner
 * has re-accepted the renewed engagement.
 */
export function getRenewedEngagementCreatedWording(): EngagementWording {
  return {
    key: "engagement.late_acceptance.renewed_engagement_created",
    badgeLabel: "Renewed engagement — awaiting trading partner",
    tone: "active",
    headline: "Renewed engagement created",
    description: "A renewed engagement has been created. The original engagement remains expired. The trading partner must accept the renewed engagement before the workflow can proceed.",
    progressionAllowed: false,
  };
}

/**
 * Wording for the case where the initiator explicitly declines a recorded
 * late acceptance.
 */
export function getInitiatorDeclinedLateAcceptanceWording(): EngagementWording {
  return {
    key: "engagement.late_acceptance.initiator_declined",
    badgeLabel: "Late acceptance declined by initiator",
    tone: "fail",
    headline: "Initiator declined the late acceptance",
    description: "The initiator declined to reconfirm this late acceptance. The original engagement remains expired and cannot proceed.",
    progressionAllowed: false,
  };
}
