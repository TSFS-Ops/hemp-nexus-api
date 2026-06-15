/**
 * Batch 4 - Enterprise Identity canonical audit name SSOT (browser mirror
 * of supabase/functions/_shared/identity-audit.ts). Drift guard:
 *   scripts/check-identity-audit-names.mjs
 */

export const IDENTITY_AUDIT_NAMES = {
  sso_config_created: "identity.sso_config_created",
  sso_metadata_updated: "identity.sso_metadata_updated",
  sso_domains_updated: "identity.sso_domains_updated",
  sso_connection_tested: "identity.sso_connection_tested",
  sso_enabled: "identity.sso_enabled",
  sso_disabled: "identity.sso_disabled",
  sso_failed: "identity.sso_failed",
  scim_user_provisioned: "identity.scim_user_provisioned",
  scim_user_suspended: "identity.scim_user_suspended",
  scim_user_deprovisioned: "identity.scim_user_deprovisioned",
} as const;

export type IdentityAuditName =
  (typeof IDENTITY_AUDIT_NAMES)[keyof typeof IDENTITY_AUDIT_NAMES];

export const IDENTITY_AUDIT_NAME_LIST: readonly string[] = Object.freeze(
  Object.values(IDENTITY_AUDIT_NAMES),
);
