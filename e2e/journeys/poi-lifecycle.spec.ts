/**
 * e2e/journeys/poi-lifecycle.spec.ts — POSITIVE-PATH SKELETON.
 *
 * Read-side: parties can open the seeded POI, wrong tenants and
 * normals cannot. Issuance / completion / rejection / annulment are
 * covered as direct-backend denials in wrong-actions.spec.ts to avoid
 * mutating the seeded record from the journey spec. Full state-machine
 * drive-through is Phase 2.
 */
import { test } from "../helpers/evidence-rn";
import { loginAs } from "../helpers/auth-roles";
import { getRecord } from "../fixtures/records";
import { expectAllowed, expectForbidden } from "../helpers/assertions";

const PARTIES = ["platform_admin", "requester_trader", "counterparty_user", "compliance_analyst"] as const;
const NON_PARTIES = ["normal_non_admin_user", "other_tenant_user", "api_client_admin"] as const;

for (const role of PARTIES) {
  test(`poi-lifecycle · ${role} can view seeded POI`, async ({ page, ev }) => {
    const id = getRecord("A", "poiId");
    if (!id) test.skip(true, "Phase-2 seeded POI missing");
    const path = `/poi/${id}`;
    ev.set({
      test_type: "positive_path", role_used: role,
      organisation_used: "Organisation A TEST/UAT", route_or_action_tested: path,
      record_type: "poiId", seeded_record_reference: id, expected_result: "allowed",
    });
    await loginAs(page, role);
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await expectAllowed(page, path);
  });
}

for (const role of NON_PARTIES) {
  test(`poi-lifecycle · ${role} cannot view seeded POI`, async ({ page, ev }) => {
    const id = getRecord("A", "poiId");
    if (!id) test.skip(true, "Phase-2 seeded POI missing");
    const path = `/poi/${id}`;
    ev.set({
      test_type: role === "other_tenant_user" ? "wrong_tenant" : "role_negative",
      role_used: role, organisation_used: "Organisation A TEST/UAT",
      route_or_action_tested: path, record_type: "poiId",
      seeded_record_reference: id, expected_result: "denied",
    });
    await loginAs(page, role);
    await page.goto(path, { waitUntil: "domcontentloaded" }).catch(() => null);
    await expectForbidden(page, path);
  });
}
