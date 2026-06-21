// Batch 17 — Registry Admin Operations Centre SSOT (Deno mirror).
// Pinned by scripts/check-batch-17-operations-ssot-parity.mjs.
//
// Mirror of src/lib/registry-operations-centre-ssot.ts. Keep work item types,
// source modules, SLA states, severity levels, risk categories, tile codes,
// blocked reasons, default SLA hours, and forbidden words in sync.

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

export const REGISTRY_OPS_SLA_STATES = [
  "not_applicable",
  "within_sla",
  "approaching_sla",
  "sla_breached",
  "paused",
  "blocked",
] as const;

export const REGISTRY_OPS_SEVERITIES = ["low", "medium", "high", "critical"] as const;

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

export const REGISTRY_OPS_DEFAULT_SLA_HOURS: Record<string, number | null> = {
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

export const REGISTRY_OPS_FORBIDDEN_WORDS = [
  "auto-approve",
  "auto approve",
  "automatically approve",
  "auto-verify",
  "guaranteed",
] as const;

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

export function computeSlaState(
  workItemType: string,
  ageHours: number,
  blocked = false,
  paused = false,
): string {
  if (paused) return "paused";
  if (blocked) return "blocked";
  const sla = REGISTRY_OPS_DEFAULT_SLA_HOURS[workItemType];
  if (sla == null) return "not_applicable";
  if (ageHours >= sla) return "sla_breached";
  if (ageHours >= sla * 0.75) return "approaching_sla";
  return "within_sla";
}

export function ageHoursFrom(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, (Date.now() - t) / 3_600_000);
}
