/**
 * Batch V-UI — SSOT for user/funder-safe IDV status labels.
 *
 * Every user-facing surface (start screen, status widget, funder summary,
 * admin queue post-decision preview) MUST render status through this map.
 * Banned wording (verified / cleared / approved / passed / risk-free /
 * KYB cleared / company verified / sanctions clear / live-provider
 * verified) MUST NOT appear here — a wording-guard test enforces that.
 */

export type IdvSafeStatus =
  | "idv_completed"
  | "manual_review_accepted"
  | "manual_review_required"
  | "provider_pending"
  | "provider_not_available"
  | "provider_error"
  | "retry_required"
  | "alternative_document_required"
  | "blocked_pending_admin_decision"
  | "pending"
  | "failed"
  | "expired"
  | "unsupported"
  | "error"
  | "no_subject";

export interface IdvSafeLabel {
  label: string;
  next_action?: string;
}

export const IDV_SAFE_LABELS: Record<IdvSafeStatus, IdvSafeLabel> = {
  idv_completed: {
    label: "Identity verification completed",
    next_action: "No further action required for identity verification.",
  },
  manual_review_accepted: {
    label: "Identity review completed",
    next_action: "No further action required for identity verification.",
  },
  manual_review_required: {
    label: "Manual review required",
    next_action: "An administrator will review your submission.",
  },
  provider_pending: {
    label: "Provider pending",
    next_action: "Please check back shortly.",
  },
  provider_not_available: {
    label: "Provider not available",
    next_action: "Manual review has been opened for this submission.",
  },
  provider_error: {
    label: "Manual review required",
    next_action: "An administrator will review your submission.",
  },
  retry_required: {
    label: "Retry required",
    next_action: "Please resubmit with corrected details.",
  },
  alternative_document_required: {
    label: "Alternative document required",
    next_action: "Please submit a different accepted document.",
  },
  blocked_pending_admin_decision: {
    label: "Manual review required",
    next_action: "An administrator must review your submission.",
  },
  pending: {
    label: "Identity verification pending",
    next_action: "Please check back shortly.",
  },
  failed: {
    label: "Identity verification required",
    next_action: "Please start a new identity verification.",
  },
  expired: {
    label: "Identity verification required",
    next_action: "Your previous check has expired. Please start a new one.",
  },
  unsupported: {
    label: "Provider not available",
    next_action: "Manual review has been opened for this submission.",
  },
  error: {
    label: "Identity verification required",
    next_action: "Please try again or contact support.",
  },
  no_subject: {
    label: "Identity verification required",
    next_action: "Start identity verification to continue.",
  },
};

export function idvSafeLabel(status: string | null | undefined): IdvSafeLabel {
  const key = (status ?? "no_subject") as IdvSafeStatus;
  return IDV_SAFE_LABELS[key] ?? IDV_SAFE_LABELS.error;
}

export const IDV_BANNED_WORDING = Object.freeze([
  "verified",
  "cleared",
  "approved",
  "passed",
  "risk-free",
  "risk free",
  "kyb cleared",
  "company verified",
  "sanctions clear",
  "live-provider verified",
  "compliance approved",
]);
