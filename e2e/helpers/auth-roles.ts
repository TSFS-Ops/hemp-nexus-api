/**
 * Role-aware sign-in helpers for the Role-Negative & E2E suite.
 *
 * Reuses the proven `signIn` helper from e2e/helpers/auth.ts (which
 * places a valid Supabase session in localStorage so hard-refresh
 * persistence works). Each `loginAs<Role>` is a thin wrapper that:
 *
 *   1. Resolves credentials from env via `requireUser(role)`.
 *   2. Calls signIn(page, ...).
 *   3. For logged_out_user: clears storage and returns.
 *
 * Tests should NEVER reference passwords directly.
 */
import type { Page } from "@playwright/test";
import { signIn, signOut } from "./auth";
import { type Role, requireUser } from "../fixtures/users";

export async function loginAs(page: Page, role: Role): Promise<void> {
  if (role === "logged_out_user") {
    await signOut(page);
    return;
  }
  const { email, password } = requireUser(role);
  await signIn(page, email, password);
}

export const loginAsPlatformAdmin       = (p: Page) => loginAs(p, "platform_admin");
export const loginAsComplianceAnalyst   = (p: Page) => loginAs(p, "compliance_analyst");
export const loginAsRequesterTrader     = (p: Page) => loginAs(p, "requester_trader");
export const loginAsCounterpartyUser    = (p: Page) => loginAs(p, "counterparty_user");
export const loginAsApiClientAdmin      = (p: Page) => loginAs(p, "api_client_admin");
export const loginAsNormalNonAdminUser  = (p: Page) => loginAs(p, "normal_non_admin_user");
export const loginAsOtherTenantUser     = (p: Page) => loginAs(p, "other_tenant_user");
export const logout                     = (p: Page) => signOut(p);
