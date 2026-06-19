/**
 * e2e/role-negative/direct-links.spec.ts
 *
 * Deep-link denial: for every tenant-scoped route with a seeded record,
 * an unrelated user (other_tenant_user, normal_non_admin_user, logged_out)
 * must not be able to reach protected data via a direct URL.
 *
 * Also asserts protected datums (record IDs themselves) do not appear
 * in the page DOM during the denial — covering the "no flash" rule.
 */
import { test } from "../helpers/evidence-rn";
import { ROUTE_MATRIX } from "../fixtures/routes";
import { loginAs } from "../helpers/auth-roles";
import { getRecord } from "../fixtures/records";
import { expectForbidden, expectRedirectToLogin, expectNoProtectedDataVisible, expectNoProtectedDataInNetwork } from "../helpers/assertions";

const ADVERSARIES = ["other_tenant_user", "normal_non_admin_user", "logged_out_user"] as const;

for (const route of ROUTE_MATRIX.filter((r) => r.tenantScoped && r.recordKey)) {
  test.describe(`direct-link · ${route.path}`, () => {
    for (const role of ADVERSARIES) {
      test(`${role} cannot deep-link ${route.path}`, async ({ page, ev }) => {
        const id = getRecord("A", route.recordKey!);
        if (!id) test.skip(true, "Phase-2 seeded record missing");
        const path = route.path.replace(":id", id!);
        ev.set({
          test_type: role === "logged_out_user" ? "logged_out" : "direct_link",
          role_used: role,
          organisation_used: "Organisation A TEST/UAT (target) — adversary external",
          route_or_action_tested: path,
          record_type: route.recordKey,
          seeded_record_reference: id,
          expected_result: role === "logged_out_user" ? "redirect_login" : "denied",
        });

        await loginAs(page, role);
        await page.goto(path, { waitUntil: "domcontentloaded" }).catch(() => null);

        if (role === "logged_out_user") {
          await expectRedirectToLogin(page, path);
        } else {
          await expectForbidden(page, path);
        }
        await expectNoProtectedDataVisible(page, [id!]);
        expectNoProtectedDataInNetwork(ev.networkBodies, [id!]);
      });
    }
  });
}
