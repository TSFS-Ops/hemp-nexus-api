/**
 * e2e/role-negative/route-access.spec.ts
 *
 * Iterates ROUTE_MATRIX × ROLES. For each pair asserts:
 *   - allowed role  → allowed render (no 'not authorised')
 *   - logged_out    → /auth redirect with returnTo
 *   - any other role → safe denied state
 *
 * Tenant-scoped routes that need a seeded record :id `test.skip` until
 * Phase 2 of the seeder is run. Coverage guard counts skipped Phase-2
 * rows against the deferral register, not the matrix.
 */
import { test, expect } from "../helpers/evidence-rn";
import { ROUTE_MATRIX, type RouteEntry } from "../fixtures/routes";
import { ROLES, type Role } from "../fixtures/users";
import { loginAs } from "../helpers/auth-roles";
import { getRecord } from "../fixtures/records";
import { expectAllowed, expectForbidden, expectRedirectToLogin } from "../helpers/assertions";

function resolvePath(route: RouteEntry): { path: string; recordId?: string; skip: boolean } {
  if (!route.path.includes(":id")) return { path: route.path, skip: false };
  if (!route.recordKey) return { path: route.path, skip: true };
  const id = getRecord("A", route.recordKey);
  if (!id) return { path: route.path, skip: true };
  return { path: route.path.replace(":id", id), recordId: id, skip: false };
}

for (const route of ROUTE_MATRIX) {
  test.describe(`route-access · ${route.path}`, () => {
    for (const role of ROLES) {
      const expected = role === "logged_out_user"
        ? "redirect_login"
        : route.allowedRoles.includes(role) ? "allowed" : "denied";

      test(`${role} (Org A) accessing ${route.path} → ${expected}`, async ({ page, ev }) => {
        const { path, recordId, skip } = resolvePath(route);
        if (skip) {
          ev.set({ pass_fail_status: "skipped", notes: "Phase-2 seeded record missing" });
          test.skip(true, `Skipping — seeded record for ${route.recordKey} not available (Phase-2 deferral)`);
        }
        ev.set({
          test_type: role === "logged_out_user" ? "logged_out" : expected === "denied" ? "role_negative" : "positive_path",
          role_used: role,
          organisation_used: route.tenantScoped ? "Organisation A TEST/UAT" : "global",
          route_or_action_tested: path,
          record_type: route.recordKey,
          seeded_record_reference: recordId,
          expected_result: expected,
        });

        await loginAs(page, role);
        const resp = await page.goto(path, { waitUntil: "domcontentloaded" }).catch(() => null);

        if (expected === "redirect_login") {
          await expectRedirectToLogin(page, path);
        } else if (expected === "allowed") {
          await expectAllowed(page, path);
        } else {
          await expectForbidden(page, path);
        }
        expect(resp?.status() ?? 0).toBeLessThan(500);
      });
    }
  });
}
