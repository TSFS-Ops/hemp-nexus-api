/**
 * DATA-010 Phase 1 — Single source of truth for admin export purpose enum
 * and data-category labels.
 *
 * Every admin CSV/JSON export call MUST supply one of these `purpose`
 * values plus a non-empty `reason` (≥10 chars). Both are enforced at
 * the helper boundary AND at the server.
 */

export const EXPORT_PURPOSES = [
  "verified_user_data_export",
  "client_approved_reporting",
  "billing_or_payment_reconciliation",
  "compliance_verification_or_sanctions_review",
  "dispute_resolution",
  "legal_hold_or_legal_review",
  "technical_incident_investigation",
  "audit_or_regulatory_review",
  "izenzo_approved_client_support",
] as const;

export type ExportPurpose = (typeof EXPORT_PURPOSES)[number];

export const EXPORT_PURPOSE_LABELS: Record<ExportPurpose, string> = {
  verified_user_data_export: "Verified user data export",
  client_approved_reporting: "Client-approved reporting",
  billing_or_payment_reconciliation: "Billing or payment reconciliation",
  compliance_verification_or_sanctions_review:
    "Compliance verification or sanctions review",
  dispute_resolution: "Dispute resolution",
  legal_hold_or_legal_review: "Legal hold or legal review",
  technical_incident_investigation: "Technical incident investigation",
  audit_or_regulatory_review: "Audit or regulatory review",
  izenzo_approved_client_support: "Izenzo-approved client support",
};

export const MIN_EXPORT_REASON_LENGTH = 10;

/**
 * Prompt the operator for a reason (Phase 1 minimal UI). Returns
 * null if the user cancels or supplies a reason shorter than the
 * minimum length. Avoids silently sending a fake reason.
 */
export function promptExportReason(
  purposeLabel: string,
  defaultText = "",
): string | null {
  if (typeof window === "undefined" || typeof window.prompt !== "function") {
    return null;
  }
  const answer = window.prompt(
    `Reason for export (${purposeLabel}). Minimum ${MIN_EXPORT_REASON_LENGTH} characters.`,
    defaultText,
  );
  if (answer == null) return null;
  const trimmed = answer.trim();
  if (trimmed.length < MIN_EXPORT_REASON_LENGTH) return null;
  return trimmed;
}
