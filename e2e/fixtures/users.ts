/**
 * Role → credentials map for the Role-Negative & E2E suite.
 *
 * All values come from env. Credentials are NEVER committed.
 * The seeder (`supabase/functions/seed-role-negative-e2e-fixtures`)
 * provisions each user with `email_confirm=true` and emits a shell
 * env block via `scripts/seed-role-negative-e2e.sh`.
 *
 * Roles use the EXACT labels from Daniel's approved questionnaire:
 *   platform_admin, compliance_analyst, requester_trader,
 *   counterparty_user, api_client_admin, normal_non_admin_user,
 *   other_tenant_user, logged_out_user
 *
 * `logged_out_user` has no credentials by design.
 */

export const ROLES = [
  "platform_admin",
  "compliance_analyst",
  "requester_trader",
  "counterparty_user",
  "api_client_admin",
  "normal_non_admin_user",
  "other_tenant_user",
  "logged_out_user",
] as const;

export type Role = (typeof ROLES)[number];

type Cred = { email: string; password: string } | null;

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.length ? v : undefined;
}

/**
 * `other_tenant_user` is a requester_trader in Org B used to prove
 * cross-tenant denial against Org A records.
 */
export const USERS: Record<Role, Cred> = {
  platform_admin: env("E2E_RN_PLATFORM_ADMIN_EMAIL")
    ? { email: env("E2E_RN_PLATFORM_ADMIN_EMAIL")!, password: env("E2E_RN_PASSWORD")! }
    : null,
  compliance_analyst: env("E2E_RN_COMPLIANCE_ANALYST_EMAIL")
    ? { email: env("E2E_RN_COMPLIANCE_ANALYST_EMAIL")!, password: env("E2E_RN_PASSWORD")! }
    : null,
  requester_trader: env("E2E_RN_ORG_A_REQUESTER_TRADER_EMAIL")
    ? { email: env("E2E_RN_ORG_A_REQUESTER_TRADER_EMAIL")!, password: env("E2E_RN_PASSWORD")! }
    : null,
  counterparty_user: env("E2E_RN_ORG_A_COUNTERPARTY_USER_EMAIL")
    ? { email: env("E2E_RN_ORG_A_COUNTERPARTY_USER_EMAIL")!, password: env("E2E_RN_PASSWORD")! }
    : null,
  api_client_admin: env("E2E_RN_ORG_A_API_CLIENT_ADMIN_EMAIL")
    ? { email: env("E2E_RN_ORG_A_API_CLIENT_ADMIN_EMAIL")!, password: env("E2E_RN_PASSWORD")! }
    : null,
  normal_non_admin_user: env("E2E_RN_ORG_A_NORMAL_USER_EMAIL")
    ? { email: env("E2E_RN_ORG_A_NORMAL_USER_EMAIL")!, password: env("E2E_RN_PASSWORD")! }
    : null,
  other_tenant_user: env("E2E_RN_ORG_B_REQUESTER_TRADER_EMAIL")
    ? { email: env("E2E_RN_ORG_B_REQUESTER_TRADER_EMAIL")!, password: env("E2E_RN_PASSWORD")! }
    : null,
  logged_out_user: null,
};

export function requireUser(role: Role): { email: string; password: string } {
  const u = USERS[role];
  if (!u) {
    throw new Error(
      `Missing credentials for role '${role}'. Run scripts/seed-role-negative-e2e.sh and source the emitted env block.`,
    );
  }
  return u;
}
