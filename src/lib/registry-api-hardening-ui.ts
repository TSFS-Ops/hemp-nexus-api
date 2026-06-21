/**
 * Batch 15B — Institutional API Admin UI SSOT (browser only).
 *
 * Pure presentational helpers, label maps and safety-critical copy used by
 * the Batch 15B admin pages. Does NOT duplicate Batch 15 backend SSOT —
 * it imports from src/lib/registry-api-hardening.ts.
 *
 * Pinned by:
 *  - scripts/check-batch-15b-ui-no-raw-bank.mjs
 *  - scripts/check-batch-15b-ui-no-full-key.mjs
 *  - scripts/check-batch-15b-ui-forbidden-scopes.mjs
 *  - scripts/check-batch-15b-ui-prod-ack.mjs
 *
 * Safety contract:
 *  - No raw or masked bank fields are surfaced.
 *  - No raw personal contact fields are surfaced.
 *  - Full API keys are never rendered after creation.
 *  - Forbidden scopes are visible but non-selectable.
 *  - Suspended/revoked/expired/disabled clients never render as active.
 *  - Only final unexpired Batch 14 `verified` may render as verified.
 */

import {
  REGISTRY_API_FORBIDDEN_SCOPES,
  REGISTRY_API_HARDENED_SCOPES,
  REGISTRY_API_CALLABLE_LIFECYCLE_STATUSES,
  REGISTRY_API_PRODUCTION_ACKNOWLEDGEMENT_TEXT,
  type RegistryApiClientLifecycleStatus,
  type RegistryApiHardenedResultState,
  type RegistryApiMode,
} from "./registry-api-hardening";

/** Canonical safety strings exposed verbatim on the Batch 15B admin UI. */
export const REGISTRY_API_UI_COPY = {
  productionAcknowledgement: REGISTRY_API_PRODUCTION_ACKNOWLEDGEMENT_TEXT,
  testConsoleWarning:
    "Test console response. Safe envelope only. Raw bank details are not returned.",
  forbiddenScopesExplanation:
    "Raw bank-detail, personal-contact and evidence scopes are not available in this release.",
  keyVisibilityWarning:
    "Full API keys are never displayed after creation. Only the key reference, last four digits, status, and creation date are shown.",
  rawBankProhibition:
    "Raw bank account numbers, sort codes, IBANs and SWIFT/BIC values are never exposed through any API admin surface.",
} as const;

/** Lifecycle statuses that visibly render as active in the UI. */
export const REGISTRY_API_ACTIVE_LIFECYCLE_STATUSES: ReadonlyArray<RegistryApiClientLifecycleStatus> =
  REGISTRY_API_CALLABLE_LIFECYCLE_STATUSES;

export function isClientLifecycleActive(
  status: string | null | undefined,
): boolean {
  if (!status) return false;
  return (REGISTRY_API_ACTIVE_LIFECYCLE_STATUSES as readonly string[]).includes(
    status,
  );
}

/** Lifecycle statuses that must always render with a hard "blocked" tone. */
export const REGISTRY_API_BLOCKED_LIFECYCLE_STATUSES: ReadonlyArray<RegistryApiClientLifecycleStatus> =
  ["suspended", "revoked", "expired", "disabled"];

export function isClientLifecycleBlocked(
  status: string | null | undefined,
): boolean {
  if (!status) return false;
  return (REGISTRY_API_BLOCKED_LIFECYCLE_STATUSES as readonly string[]).includes(
    status,
  );
}

/** Display tone tokens — used by Badge variants without leaking raw colors. */
export type LifecycleTone = "neutral" | "info" | "good" | "warning" | "bad";

export function lifecycleTone(status: string | null | undefined): LifecycleTone {
  if (!status) return "neutral";
  if (isClientLifecycleBlocked(status)) return "bad";
  if (status === "production_active") return "good";
  if (status === "sandbox_active" || status === "demo_active") return "info";
  if (status === "pending_approval" || status === "production_pending") return "warning";
  return "neutral";
}

/** Mode display labels — safe to render directly. */
export const REGISTRY_API_MODE_LABELS: Record<RegistryApiMode, string> = {
  disabled: "Disabled",
  sandbox: "Sandbox",
  demo: "Demo",
  limited_production: "Limited production",
  production: "Production",
};

/** Lifecycle display labels — safe to render directly. */
export const REGISTRY_API_LIFECYCLE_LABELS: Record<
  RegistryApiClientLifecycleStatus,
  string
> = {
  draft: "Draft",
  pending_approval: "Pending approval",
  sandbox_active: "Sandbox active",
  demo_active: "Demo active",
  production_pending: "Production pending",
  production_active: "Production active",
  suspended: "Suspended",
  revoked: "Revoked",
  expired: "Expired",
  disabled: "Disabled",
};

/** Blocked-event reason labels — never include raw bank wording. */
export const REGISTRY_API_BLOCKED_REASON_LABELS: Record<string, string> = {
  scope_not_allowed: "Scope not allowed",
  scope_not_granted: "Scope not granted",
  scope_forbidden: "Scope is on the forbidden list",
  country_not_allowed: "Country not allowed",
  use_case_not_allowed: "Use case not allowed",
  client_suspended: "Client suspended",
  client_revoked: "Client revoked",
  client_expired: "Client expired",
  client_disabled: "Client disabled",
  key_revoked: "API key revoked",
  key_expired: "API key expired",
  key_missing: "API key missing",
  mode_incompatible: "Mode incompatible with key/lifecycle",
  production_not_approved: "Production access not approved",
  business_decision_required: "Business decision required",
  payment_status_not_verified: "Payment status not verified",
  rate_limited: "Rate limit exceeded",
  api_client_not_allowed: "API client not allowed",
};

export function describeBlockedReason(reason: string | null | undefined): string {
  if (!reason) return "Blocked";
  return REGISTRY_API_BLOCKED_REASON_LABELS[reason] ?? reason;
}

/** Payment-status display labels — `verified` ONLY for final unexpired verified. */
export const REGISTRY_API_PAYMENT_STATUS_NOT_VERIFIED_LABELS: Record<string, string> = {
  not_started: "Not verified — not started",
  not_submitted: "Not verified — no submission",
  bank_details_not_submitted: "Not verified — no submission",
  captured_unverified: "Not verified — captured, awaiting review",
  bank_details_captured_unverified: "Not verified — captured, awaiting review",
  verification_requested: "Not verified — verification requested",
  manual_review_required: "Not verified — manual review required",
  provider_pending: "Not verified — provider check pending",
  provider_check_in_progress: "Not verified — provider check in progress",
  provider_matched: "Not verified — provider matched, not yet promoted",
  manual_verified: "Not verified — manually attested, not yet promoted",
  bank_verification_pending: "Not verified — verification pending",
  provider_mismatch: "Not verified — provider mismatch",
  provider_error: "Not verified — provider error",
  provider_unavailable: "Not verified — provider unavailable",
  bank_verification_unavailable: "Not verified — verification unavailable",
  failed: "Not verified — verification failed",
  bank_verification_failed: "Not verified — verification failed",
  expired: "Not verified — verification expired",
  bank_verification_expired: "Not verified — verification expired",
  revoked: "Not verified — verification revoked",
  bank_verification_revoked: "Not verified — verification revoked",
  disputed: "Not verified — under dispute",
  bank_verification_disputed: "Not verified — under dispute",
  cancelled: "Not verified — cancelled",
};

/**
 * Render payment-status truthfully.
 *
 * Returns `verified` ONLY when:
 *   - resultState is the API's `usable` mapping for payment status (i.e. the
 *     backend computed Batch 14 final-verified and `expires_at` is in the
 *     future), AND
 *   - `usable === true` (gate evaluator passed).
 *
 * Everything else, including provider_matched / manual_verified / expired /
 * revoked / disputed, must render as NOT verified.
 */
export function paymentStatusLabel(input: {
  resultState: RegistryApiHardenedResultState | string | null;
  usable: boolean | null;
  rawVerificationStatus?: string | null;
  expiresAt?: string | null;
}): { label: string; isVerified: boolean } {
  const expiresInFuture = input.expiresAt
    ? new Date(input.expiresAt).getTime() > Date.now()
    : true;
  if (input.resultState === "usable" && input.usable === true && expiresInFuture) {
    return { label: "Verified", isVerified: true };
  }
  if (input.rawVerificationStatus) {
    const mapped = REGISTRY_API_PAYMENT_STATUS_NOT_VERIFIED_LABELS[input.rawVerificationStatus];
    if (mapped) return { label: mapped, isVerified: false };
  }
  if (typeof input.resultState === "string") {
    const mapped = REGISTRY_API_PAYMENT_STATUS_NOT_VERIFIED_LABELS[input.resultState];
    if (mapped) return { label: mapped, isVerified: false };
  }
  return { label: "Not verified", isVerified: false };
}

/** Source of truth for the "forbidden scope" toggle behaviour. */
export interface ScopeOption {
  scopeKey: string;
  selectable: boolean;
  forbidden: boolean;
  label: string;
}

const SCOPE_LABELS: Record<string, string> = {
  "registry.search": "Registry search",
  "registry.profile.status.read": "Profile status (read)",
  "registry.profile.summary.read": "Profile summary (read)",
  "registry.claim.status.read": "Claim status (read)",
  "registry.authority.status.read": "Authority status (read)",
  "registry.bank.status.read": "Bank-detail status (read, no raw data)",
  "registry.payment_status.read": "Payment status (read)",
  "registry.coverage.read": "Coverage (read)",
  "registry.readiness.read": "Readiness (read)",
  "registry.usage.read": "Usage (read)",
  "registry.bank.raw.read": "Raw bank details (FORBIDDEN)",
  "registry.bank.unmasked.read": "Unmasked bank details (FORBIDDEN)",
  "registry.personal_contact.raw.read": "Raw personal contact (FORBIDDEN)",
  "registry.evidence.raw.read": "Raw evidence (FORBIDDEN)",
};

export function buildScopeOptions(): ScopeOption[] {
  const allowed: ScopeOption[] = REGISTRY_API_HARDENED_SCOPES.map((s) => ({
    scopeKey: s,
    selectable: true,
    forbidden: false,
    label: SCOPE_LABELS[s] ?? s,
  }));
  const forbidden: ScopeOption[] = REGISTRY_API_FORBIDDEN_SCOPES.map((s) => ({
    scopeKey: s,
    selectable: false,
    forbidden: true,
    label: SCOPE_LABELS[s] ?? s,
  }));
  return [...allowed, ...forbidden];
}

/**
 * Sanitise a key reference for display. Accepts a "last four" value or a
 * full token; if anything that looks like a full token is passed in, returns
 * a placeholder rather than leaking it.
 */
export function safeKeyReference(input: {
  lastFour?: string | null;
  keyPrefix?: string | null;
}): string {
  const lf = (input.lastFour ?? "").trim();
  const prefix = (input.keyPrefix ?? "").trim();
  // Hard guard: never render a value that looks like a full secret.
  if (lf.length > 6) return "••••";
  if (prefix.length > 12) return "••••";
  if (!lf && !prefix) return "—";
  return `${prefix ? prefix + "_" : ""}••••${lf || ""}`;
}

/** Production approval requires every box to be ticked. */
export interface ProductionApprovalChecklist {
  hasAllowedCountries: boolean;
  hasAllowedScopes: boolean;
  hasAllowedUseCase: boolean;
  hasRateLimitProfile: boolean;
  hasBusinessDecisionReference: boolean;
  hasApprovalReason: boolean;
  acknowledged: boolean;
}

export function isProductionApprovalReady(c: ProductionApprovalChecklist): boolean {
  return (
    c.hasAllowedCountries &&
    c.hasAllowedScopes &&
    c.hasAllowedUseCase &&
    c.hasRateLimitProfile &&
    c.hasBusinessDecisionReference &&
    c.hasApprovalReason &&
    c.acknowledged
  );
}

/** Build a non-leaking summary of approved configuration. */
export function summariseList(values: ReadonlyArray<string> | null | undefined, max = 3): string {
  if (!values || values.length === 0) return "—";
  if (values.length <= max) return values.join(", ");
  return `${values.slice(0, max).join(", ")} +${values.length - max}`;
}
