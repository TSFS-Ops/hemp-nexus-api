/**
 * Batch 1 — M018 Business Decision Register (SSOT, Deno mirror).
 * Pinned to src/lib/business-decisions.ts by
 * scripts/check-business-decision-audit-names.mjs.
 */

export const BUSINESS_DECISION_CATEGORIES = [
  "country",
  "data_source",
  "provider",
  "public_display",
  "api_output",
  "outreach_use",
  "commercial_use",
  "institutional_demo",
  "wording",
] as const;
export type BusinessDecisionCategory =
  (typeof BUSINESS_DECISION_CATEGORIES)[number];

export const BUSINESS_DECISION_STATUSES = [
  "proposed",
  "under_review",
  "approved",
  "rejected",
  "expired",
  "superseded",
] as const;
export type BusinessDecisionStatus = (typeof BUSINESS_DECISION_STATUSES)[number];

export const BUSINESS_DECISION_AUDIT_EVENT_NAMES = [
  "business_decision_recorded",
  "business_decision_status_changed",
  "business_decision_superseded",
] as const;
export type BusinessDecisionAuditEventName =
  (typeof BUSINESS_DECISION_AUDIT_EVENT_NAMES)[number];

export const BUSINESS_DECISION_MIN_RATIONALE_LENGTH = 30;
