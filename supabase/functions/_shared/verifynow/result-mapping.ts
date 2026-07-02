/**
 * Batch V — VerifyNow result mapping (server mirror of
 * src/lib/idv/result-mapping.ts). Kept identical by a drift test.
 */

export type VerifyNowRawOutcome =
  | "clear_match"
  | "possible_mismatch"
  | "clear_mismatch"
  | "not_found"
  | "source_unavailable"
  | "timeout"
  | "provider_error"
  | "unsupported_country"
  | "unsupported_document_type"
  | "blocked_id"
  | "deceased"
  | "suspected_fraud";

export type InternalIdvStatus =
  | "idv_completed"
  | "manual_review_required"
  | "retry_required"
  | "alternative_document_required"
  | "provider_pending"
  | "provider_error"
  | "provider_not_available"
  | "blocked_pending_admin_decision"
  | "pending"
  | "failed"
  | "expired"
  | "unsupported"
  | "error";

export interface IdvOutcomeMapping {
  internal_status: InternalIdvStatus;
  user_wording: string;
  admin_wording: string;
  may_unlock_controlled_actions: boolean;
}

export const IDV_OUTCOME_MAP: Record<VerifyNowRawOutcome, IdvOutcomeMapping> = {
  clear_match: {
    internal_status: "idv_completed",
    user_wording: "Identity verification completed",
    admin_wording: "VerifyNow: clear identity match",
    may_unlock_controlled_actions: true,
  },
  possible_mismatch: {
    internal_status: "manual_review_required",
    user_wording: "Manual review required",
    admin_wording: "VerifyNow: possible mismatch — manual review",
    may_unlock_controlled_actions: false,
  },
  clear_mismatch: {
    internal_status: "manual_review_required",
    user_wording: "Manual review required",
    admin_wording: "VerifyNow: clear mismatch — manual review / blocked pending admin decision",
    may_unlock_controlled_actions: false,
  },
  not_found: {
    internal_status: "retry_required",
    user_wording: "Retry required / Alternative document required",
    admin_wording: "VerifyNow: record not found",
    may_unlock_controlled_actions: false,
  },
  source_unavailable: {
    internal_status: "provider_pending",
    user_wording: "Provider pending",
    admin_wording: "VerifyNow: upstream source unavailable",
    may_unlock_controlled_actions: false,
  },
  timeout: {
    internal_status: "provider_pending",
    user_wording: "Provider pending",
    admin_wording: "VerifyNow: timeout",
    may_unlock_controlled_actions: false,
  },
  provider_error: {
    internal_status: "provider_error",
    user_wording: "Manual review required",
    admin_wording: "VerifyNow: provider error — manual review",
    may_unlock_controlled_actions: false,
  },
  unsupported_country: {
    internal_status: "provider_not_available",
    user_wording: "Manual review required",
    admin_wording: "VerifyNow: unsupported country — manual review",
    may_unlock_controlled_actions: false,
  },
  unsupported_document_type: {
    internal_status: "provider_not_available",
    user_wording: "Manual review required",
    admin_wording: "VerifyNow: unsupported document type — manual review",
    may_unlock_controlled_actions: false,
  },
  blocked_id: {
    internal_status: "blocked_pending_admin_decision",
    user_wording: "Manual review required",
    admin_wording: "VerifyNow: blocked ID — admin decision required",
    may_unlock_controlled_actions: false,
  },
  deceased: {
    internal_status: "blocked_pending_admin_decision",
    user_wording: "Manual review required",
    admin_wording: "VerifyNow: deceased status — admin decision required",
    may_unlock_controlled_actions: false,
  },
  suspected_fraud: {
    internal_status: "blocked_pending_admin_decision",
    user_wording: "Manual review required",
    admin_wording: "VerifyNow: suspected fraud — admin decision required",
    may_unlock_controlled_actions: false,
  },
};

export interface IdvResolutionInput {
  raw_outcome: VerifyNowRawOutcome;
  route_can_unlock: boolean;
}

export interface IdvResolvedOutcome extends IdvOutcomeMapping {
  raw_outcome: VerifyNowRawOutcome;
  unlocks_controlled_actions: boolean;
}

export function resolveVerifyNowOutcome(input: IdvResolutionInput): IdvResolvedOutcome {
  const mapping = IDV_OUTCOME_MAP[input.raw_outcome];
  const unlocks = mapping.may_unlock_controlled_actions && input.route_can_unlock === true;
  const internal_status: InternalIdvStatus =
    mapping.internal_status === "idv_completed" && !unlocks
      ? "manual_review_required"
      : mapping.internal_status;
  return {
    ...mapping,
    internal_status,
    raw_outcome: input.raw_outcome,
    unlocks_controlled_actions: unlocks,
  };
}
