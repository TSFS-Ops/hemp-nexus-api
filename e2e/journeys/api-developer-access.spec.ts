/**
 * e2e/journeys/api-developer-access.spec.ts — POSITIVE-PATH SKELETON.
 *
 * api_client_admin can read own org developer dashboards. Cross-org
 * read denial is covered in api-key-access.spec.ts. Production-key
 * mutations are denied via wrong-actions.spec.ts. No real production
 * keys are created.
 */
import { test } from "../helpers/evidence-rn";
import { loginAs } from "../helpers/auth-roles";
import { expectAllowed } from "../helpers/assertions";

for (const path of ["/developer", "/developer/api-keys", "/developer/usage"]) {
  test(`api-developer-access · api_client_admin (Org A) loads ${path}`, async ({ page, ev }) => {
    ev.set({
      test_type: "positive_path", role_used: "api_client_admin",
      organisation_used: "Organisation A TEST/UAT", route_or_action_tested: path,
      expected_result: "allowed",
    });
    await loginAs(page, "api_client_admin");
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await expectAllowed(page, path);
  });
}
