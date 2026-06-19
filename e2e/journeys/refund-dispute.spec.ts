/**
 * e2e/journeys/refund-dispute.spec.ts — POSITIVE-PATH SKELETON.
 *
 * Read-side: platform_admin can list /hq/refunds; requester opens own
 * seeded refund detail. Approve/decline mutations are covered as
 * direct-backend denials for disallowed roles in wrong-actions.spec.ts.
 *
 * SAFETY: No live Payfast/Paystack/bank/card call may run. The seeded
 * refund record is fully synthetic (no provider txn_id).
 */
import { test } from "../helpers/evidence-rn";
import { loginAs } from "../helpers/auth-roles";
import { getRecord } from "../fixtures/records";
import { expectAllowed, expectForbidden } from "../helpers/assertions";

test("refund-dispute · platform_admin can open /hq/refunds", async ({ page, ev }) => {
  ev.set({
    test_type: "positive_path", role_used: "platform_admin",
    organisation_used: "global", route_or_action_tested: "/hq/refunds",
    expected_result: "allowed",
  });
  await loginAs(page, "platform_admin");
  await page.goto("/hq/refunds", { waitUntil: "domcontentloaded" });
  await expectAllowed(page, "/hq/refunds");
});

test("refund-dispute · Org A requester_trader can open own refund detail", async ({ page, ev }) => {
  const id = getRecord("A", "refundRequestId");
  if (!id) test.skip(true, "Phase-2 seeded refund missing");
  const path = `/refunds/${id}`;
  ev.set({
    test_type: "positive_path", role_used: "requester_trader",
    organisation_used: "Organisation A TEST/UAT", route_or_action_tested: path,
    record_type: "refundRequestId", seeded_record_reference: id, expected_result: "allowed",
  });
  await loginAs(page, "requester_trader");
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await expectAllowed(page, path);
});

for (const role of ["normal_non_admin_user", "other_tenant_user", "counterparty_user"] as const) {
  test(`refund-dispute · ${role} cannot open Org A refund detail`, async ({ page, ev }) => {
    const id = getRecord("A", "refundRequestId");
    if (!id) test.skip(true, "Phase-2 seeded refund missing");
    const path = `/refunds/${id}`;
    ev.set({
      test_type: role === "other_tenant_user" ? "wrong_tenant" : "role_negative",
      role_used: role, organisation_used: "Organisation A TEST/UAT",
      route_or_action_tested: path, record_type: "refundRequestId",
      seeded_record_reference: id, expected_result: "denied",
    });
    await loginAs(page, role);
    await page.goto(path, { waitUntil: "domcontentloaded" }).catch(() => null);
    await expectForbidden(page, path);
  });
}
