/**
 * DATA-010 Phase 1 — Deno mirror of src/lib/export-purpose.ts.
 *
 * Keep both files in sync. Server validates the same enum + min-reason
 * the client claims to enforce, so a malicious client cannot bypass.
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

export const MIN_EXPORT_REASON_LENGTH = 10;
