/**
 * Batch C — Admin override closure governance fields.
 *
 * Closed catalogue of reason categories that may be recorded against an
 * Admin override closure. Mirrors the validation list inside the
 * `platform_admin_break_glass_progress` RPC. Neutral, governance-led
 * wording — no fault/blame language.
 */

export const ADMIN_OVERRIDE_REASON_CATEGORIES = [
  "documentation_corrected_commercial_confirmation_received",
  "compliance_review_completed",
  "regulator_or_authority_instruction",
  "platform_risk_review_completed",
  "duplicate_or_erroneous_challenge",
  "other_governance_reason",
] as const;

export type AdminOverrideReasonCategory =
  (typeof ADMIN_OVERRIDE_REASON_CATEGORIES)[number];

export const ADMIN_OVERRIDE_REASON_CATEGORY_LABELS: Record<
  AdminOverrideReasonCategory,
  string
> = {
  documentation_corrected_commercial_confirmation_received:
    "Documentation corrected — commercial confirmation received",
  compliance_review_completed: "Compliance review completed",
  regulator_or_authority_instruction: "Regulator or authority instruction",
  platform_risk_review_completed: "Platform risk review completed",
  duplicate_or_erroneous_challenge: "Duplicate or erroneous challenge",
  other_governance_reason: "Other governance reason",
};

export const REGULATOR_REFERENCE_NOT_APPLICABLE = "Not applicable";

export function normaliseRegulatorReference(input: string | null | undefined): string {
  const trimmed = (input ?? "").trim();
  return trimmed.length === 0 ? REGULATOR_REFERENCE_NOT_APPLICABLE : trimmed;
}
