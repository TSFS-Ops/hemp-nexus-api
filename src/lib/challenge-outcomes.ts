/**
 * Batch C - Match Challenges
 * Static, neutral outcome label catalogue.
 *
 * Single source of truth for user-facing labels of the closed
 * `outcome_code` set defined by the DB CHECK constraint on
 * public.match_challenges.outcome_code.
 *
 * No fault/blame wording. No "upheld" / "not_upheld". No party-specific
 * attribution. These labels are surfaced verbatim in UI, emails, and
 * generated outcome documents.
 *
 * Phase 1: labels only. No state-mutation logic, no rating-emission
 * logic, no notification logic lives here.
 */

export const CHALLENGE_OUTCOME_CODES = [
  "no_action_required",
  "corrected_and_proceed",
  "withdrawn_by_raiser",
  "superseded_by_updated_terms",
  "evidence_required",
  "cannot_proceed",
  "admin_override_recorded",
] as const;

export type ChallengeOutcomeCode = (typeof CHALLENGE_OUTCOME_CODES)[number];

export const CHALLENGE_OUTCOME_LABELS: Record<ChallengeOutcomeCode, string> = {
  no_action_required: "No action required",
  corrected_and_proceed: "Corrected - trade may proceed",
  withdrawn_by_raiser: "Challenge withdrawn",
  superseded_by_updated_terms: "Superseded by updated terms",
  evidence_required: "Further evidence required",
  cannot_proceed: "Match cannot proceed",
  admin_override_recorded: "Admin override recorded",
};

export const CHALLENGE_STATUSES = [
  "open",
  "under_review",
  "withdrawn",
  "outcome_recorded",
  "closed_no_action",
] as const;

export type ChallengeStatus = (typeof CHALLENGE_STATUSES)[number];

export const CHALLENGE_SUBJECT_CODES = [
  "terms_disagreement",
  "evidence_quality_concern",
  "identity_concern",
  "compliance_concern",
  "delivery_or_settlement_concern",
  "other",
] as const;

export type ChallengeSubjectCode = (typeof CHALLENGE_SUBJECT_CODES)[number];
