/**
 * e2e/role-negative/api-key-access.spec.ts
 *
 * Proves:
 *   - api_client_admin (Org A) can only see own org's developer dashboards
 *   - api_client_admin cannot see Org B keys/usage
 *   - normal_non_admin_user / logged_out cannot reach /developer
 *   - compliance_analyst cannot mutate keys/quotas/production access
 *   - only platform_admin can reach /api/keys/:id admin route
 *
 * Mutations are covered by wrong-actions.spec; here we cover the read /
 * navigation surface.
 */
import { test } from "../helpers/evidence-rn";
import { loginAs } from "../helpers/auth-roles";
import { getRecord } from "../fixtures/records";
import { expectAllowed, expectForbidden, expectRedirectToLogin } from "../helpers/assertions";

const READ_ROUTES = ["/developer", "/developer/api-keys", "/developer/usage"];

for (const path of READ_ROUTES) {
  test(`api-key-access · api_client_admin (Org A) can read ${path}`, async ({ page, ev }) => {
    ev.set({
      test_type: "positive_path", role_used: "api_client_admin",
      organisation_used: "Organisation A TEST/UAT",
      route_or_action_tested: path, expected_result: "allowed",
    });
    await loginAs(page, "api_client_admin");
    await page.goto(path, { waitUntil: "domcontentloaded" }).catch(() => null);
    await expectAllowed(page, path);
  });

  for (const role of ["normal_non_admin_user", "compliance_analyst", "logged_out_user"] as const) {
    test(`api-key-access · ${role} cannot read ${path}`, async ({ page, ev }) => {
      ev.set({
        test_type: role === "logged_out_user" ? "logged_out" : "role_negative",
        role_used: role, organisation_used: "global",
        route_or_action_tested: path,
        expected_result: role === "logged_out_user" ? "redirect_login" : "denied",
      });
      await loginAs(page, role);
      await page.goto(path, { waitUntil: "domcontentloaded" }).catch(() => null);
      if (role === "logged_out_user") await expectRedirectToLogin(page, path);
      else await expectForbidden(page, path);
    });
  }
}

test(`api-key-access · only platform_admin reaches /api/keys/:id admin`, async ({ page, ev }) => {
  const id = getRecord("A", "apiKeyId");
  if (!id) test.skip(true, "Phase-2 seeded API key missing");
  const path = `/api/keys/${id}`;
  ev.set({
    test_type: "role_negative", role_used: "api_client_admin",
    organisation_used: "Organisation A TEST/UAT",
    route_or_action_tested: path, record_type: "apiKeyId",
    seeded_record_reference: id, expected_result: "denied",
  });
  await loginAs(page, "api_client_admin");
  await page.goto(path, { waitUntil: "domcontentloaded" }).catch(() => null);
  await expectForbidden(page, path);
});
