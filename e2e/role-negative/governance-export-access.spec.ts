/**
 * e2e/role-negative/governance-export-access.spec.ts
 *
 * Non-admin / wrong-tenant / logged-out cannot reach governance export
 * admin pages or direct-download a seeded export file. Proves both the
 * page-level guard and the file-route guard.
 */
import { test, expect } from "../helpers/evidence-rn";
import { loginAs } from "../helpers/auth-roles";
import { getRecord } from "../fixtures/records";
import { getDownloadAs } from "../helpers/direct-actions";
import { expectForbidden, expectRedirectToLogin, expectNoProtectedDataInNetwork } from "../helpers/assertions";

const ADVERSARIES = [
  "compliance_analyst",     // can see compliance queue but not governance export admin
  "requester_trader",
  "counterparty_user",
  "api_client_admin",
  "normal_non_admin_user",
  "other_tenant_user",
  "logged_out_user",
] as const;

for (const role of ADVERSARIES) {
  test(`governance-export · ${role} cannot reach /hq/governance-export`, async ({ page, ev }) => {
    ev.set({
      test_type: role === "logged_out_user" ? "logged_out" : "role_negative",
      role_used: role,
      organisation_used: "global",
      route_or_action_tested: "/hq/governance-export",
      expected_result: role === "logged_out_user" ? "redirect_login" : "denied",
    });
    await loginAs(page, role);
    await page.goto("/hq/governance-export", { waitUntil: "domcontentloaded" }).catch(() => null);
    if (role === "logged_out_user") await expectRedirectToLogin(page, "/hq/governance-export");
    else await expectForbidden(page, "/hq/governance-export");
  });

  test(`governance-export · ${role} cannot direct-download export`, async ({ ev }) => {
    const exportId = getRecord("A", "governanceExportId");
    if (!exportId) test.skip(true, "Phase-2 seeded export missing");
    const path = `/exports/${exportId}/download`;
    ev.set({
      test_type: "direct_backend",
      role_used: role,
      organisation_used: "Organisation A TEST/UAT",
      route_or_action_tested: path,
      record_type: "governanceExportId",
      seeded_record_reference: exportId,
      expected_result: "denied",
    });
    const { status } = await getDownloadAs(role, path);
    expect([401, 403, 404]).toContain(status);
  });
}
