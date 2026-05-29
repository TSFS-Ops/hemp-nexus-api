/**
 * Batch 4 — Enterprise Identity canonical audit name SSOT (Deno mirror of
 * src/lib/identity/identity-audit.ts). Drift guard:
 *   scripts/check-identity-audit-names.mjs
 *
 * Identity audit names MUST come from this module. Inline string literals
 * are forbidden — the prebuild guard fails the build otherwise.
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
  typeof IDENTITY_AUDIT_NAMES[keyof typeof IDENTITY_AUDIT_NAMES];

export const IDENTITY_AUDIT_NAME_LIST: readonly string[] = Object.freeze(
  Object.values(IDENTITY_AUDIT_NAMES),
);

/** Best-effort audit writer. Never throws — never blocks the caller. */
// deno-lint-ignore no-explicit-any
export async function writeIdentityAudit(
  admin: any,
  action: IdentityAuditName,
  payload: {
    org_id: string;
    actor_user_id: string | null;
    entity_id?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await admin.from("audit_logs").insert({
      org_id: payload.org_id,
      actor_user_id: payload.actor_user_id,
      action,
      entity_type: "org_sso_identity",
      entity_id: payload.entity_id ?? null,
      metadata: payload.metadata ?? {},
    });
  } catch (e) {
    console.error(`[identity-audit] failed to write ${action}:`, e);
  }
}
