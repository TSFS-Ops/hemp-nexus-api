/**
 * Batch 17 — Registry Admin Operations Centre SSOT (browser mirror).
 *
 * Single source of truth for:
 *   - work item types
 *   - source modules
 *   - SLA states
 *   - severity levels
 *   - risk categories
 *   - dashboard tile labels
 *   - readiness blocker labels
 *   - audit view labels
 *   - blocked reasons
 *   - safe empty states
 *   - forbidden wording (parity guards)
 *
 * Safety-critical copy must NEVER be hand-edited at the component layer —
 * import from this file. Pinned by:
 *   scripts/check-batch-17-operations-ssot-parity.mjs
 *   scripts/check-batch-17-operations-forbidden-words.mjs
 *   scripts/check-batch-17-operations-no-raw-bank.mjs
 *   scripts/check-batch-17-operations-route-safe.mjs
 */

// ----- Work item types -------------------------------------------------------
export const REGISTRY_OPS_WORK_ITEM_TYPES = [
  "import_batch_review",
  "import_record_validation_issue",
  "import_quarantine",
  "duplicate_candidate",
  "claim_review",
  "claim_evidence_requested",
  "authority_review",
  "authority_evidence_requested",
  "bank_detail_review",
  "bank_detail_evidence_requested",
  "bank_verification_review",
  "bank_verification_expiry",
  "correction_request",
  "dispute_review",
  "revocation_request",
  "api_client_approval",
  "api_blocked_request_review",
  "readiness_blocker",
  "risk_review",
  "audit_exception",
] as const;
export type RegistryOpsWorkItemType = (typeof REGISTRY_OPS_WORK_ITEM_TYPES)[number];

export const REGISTRY_OPS_WORK_ITEM_LABEL: Record<RegistryOpsWorkItemType, string> = {
  import_batch_review: "Import batch review",
  import_record_validation_issue: "Import validation issue",
  import_quarantine: "Quarantined import record",
  duplicate_candidate: "Duplicate candidate",
  claim_review: "Claim review",
  claim_evidence_requested: "Claim evidence requested",
  authority_review: "Authority review",
  authority_evidence_requested: "Authority evidence requested",
  bank_detail_review: "Bank-detail review",
  bank_detail_evidence_requested: "Bank-detail evidence requested",
  bank_verification_review: "Bank-verification review",
  bank_verification_expiry: "Bank-verification expiry",
  correction_request: "Correction request",
  dispute_review: "Dispute review",
  revocation_request: "Revocation request",
  api_client_approval: "API client approval",
  api_blocked_request_review: "Blocked API request review",
  readiness_blocker: "Readiness blocker",
  risk_review: "Risk review",
  audit_exception: "Audit exception",
};

// ----- Source modules --------------------------------------------------------
export const REGISTRY_OPS_SOURCE_MODULES = [
  "imports",
  "records",
  "claims",
  "authority",
  "bank_details",
  "bank_verification",
  "corrections",
  "disputes",
  "revocations",
  "api",
  "readiness",
  "risk",
  "audit",
] as const;
export type RegistryOpsSourceModule = (typeof REGISTRY_OPS_SOURCE_MODULES)[number];

export const REGISTRY_OPS_SOURCE_MODULE_LABEL: Record<RegistryOpsSourceModule, string> = {
  imports: "Imports",
  records: "Company records",
  claims: "Claims",
  authority: "Authority",
  bank_details: "Bank details",
  bank_verification: "Bank verification",
  corrections: "Corrections",
  disputes: "Disputes",
  revocations: "Revocations",
  api: "Institutional API",
  readiness: "Readiness",
  risk: "Risk",
  audit: "Audit",
};

// ----- SLA states ------------------------------------------------------------
export const REGISTRY_OPS_SLA_STATES = [
  "not_applicable",
  "within_sla",
  "approaching_sla",
  "sla_breached",
  "paused",
  "blocked",
] as const;
export type RegistryOpsSlaState = (typeof REGISTRY_OPS_SLA_STATES)[number];

export const REGISTRY_OPS_SLA_LABEL: Record<RegistryOpsSlaState, string> = {
  not_applicable: "No SLA",
  within_sla: "Within SLA",
  approaching_sla: "Approaching SLA",
  sla_breached: "SLA breached",
  paused: "Paused",
  blocked: "Blocked",
};

export const REGISTRY_OPS_SLA_TONE: Record<RegistryOpsSlaState, "neutral" | "ok" | "warn" | "danger" | "info"> = {
  not_applicable: "neutral",
  within_sla: "ok",
  approaching_sla: "warn",
  sla_breached: "danger",
  paused: "info",
  blocked: "warn",
};

/**
 * Default SLA guidance in HOURS. These are admin guidance values only —
 * they NEVER trigger automatic approvals. See guard
 * scripts/check-batch-17-operations-forbidden-words.mjs.
 */
export const REGISTRY_OPS_DEFAULT_SLA_HOURS: Record<RegistryOpsWorkItemType, number | null> = {
  import_batch_review: 72,
  import_record_validation_issue: 72,
  import_quarantine: 72,
  duplicate_candidate: 72,
  claim_review: 48,
  claim_evidence_requested: 120,
  authority_review: 48,
  authority_evidence_requested: 120,
  bank_detail_review: 24,
  bank_detail_evidence_requested: 120,
  bank_verification_review: 24,
  bank_verification_expiry: 168,
  correction_request: 72,
  dispute_review: 48,
  revocation_request: 24,
  api_client_approval: 120,
  api_blocked_request_review: 24,
  readiness_blocker: null,
  risk_review: 48,
  audit_exception: 72,
};

// ----- Severity --------------------------------------------------------------
export const REGISTRY_OPS_SEVERITIES = ["low", "medium", "high", "critical"] as const;
export type RegistryOpsSeverity = (typeof REGISTRY_OPS_SEVERITIES)[number];

export const REGISTRY_OPS_SEVERITY_LABEL: Record<RegistryOpsSeverity, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

export const REGISTRY_OPS_SEVERITY_TONE: Record<RegistryOpsSeverity, "neutral" | "warn" | "danger"> = {
  low: "neutral",
  medium: "neutral",
  high: "warn",
  critical: "danger",
};

// ----- Risk categories -------------------------------------------------------
export const REGISTRY_OPS_RISK_CATEGORIES = [
  "import_quality_risk",
  "duplicate_matching_risk",
  "claim_conflict_risk",
  "authority_risk",
  "bank_detail_evidence_risk",
  "bank_verification_risk",
  "api_misuse_risk",
  "readiness_risk",
  "dispute_risk",
  "data_staleness_risk",
  "audit_anomaly_risk",
] as const;
export type RegistryOpsRiskCategory = (typeof REGISTRY_OPS_RISK_CATEGORIES)[number];

export const REGISTRY_OPS_RISK_CATEGORY_LABEL: Record<RegistryOpsRiskCategory, string> = {
  import_quality_risk: "Import quality",
  duplicate_matching_risk: "Duplicate / matching",
  claim_conflict_risk: "Claim conflict",
  authority_risk: "Authority",
  bank_detail_evidence_risk: "Bank-detail evidence",
  bank_verification_risk: "Bank verification",
  api_misuse_risk: "API misuse",
  readiness_risk: "Readiness",
  dispute_risk: "Dispute",
  data_staleness_risk: "Data staleness",
  audit_anomaly_risk: "Audit anomaly",
};

// ----- Blocked reasons -------------------------------------------------------
export const REGISTRY_OPS_BLOCKED_REASONS = [
  "awaiting_evidence",
  "awaiting_business_decision",
  "awaiting_provider_readiness",
  "awaiting_licence",
  "awaiting_user_response",
  "awaiting_compliance_owner",
  "awaiting_platform_admin",
  "other",
] as const;
export type RegistryOpsBlockedReason = (typeof REGISTRY_OPS_BLOCKED_REASONS)[number];

export const REGISTRY_OPS_BLOCKED_REASON_LABEL: Record<RegistryOpsBlockedReason, string> = {
  awaiting_evidence: "Awaiting evidence",
  awaiting_business_decision: "Awaiting business decision",
  awaiting_provider_readiness: "Awaiting provider readiness",
  awaiting_licence: "Awaiting licence",
  awaiting_user_response: "Awaiting user response",
  awaiting_compliance_owner: "Awaiting compliance owner",
  awaiting_platform_admin: "Awaiting platform admin",
  other: "Other (see internal note)",
};

// ----- Dashboard tiles -------------------------------------------------------
export const REGISTRY_OPS_TILE_CODES = [
  "imports_pending",
  "import_validation_failures",
  "import_quarantine",
  "duplicate_candidates",
  "claims_pending",
  "authority_pending",
  "bank_details_pending",
  "bank_verification_pending",
  "corrections_pending",
  "disputes_pending",
  "revocations_pending",
  "api_clients_pending_approval",
  "api_blocked_requests",
  "api_rate_limit_breaches",
  "verification_expired",
  "verification_approaching_expiry",
  "sla_breached",
  "sla_approaching",
  "readiness_blockers",
  "high_risk_records",
  "recent_audit_activity",
] as const;
export type RegistryOpsTileCode = (typeof REGISTRY_OPS_TILE_CODES)[number];

export const REGISTRY_OPS_TILE_LABEL: Record<RegistryOpsTileCode, string> = {
  imports_pending: "Import batches pending review",
  import_validation_failures: "Import validation failures",
  import_quarantine: "Quarantined import records",
  duplicate_candidates: "Duplicate candidates",
  claims_pending: "Claim reviews pending",
  authority_pending: "Authority reviews pending",
  bank_details_pending: "Bank-detail reviews pending",
  bank_verification_pending: "Bank-verification reviews pending",
  corrections_pending: "Correction requests pending",
  disputes_pending: "Disputes pending",
  revocations_pending: "Revocation requests pending",
  api_clients_pending_approval: "API clients pending approval",
  api_blocked_requests: "Blocked API requests",
  api_rate_limit_breaches: "API rate-limit breaches",
  verification_expired: "Expired verification records",
  verification_approaching_expiry: "Verification approaching expiry",
  sla_breached: "SLA breached items",
  sla_approaching: "Approaching SLA",
  readiness_blockers: "Readiness blockers",
  high_risk_records: "High-risk records",
  recent_audit_activity: "Recent audit activity",
};

// ----- Empty states ----------------------------------------------------------
export const REGISTRY_OPS_EMPTY_COPY = {
  queue: "No operational work items match the current filters.",
  risk: "No risk items recorded for the current filters.",
  slas: "No items have an active SLA in the current filters.",
  readiness: "No readiness blockers recorded for registry operations.",
  audit: "No audit activity in the selected window.",
  specialist_unavailable: "Specialist page not available yet.",
} as const;

// ----- Forbidden wording -----------------------------------------------------
/**
 * The operations centre is an admin cockpit. It must NEVER imply that any
 * record is verified, live, production-ready or guaranteed unless the
 * accepted readiness gates have already promoted that surface. Mirrors
 * registry-readiness forbidden words and adds operations-specific bans.
 */
export const REGISTRY_OPS_FORBIDDEN_WORDS = [
  "auto-approve",
  "auto approve",
  "automatically approve",
  "auto-verify",
  "guaranteed",
] as const;

// ----- Helpers ---------------------------------------------------------------
export function computeSlaState(
  workItemType: RegistryOpsWorkItemType,
  ageHours: number,
  blocked: boolean = false,
  paused: boolean = false,
): RegistryOpsSlaState {
  if (paused) return "paused";
  if (blocked) return "blocked";
  const sla = REGISTRY_OPS_DEFAULT_SLA_HOURS[workItemType];
  if (sla == null) return "not_applicable";
  if (ageHours >= sla) return "sla_breached";
  if (ageHours >= sla * 0.75) return "approaching_sla";
  return "within_sla";
}

export function isProductionReadyClaim(text: string): boolean {
  const lowered = text.toLowerCase();
  return REGISTRY_OPS_FORBIDDEN_WORDS.some((w) => lowered.includes(w));
}

export function safeWorkItemLabel(type: string): string {
  return (REGISTRY_OPS_WORK_ITEM_LABEL as Record<string, string>)[type] ?? "Operations item";
}

export function safeRiskLabel(category: string): string {
  return (REGISTRY_OPS_RISK_CATEGORY_LABEL as Record<string, string>)[category] ?? "Risk item";
}

export function safeSourceModuleLabel(mod: string): string {
  return (REGISTRY_OPS_SOURCE_MODULE_LABEL as Record<string, string>)[mod] ?? "Module";
}

// ----- Route guards ----------------------------------------------------------
/**
 * Accepted specialist routes the operations centre is allowed to link to.
 * Used by scripts/check-batch-17-operations-route-safe.mjs to prevent the
 * centre from drifting into ad-hoc paths.
 */
export const REGISTRY_OPS_SPECIALIST_ROUTES = {
  imports: "/admin/registry/imports",
  records: "/admin/registry/records",
  claims: "/admin/registry/claims",
  claims_review: "/admin/registry/claims-review",
  claim_conflicts: "/admin/registry/claim-conflicts",
  claim_activation: "/admin/registry/claim-activation",
  authority: "/admin/registry/authority",
  authority_review: "/admin/registry/authority-review",
  bank_details: "/admin/registry/bank-details",
  bank_detail_review: "/admin/registry/bank-detail-review",
  bank_verification: "/admin/registry/bank-verification-review",
  corrections: "/admin/registry/correction-requests",
  api_clients: "/admin/registry/api-clients",
  api_usage: "/admin/registry/api-usage",
  api_management: "/admin/registry/api",
  readiness: "/admin/registry/readiness",
  decisions: "/admin/registry/decisions",
  audit: "/admin/registry/batch7-audit-log",
} as const;
export type RegistryOpsSpecialistRouteKey = keyof typeof REGISTRY_OPS_SPECIALIST_ROUTES;

/**
 * Forbidden raw field/column names that must never appear in operations
 * UI files or aggregation responses. Mirrors guardrails from batches
 * 13B/14B/15/15B/16.
 */
export const REGISTRY_OPS_FORBIDDEN_RAW_FIELDS = [
  "account_number",
  "iban",
  "branch_code",
  "swift",
  "bic",
  "account_holder",
  "bank_code",
  "provider_payload",
  "raw_provider_result",
  "raw_provider_payload",
  "full_api_key",
  "api_key_secret",
  "secret_key",
] as const;
