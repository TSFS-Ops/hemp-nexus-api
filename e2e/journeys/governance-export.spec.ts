/**
 * e2e/journeys/governance-export.spec.ts — POSITIVE-PATH SKELETON.
 *
 * Read-side: platform_admin can open the export admin and detail page
 * for a seeded TEST/UAT export. Download mutation + AAL2 step-up are
 * exercised by Smoke A/B (existing pack) and wrong-actions.spec.ts.
 */
import { test } from "../helpers/evidence-rn";
import { loginAs } from "../helpers/auth-roles";
import { getRecord } from "../fixtures/records";
import { expectAllowed } from "../helpers/assertions";

test("governance-export · platform_admin can open /hq/governance-export", async ({ page, ev }) => {
  ev.set({
    test_type: "positive_path", role_used: "platform_admin",
    organisation_used: "global", route_or_action_tested: "/hq/governance-export",
    expected_result: "allowed",
  });
  await loginAs(page, "platform_admin");
  await page.goto("/hq/governance-export", { waitUntil: "domcontentloaded" });
  await expectAllowed(page, "/hq/governance-export");
});

test("governance-export · platform_admin can open seeded export detail", async ({ page, ev }) => {
  const id = getRecord("A", "governanceExportId");
  if (!id) test.skip(true, "Phase-2 seeded export missing");
  const path = `/governance/export/${id}`;
  ev.set({
    test_type: "positive_path", role_used: "platform_admin",
    organisation_used: "Organisation A TEST/UAT", route_or_action_tested: path,
    record_type: "governanceExportId", seeded_record_reference: id, expected_result: "allowed",
  });
  await loginAs(page, "platform_admin");
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await expectAllowed(page, path);
});
