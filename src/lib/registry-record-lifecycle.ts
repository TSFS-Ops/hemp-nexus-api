/**
 * Batch 10 — Import-to-Claim Lifecycle SSOT (frontend mirror).
 *
 * Pinned to supabase/functions/_shared/registry-record-lifecycle.ts by
 * scripts/check-registry-record-lifecycle-parity.mjs.
 *
 * Rules:
 *   - claim_enabled does NOT mean verified.
 *   - claim_enabled does NOT mean authority approved.
 *   - claim_enabled does NOT mean bank details verified.
 *   - claim_enabled only allows the claim workflow to be started.
 */

export const REGISTRY_RECORD_LIFECYCLE_STATES = [
  "imported_unverified",
  "import_review_required",
  "import_review_in_progress",
  "claim_not_available",
  "claim_pending_business_decision",
  "claim_enabled",
  "claim_suspended",
  "claim_conflict_locked",
  "correction_under_review",
  "source_refresh_required",
  "stale_review_required",
  "disabled",
  "archived",
] as const;
export type RegistryRecordLifecycleState =
  (typeof REGISTRY_RECORD_LIFECYCLE_STATES)[number];

export const REGISTRY_CLAIM_ACTIVATION_STATES = [
  "claim_not_available",
  "claim_pending_business_decision",
  "claim_enabled",
  "claim_suspended",
  "claim_conflict_locked",
] as const;
export type RegistryClaimActivationState =
  (typeof REGISTRY_CLAIM_ACTIVATION_STATES)[number];

export const REGISTRY_CLAIM_AVAILABILITY_RESULTS = [
  "available",
  "not_available",
  "business_decision_required",
  "country_not_ready",
  "source_not_approved",
  "duplicate_review_required",
  "record_disabled",
  "record_archived",
  "record_stale",
  "correction_under_review",
  "claim_conflict_locked",
  "insufficient_provenance",
] as const;
export type RegistryClaimAvailabilityResult =
  (typeof REGISTRY_CLAIM_AVAILABILITY_RESULTS)[number];

/** Safe public reasons keyed by engine result. Never leaks internal blocker detail. */
export const REGISTRY_CLAIM_PUBLIC_REASONS: Record<RegistryClaimAvailabilityResult, string> = {
  available: "Claim is available for this record.",
  not_available: "Claim is not available for this record yet.",
  business_decision_required: "Claim is pending source-use approval.",
  country_not_ready: "Claim is pending country readiness.",
  source_not_approved: "Claim is pending source-use approval.",
  duplicate_review_required: "Claim is paused while the record is under review.",
  record_disabled: "Claim is not available for disabled records.",
  record_archived: "Claim is not available for archived records.",
  record_stale: "Claim is paused while the record is under review.",
  correction_under_review: "Claim is paused while the record is under review.",
  claim_conflict_locked: "Claim is paused while the record is under review.",
  insufficient_provenance: "Claim is not available for this record yet.",
};

/** Safe public-facing lifecycle labels — never expose raw internal state names. */
export const REGISTRY_PUBLIC_LIFECYCLE_LABELS = [
  "Imported record",
  "Claim available",
  "Claim not available yet",
  "Information under review",
  "Source refresh required",
  "Record disabled",
  "Not independently verified by Izenzo",
] as const;
export type RegistryPublicLifecycleLabel =
  (typeof REGISTRY_PUBLIC_LIFECYCLE_LABELS)[number];

/** Lifecycle states whose internal name MUST NOT be rendered to public users. */
export const REGISTRY_INTERNAL_ONLY_LIFECYCLE_STATES: RegistryRecordLifecycleState[] = [
  "claim_pending_business_decision",
  "claim_conflict_locked",
  "import_review_required",
  "import_review_in_progress",
];

/**
 * Lifecycle transition matrix. `any_active` is an alias resolved by isAllowedTransition.
 * Active = anything not disabled / archived.
 */
export const REGISTRY_LIFECYCLE_TRANSITIONS: ReadonlyArray<
  readonly [RegistryRecordLifecycleState | "any_active" | "any_non_public", RegistryRecordLifecycleState]
> = [
  ["imported_unverified", "import_review_required"],
  ["imported_unverified", "claim_pending_business_decision"],
  ["imported_unverified", "claim_enabled"],
  ["import_review_required", "import_review_in_progress"],
  ["import_review_in_progress", "claim_pending_business_decision"],
  ["claim_pending_business_decision", "claim_enabled"],
  ["claim_enabled", "claim_suspended"],
  ["claim_suspended", "claim_enabled"],
  ["claim_enabled", "claim_conflict_locked"],
  ["claim_conflict_locked", "claim_enabled"],
  ["any_active", "correction_under_review"],
  ["any_active", "source_refresh_required"],
  ["source_refresh_required", "import_review_required"],
  ["any_active", "stale_review_required"],
  ["any_active", "disabled"],
  ["disabled", "import_review_required"],
  ["any_non_public", "archived"],
];

const ACTIVE_STATES: RegistryRecordLifecycleState[] =
  REGISTRY_RECORD_LIFECYCLE_STATES.filter(
    (s) => s !== "disabled" && s !== "archived",
  );

const NON_PUBLIC_STATES: RegistryRecordLifecycleState[] = [
  "imported_unverified",
  "import_review_required",
  "import_review_in_progress",
  "claim_not_available",
  "claim_pending_business_decision",
  "claim_suspended",
  "claim_conflict_locked",
  "correction_under_review",
  "source_refresh_required",
  "stale_review_required",
  "disabled",
];

export function isAllowedLifecycleTransition(
  from: RegistryRecordLifecycleState,
  to: RegistryRecordLifecycleState,
): boolean {
  for (const [src, dst] of REGISTRY_LIFECYCLE_TRANSITIONS) {
    if (dst !== to) continue;
    if (src === from) return true;
    if (src === "any_active" && ACTIVE_STATES.includes(from)) return true;
    if (src === "any_non_public" && NON_PUBLIC_STATES.includes(from)) return true;
  }
  // Returning from correction / stale review to a prior active state.
  if ((from === "correction_under_review" || from === "stale_review_required") && ACTIVE_STATES.includes(to)) {
    return true;
  }
  return false;
}

/** Identity fields whose correction blocks claim activation. */
export const REGISTRY_IDENTITY_FIELDS = [
  "company_name",
  "registration_number",
  "local_number",
  "vat_number",
  "tax_number",
  "country_code",
  "country",
  "legal_form",
  "company_status",
  "registered_address",
] as const;
export type RegistryIdentityField = (typeof REGISTRY_IDENTITY_FIELDS)[number];

/** Default stale thresholds (days). */
export const REGISTRY_STALE_DEFAULTS_DAYS = {
  imported_unverified: 180,
  with_active_claim: 90,
  with_dispute_or_correction: 30,
} as const;

/** Roles permitted to approve lifecycle transitions. */
export const REGISTRY_LIFECYCLE_APPROVAL_ROLES = [
  "platform_admin",
  "compliance_owner",
] as const;
export type RegistryLifecycleApprovalRole =
  (typeof REGISTRY_LIFECYCLE_APPROVAL_ROLES)[number];

/** Canonical audit event names. */
export const REGISTRY_LIFECYCLE_AUDIT_EVENT_NAMES = [
  "registry_record_lifecycle_checked",
  "registry_record_lifecycle_transition_requested",
  "registry_record_lifecycle_transition_applied",
  "registry_record_lifecycle_transition_blocked",
  "registry_claim_availability_checked",
  "registry_claim_activation_approved",
  "registry_claim_activation_rejected",
  "registry_claim_activation_suspended",
  "registry_claim_activation_reenabled",
  "registry_record_marked_stale",
  "registry_record_stale_review_started",
  "registry_record_stale_review_completed",
  "registry_record_disabled",
  "registry_record_archived",
  "registry_record_lifecycle_note_added",
] as const;
export type RegistryLifecycleAuditEventName =
  (typeof REGISTRY_LIFECYCLE_AUDIT_EVENT_NAMES)[number];

/**
 * Map an internal lifecycle state to a safe public label.
 * Never reveal internal-only state names.
 */
export function publicLifecycleLabel(
  state: RegistryRecordLifecycleState,
  isStale: boolean,
): RegistryPublicLifecycleLabel {
  if (state === "disabled") return "Record disabled";
  if (state === "source_refresh_required") return "Source refresh required";
  if (isStale) return "Information under review";
  if (
    state === "correction_under_review" ||
    state === "stale_review_required" ||
    state === "claim_suspended" ||
    state === "claim_conflict_locked" ||
    state === "import_review_required" ||
    state === "import_review_in_progress" ||
    state === "claim_pending_business_decision"
  ) {
    return "Information under review";
  }
  if (state === "claim_enabled") return "Claim available";
  if (state === "claim_not_available") return "Claim not available yet";
  return "Imported record";
}

/**
 * Forbidden wording that must never appear alongside lifecycle/claim copy.
 * Mirrored in guard scripts.
 */
export const REGISTRY_BATCH10_FORBIDDEN_WORDING = [
  "verified company",
  "verified profile",
  "production-ready",
  "production ready",
  "institutionally usable",
  "bank details verified",
  "authority confirmed",
  "officially verified",
] as const;
