/**
 * Batch 4 - SSO claim-control helper.
 *
 * Single gate that decides whether the UI may say "SSO live" for an
 * organisation. The rule is intentionally strict: we never make a live
 * claim unless all three conditions hold simultaneously.
 *
 * Anywhere the UI would otherwise render "SSO live", "SCIM live",
 * "Enterprise ready", "Bank ready" or "DFI ready" tied to identity, it
 * MUST gate on `ssoClaimAllowed()`.
 */

export type SsoStatus =
  | "not_configured"
  | "pending_metadata"
  | "configured_not_connected"
  | "live"
  | "failed"
  | "disabled";

export type SsoTestResult = "pass" | "fail" | null | undefined;

export interface SsoConfigClaimShape {
  status: SsoStatus;
  last_test_result: SsoTestResult;
  last_tested_at: string | null | undefined;
  supabase_sso_provider_id: string | null | undefined;
}

/** True only when SSO is genuinely wired and the latest test passed. */
export function ssoClaimAllowed(config: SsoConfigClaimShape | null | undefined): boolean {
  if (!config) return false;
  if (config.status !== "live") return false;
  if (config.last_test_result !== "pass") return false;
  if (!config.last_tested_at) return false;
  if (!config.supabase_sso_provider_id) return false;
  return true;
}

/** Human label rendered next to the status pill. Honest and non-marketing. */
export function ssoStatusLabel(status: SsoStatus): string {
  switch (status) {
    case "not_configured":
      return "Not configured";
    case "pending_metadata":
      return "Pending metadata";
    case "configured_not_connected":
      return "Configured - not connected";
    case "live":
      return "SSO live";
    case "failed":
      return "Failed";
    case "disabled":
      return "Disabled";
  }
}

/** Tone token consumed by the status pill. Maps to existing badge variants. */
export function ssoStatusTone(
  status: SsoStatus,
): "neutral" | "warning" | "success" | "danger" {
  switch (status) {
    case "live":
      return "success";
    case "pending_metadata":
    case "configured_not_connected":
      return "warning";
    case "failed":
      return "danger";
    case "not_configured":
    case "disabled":
      return "neutral";
  }
}

// SCIM lifecycle helpers ------------------------------------------------

export type ScimState = "invited" | "active" | "suspended" | "deprovisioned";

/**
 * Allowed SCIM lifecycle transitions. Mirrors the DB CHECK constraint
 * and is the only source of truth the UI and edge fn should consult.
 *
 * NOTE: We intentionally allow `deprovisioned` to be re-provisioned to
 * `invited` (re-invitation flow), but never directly to `active`.
 */
export const SCIM_TRANSITIONS: Record<ScimState, readonly ScimState[]> = {
  invited: ["active", "suspended", "deprovisioned"],
  active: ["suspended", "deprovisioned"],
  suspended: ["active", "deprovisioned"],
  deprovisioned: ["invited"],
};

export function isValidScimTransition(from: ScimState, to: ScimState): boolean {
  if (from === to) return false;
  return SCIM_TRANSITIONS[from].includes(to);
}
