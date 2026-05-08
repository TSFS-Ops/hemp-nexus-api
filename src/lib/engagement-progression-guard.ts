/**
 * Client mirror of `supabase/functions/_shared/engagement-progression-guard.ts`.
 *
 * The pure decision is duplicated here so frontend tests can pin
 * the same stable error codes the backend will emit. Keep in lockstep
 * with the Deno copy.
 */

import type { EngagementRow } from "./engagement-read-model";

export type EngagementGuardCode =
  | "ENGAGEMENT_REQUIRED"
  | "ENGAGEMENT_NOT_ACCEPTED"
  | "ENGAGEMENT_PENDING_RENEWED_ACCEPTANCE"
  | "LATE_ACCEPTANCE_PENDING_INITIATOR_RECONFIRMATION"
  | "ENGAGEMENT_EXPIRED"
  | "ENGAGEMENT_DECLINED";

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

export function decideEngagementProgression<R extends EngagementRow>(
  envelope: {
    current_engagement: R | null;
    latest_historical_engagement: R | null;
  },
): EngagementGuardDecision {
  const current = envelope.current_engagement;
  const historical = envelope.latest_historical_engagement;
  const hasHistorical = !!historical;

  if (!current) {
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

  return {
    allowed: false,
    code: "ENGAGEMENT_NOT_ACCEPTED",
    message: `Counterparty engagement is in an unexpected state ('${status}'). Progression blocked.`,
    currentStatus: status,
    hasHistorical,
  };
}
