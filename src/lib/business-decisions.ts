/**
 * Batch 1 — M018 Business Decision Register (SSOT).
 *
 * Pinned by scripts/check-business-decision-audit-names.mjs.
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

export const BUSINESS_DECISION_CATEGORY_LABEL: Record<BusinessDecisionCategory, string> = {
  country: "Country approval",
  data_source: "Data source approval",
  provider: "Provider approval",
  public_display: "Public display rule",
  api_output: "API output rule",
  outreach_use: "Outreach use rule",
  commercial_use: "Commercial use rule",
  institutional_demo: "Institutional demo rule",
  wording: "Wording / claim rule",
};

export const BUSINESS_DECISION_STATUS_LABEL: Record<BusinessDecisionStatus, string> = {
  proposed: "Proposed",
  under_review: "Under review",
  approved: "Approved",
  rejected: "Rejected",
  expired: "Expired",
  superseded: "Superseded",
};

export interface BusinessDecisionRow {
  id: string;
  title: string;
  category: BusinessDecisionCategory;
  decision_key: string;
  status: BusinessDecisionStatus;
  rationale: string;
  is_public: boolean;
  effective_at: string | null;
  review_at: string | null;
  expiry_at: string | null;
  owner_role: string | null;
  evidence_url: string | null;
  created_at: string;
  updated_at: string;
}
