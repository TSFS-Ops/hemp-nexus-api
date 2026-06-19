/**
 * e2e/journeys/trade-match.spec.ts — POSITIVE-PATH SKELETON.
 *
 * Skips cleanly until seeder Phase 2 lands. Once Phase 2 emits
 * E2E_RN_ORG_A_TRADE_REQUEST_ID + E2E_RN_ORG_A_MATCH_ID, this spec
 * walks:
 *   - Org A requester_trader opens the seeded trade request
 *   - assigned counterparty sees the seeded match
 *   - normal user + other-tenant user + logged-out are denied
 *
 * Mutations (accept/decline) are covered in wrong-actions.spec.ts to
 * keep this journey strictly read-side until Phase 2 confirms it's
 * safe to drive a state transition on seeded data.
 */
import { test } from "../helpers/evidence-rn";
import { loginAs } from "../helpers/auth-roles";
import { getRecord } from "../fixtures/records";
import { expectAllowed, expectForbidden } from "../helpers/assertions";

test("trade-match · Org A requester_trader can open seeded trade request", async ({ page, ev }) => {
  const id = getRecord("A", "tradeRequestId");
  if (!id) test.skip(true, "Phase-2 seeded trade_request missing");
  const path = `/trades/${id}`;
  ev.set({
    test_type: "positive_path", role_used: "requester_trader",
    organisation_used: "Organisation A TEST/UAT", route_or_action_tested: path,
    record_type: "tradeRequestId", seeded_record_reference: id, expected_result: "allowed",
  });
  await loginAs(page, "requester_trader");
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await expectAllowed(page, path);
});

test("trade-match · Org A counterparty_user can open assigned match", async ({ page, ev }) => {
  const id = getRecord("A", "matchId");
  if (!id) test.skip(true, "Phase-2 seeded match missing");
  const path = `/matches/${id}`;
  ev.set({
    test_type: "positive_path", role_used: "counterparty_user",
    organisation_used: "Organisation A TEST/UAT", route_or_action_tested: path,
    record_type: "matchId", seeded_record_reference: id, expected_result: "allowed",
  });
  await loginAs(page, "counterparty_user");
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await expectAllowed(page, path);
});

for (const role of ["normal_non_admin_user", "other_tenant_user"] as const) {
  test(`trade-match · ${role} cannot open Org A match`, async ({ page, ev }) => {
    const id = getRecord("A", "matchId");
    if (!id) test.skip(true, "Phase-2 seeded match missing");
    const path = `/matches/${id}`;
    ev.set({
      test_type: role === "other_tenant_user" ? "wrong_tenant" : "role_negative",
      role_used: role, organisation_used: "Organisation A TEST/UAT",
      route_or_action_tested: path, record_type: "matchId",
      seeded_record_reference: id, expected_result: "denied",
    });
    await loginAs(page, role);
    await page.goto(path, { waitUntil: "domcontentloaded" }).catch(() => null);
    await expectForbidden(page, path);
  });
}
