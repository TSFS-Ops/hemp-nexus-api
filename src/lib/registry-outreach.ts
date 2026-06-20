/**
 * Batch 6 — M013 / M014 / M015 / M017 Outreach + Operations + Readiness SSOT
 * (browser mirror). Mirror: supabase/functions/_shared/registry-outreach.ts
 *
 * Pinned by:
 *   - scripts/check-registry-outreach-draft-state-parity.mjs
 *   - scripts/check-registry-outreach-approval-state-parity.mjs
 *   - scripts/check-registry-outreach-dnc-parity.mjs
 *   - scripts/check-registry-outreach-audit-names.mjs
 *   - scripts/check-registry-batch6-no-auto-send.mjs
 *   - scripts/check-registry-outreach-forbidden-wording.mjs
 *   - scripts/check-registry-client-readiness-wording.mjs
 *   - scripts/check-registry-batch6-no-provider.mjs
 *
 * IMPORTANT: AI may draft outreach. AI may NEVER send outreach. Sending is
 * always a separate, audited, human-approved, log-only action.
 */

export const REGISTRY_OUTREACH_DRAFT_STATES = [
  "draft_requested",
  "draft_generated",
  "needs_review",
  "edited",
  "approved_for_send",
  "rejected",
  "cancelled",
  "expired",
] as const;
export type RegistryOutreachDraftState =
  (typeof REGISTRY_OUTREACH_DRAFT_STATES)[number];

export const REGISTRY_OUTREACH_DRAFT_STATE_LABEL: Record<
  RegistryOutreachDraftState,
  string
> = {
  draft_requested: "Draft requested",
  draft_generated: "AI draft generated",
  needs_review: "Needs human review",
  edited: "Edited (awaiting re-review)",
  approved_for_send: "Approved (manual send required)",
  rejected: "Rejected",
  cancelled: "Cancelled",
  expired: "Expired",
};

export const REGISTRY_OUTREACH_APPROVAL_STATES = [
  "queued",
  "in_review",
  "approved",
  "changes_requested",
  "rejected",
  "cancelled",
] as const;
export type RegistryOutreachApprovalState =
  (typeof REGISTRY_OUTREACH_APPROVAL_STATES)[number];

export const REGISTRY_OUTREACH_REVIEW_ACTIONS = [
  "review_draft",
  "edit_draft",
  "approve",
  "reject",
  "request_changes",
  "cancel",
  "mark_do_not_contact",
  "suppress_contact",
  "record_manual_send_outcome",
] as const;
export type RegistryOutreachReviewAction =
  (typeof REGISTRY_OUTREACH_REVIEW_ACTIONS)[number];

export const REGISTRY_OUTREACH_CHANNELS = [
  "email",
  "letter",
  "internal_note",
] as const;
export type RegistryOutreachChannel = (typeof REGISTRY_OUTREACH_CHANNELS)[number];

export const REGISTRY_OUTREACH_SEND_METHODS = [
  "manual_external",
  "internal_log_only",
] as const;
export type RegistryOutreachSendMethod =
  (typeof REGISTRY_OUTREACH_SEND_METHODS)[number];

export const REGISTRY_OUTREACH_SEND_OUTCOMES = [
  "sent",
  "failed",
  "no_response",
  "not_sent",
] as const;
export type RegistryOutreachSendOutcome =
  (typeof REGISTRY_OUTREACH_SEND_OUTCOMES)[number];

export const REGISTRY_OUTREACH_AUDIT_EVENT_NAMES = [
  "registry_outreach_draft_requested",
  "registry_outreach_draft_generated",
  "registry_outreach_draft_edited",
  "registry_outreach_draft_approved",
  "registry_outreach_draft_rejected",
  "registry_outreach_changes_requested",
  "registry_outreach_cancelled",
  "registry_outreach_do_not_contact_added",
  "registry_outreach_suppressed",
  "registry_outreach_send_logged",
  "registry_admin_operations_viewed",
  "registry_client_readiness_viewed",
] as const;
export type RegistryOutreachAuditEventName =
  (typeof REGISTRY_OUTREACH_AUDIT_EVENT_NAMES)[number];

/**
 * Mandatory copy that MUST appear on every outreach UI surface. Pinned by
 * scripts/check-registry-batch6-no-auto-send.mjs. Do not paraphrase.
 */
export const REGISTRY_OUTREACH_NO_AUTO_SEND_COPY =
  "AI may draft outreach, but it must not send outreach automatically. A human reviewer must approve the wording, permitted-use basis and recipient before any send is logged or performed.";

/**
 * Mandatory label on every AI-generated draft body. Pinned by
 * scripts/check-registry-outreach-forbidden-wording.mjs.
 */
export const REGISTRY_OUTREACH_AI_DRAFT_LABEL =
  "[AI-generated draft — not yet reviewed or approved for send]";

/**
 * Wording that AI drafts MUST NOT contain (unless the corresponding state
 * machine actually proves the claim).
 */
export const REGISTRY_OUTREACH_FORBIDDEN_DRAFT_PHRASES = [
  "is verified",
  "are verified",
  "officially verified",
  "verified by us",
  "verified by izenzo",
  "guaranteed",
  "guarantee",
  "live on the platform",
  "production-ready",
  "fully approved",
  "confirmed authority",
] as const;

/** Returns true if the AI draft body is safe given the wording rules. */
export function isDraftWordingSafe(body: string): { ok: boolean; offenders: string[] } {
  const lower = body.toLowerCase();
  const offenders = REGISTRY_OUTREACH_FORBIDDEN_DRAFT_PHRASES.filter((p) =>
    lower.includes(p),
  );
  return { ok: offenders.length === 0, offenders };
}

/** Eligibility result for AI-draft generation. */
export interface OutreachEligibility {
  allowed: boolean;
  reason?:
    | "do_not_contact"
    | "country_not_ready"
    | "module_disabled"
    | "missing_permitted_use"
    | "missing_reason"
    | "expired_request";
}

export function evaluateOutreachEligibility(input: {
  do_not_contact: boolean;
  country_ready: boolean;
  module_enabled: boolean;
  reason_for_outreach: string;
  permitted_use_basis: string;
}): OutreachEligibility {
  if (input.do_not_contact) return { allowed: false, reason: "do_not_contact" };
  if (!input.module_enabled) return { allowed: false, reason: "module_disabled" };
  if (!input.country_ready) return { allowed: false, reason: "country_not_ready" };
  if (!input.reason_for_outreach?.trim()) return { allowed: false, reason: "missing_reason" };
  if (!input.permitted_use_basis?.trim()) return { allowed: false, reason: "missing_permitted_use" };
  return { allowed: true };
}

/* ─────────────── M017 Client-Safe Readiness SSOT ─────────────── */

export const REGISTRY_CLIENT_READINESS_BUCKETS = [
  "production_ready",
  "client_demo_ready",
  "shell_ready",
  "test_data_ready",
  "seed_only",
  "sample_only",
  "provider_pending",
  "data_pending",
  "licence_pending",
  "business_decision_required",
  "disabled",
] as const;
export type RegistryClientReadinessBucket =
  (typeof REGISTRY_CLIENT_READINESS_BUCKETS)[number];

export const REGISTRY_CLIENT_READINESS_COPY: Record<
  RegistryClientReadinessBucket,
  string
> = {
  production_ready:
    "Approved for operational use. Records here have passed the required source, provenance and decision-register checks.",
  client_demo_ready:
    "Approved for controlled client walkthroughs using clearly labelled demo content. Do not present as a record of truth.",
  shell_ready:
    "Shell only. The user interface exists, but no records have been loaded and the workflow is not operational. Nothing shown here may be treated as a record of truth.",
  test_data_ready:
    "Test data is available for internal walkthroughs only. Do not present any record as a record of truth.",
  seed_only:
    "Seed data only. Country coverage is seed-only. Results are not production-ready and must not be presented as live data.",
  sample_only:
    "Illustrative sample only. Do not treat any record as a record of truth.",
  provider_pending:
    "A required data or verification provider is not yet connected. Status checks cannot be performed and nothing here may be presented as live.",
  data_pending:
    "Required source data has not yet been loaded under an approved licence and provenance entry.",
  licence_pending:
    "A required data or commercial licence has not yet been recorded.",
  business_decision_required:
    "A Business Decision must be recorded before this surface can be presented as institutionally usable.",
  disabled: "This module has been switched off pending a recorded decision.",
};

export const REGISTRY_CLIENT_READINESS_HEADLINE: Record<
  RegistryClientReadinessBucket,
  string
> = {
  production_ready: "Production",
  client_demo_ready: "Demo only",
  shell_ready: "Shell only",
  test_data_ready: "Test data only",
  seed_only: "Seed data only",
  sample_only: "Sample only",
  provider_pending: "Provider pending",
  data_pending: "Data pending",
  licence_pending: "Licence pending",
  business_decision_required: "Decision required",
  disabled: "Disabled",
};

/**
 * Forbidden words on the client-safe readiness page when the bucket is not
 * production_ready. Pinned by check-registry-client-readiness-wording.mjs.
 */
export const REGISTRY_CLIENT_READINESS_FORBIDDEN_WHEN_NOT_PROD = [
  "live",
  "verified",
  "guaranteed",
  "production-ready",
] as const;

export function isProductionBucket(b: RegistryClientReadinessBucket): boolean {
  return b === "production_ready";
}
