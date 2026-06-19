/**
 * e2e/journeys/auth-role-landing.spec.ts
 *
 * Each role lands on the expected default surface after sign-in.
 * Landing-route expectations are codified here as the source of truth
 * for §10.A — divergence is a release-blocking failure.
 */
import { test, expect } from "../helpers/evidence-rn";
import { loginAs } from "../helpers/auth-roles";
import { type Role } from "../fixtures/users";

const LANDING: Record<Exclude<Role, "logged_out_user">, RegExp> = {
  platform_admin:        /\/hq($|[/?#])/,
  compliance_analyst:    /\/hq\/compliance|\/compliance/,
  requester_trader:      /\/desk|\/trades|\/dashboard/,
  counterparty_user:     /\/matches|\/engagements|\/desk/,
  api_client_admin:      /\/developer|\/dashboard/,
  normal_non_admin_user: /\/dashboard|\/account|\/profile/,
  other_tenant_user:     /\/desk|\/trades|\/dashboard/,
};

for (const [role, pattern] of Object.entries(LANDING) as [Exclude<Role, "logged_out_user">, RegExp][]) {
  test(`auth-role-landing · ${role} lands on appropriate surface`, async ({ page, ev }) => {
    ev.set({
      test_type: "positive_path", role_used: role, organisation_used: "Organisation A TEST/UAT",
      route_or_action_tested: "/", expected_result: `lands on ${pattern}`,
    });
    await loginAs(page, role);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    // Wait briefly for any role-based redirect.
    await page.waitForLoadState("networkidle").catch(() => {});
    expect(page.url(), `${role} should land on ${pattern}`).toMatch(pattern);
  });
}

test(`auth-role-landing · logged_out_user hitting protected route redirects to /auth`, async ({ page, ev }) => {
  ev.set({
    test_type: "logged_out", role_used: "logged_out_user", organisation_used: "global",
    route_or_action_tested: "/hq", expected_result: "redirect_login",
  });
  await loginAs(page, "logged_out_user");
  await page.goto("/hq", { waitUntil: "domcontentloaded" }).catch(() => null);
  await expect.poll(() => page.url()).toMatch(/\/auth(\?|$|#)/);
});
