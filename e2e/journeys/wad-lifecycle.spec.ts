/**
 * e2e/journeys/wad-lifecycle.spec.ts — POSITIVE-PATH SKELETON.
 *
 * Read-side view tests for the seeded WaD. Issuance/sealing/attestation
 * are wrong-action tests against disallowed roles (wrong-actions.spec)
 * to prove the gate without altering the seeded WaD state. Phase 2 adds
 * full state-machine progression on a per-run scratch WaD.
 */
import { test } from "../helpers/evidence-rn";
import { loginAs } from "../helpers/auth-roles";
import { getRecord } from "../fixtures/records";
import { expectAllowed, expectForbidden } from "../helpers/assertions";

const PARTIES = ["platform_admin", "requester_trader", "counterparty_user", "compliance_analyst"] as const;
const NON_PARTIES = ["normal_non_admin_user", "other_tenant_user", "api_client_admin"] as const;

for (const role of PARTIES) {
  test(`wad-lifecycle · ${role} can view seeded WaD`, async ({ page, ev }) => {
    const id = getRecord("A", "wadId");
    if (!id) test.skip(true, "Phase-2 seeded WaD missing");
    const path = `/wad/${id}`;
    ev.set({
      test_type: "positive_path", role_used: role,
      organisation_used: "Organisation A TEST/UAT", route_or_action_tested: path,
      record_type: "wadId", seeded_record_reference: id, expected_result: "allowed",
    });
    await loginAs(page, role);
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await expectAllowed(page, path);
  });
}

for (const role of NON_PARTIES) {
  test(`wad-lifecycle · ${role} cannot view seeded WaD`, async ({ page, ev }) => {
    const id = getRecord("A", "wadId");
    if (!id) test.skip(true, "Phase-2 seeded WaD missing");
    const path = `/wad/${id}`;
    ev.set({
      test_type: role === "other_tenant_user" ? "wrong_tenant" : "role_negative",
      role_used: role, organisation_used: "Organisation A TEST/UAT",
      route_or_action_tested: path, record_type: "wadId",
      seeded_record_reference: id, expected_result: "denied",
    });
    await loginAs(page, role);
    await page.goto(path, { waitUntil: "domcontentloaded" }).catch(() => null);
    await expectForbidden(page, path);
  });
}
