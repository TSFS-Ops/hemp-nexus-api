/**
 * Contract test: Role-Negative & E2E matrix invariants.
 *
 * Runs in vitest (fast, runs on every push) and proves the matrix
 * stays well-formed:
 *   - all 8 approved role labels present and exact
 *   - every route has at least one allowed role (no orphan routes)
 *   - tenant-scoped routes that use :id declare a recordKey
 *   - every action lists a target in the rpc:|fn: form
 *   - wrong-actions side-effect checks reference known labels
 *
 * Pairs with scripts/check-role-negative-e2e-coverage.mjs (which guards
 * the spec ↔ matrix mapping). Together they form the release gate.
 */
import { describe, it, expect } from "vitest";
import { ROUTE_MATRIX, ROUTE_PATHS } from "../../e2e/fixtures/routes";
import { ACTION_MATRIX } from "../../e2e/fixtures/permissions";
import { ROLES } from "../../e2e/fixtures/users";

const APPROVED = [
  "platform_admin",
  "compliance_analyst",
  "requester_trader",
  "counterparty_user",
  "api_client_admin",
  "normal_non_admin_user",
  "other_tenant_user",
  "logged_out_user",
];

describe("role-negative-e2e matrix invariants", () => {
  it("role labels match the approved 8 exactly", () => {
    expect([...ROLES].sort()).toEqual([...APPROVED].sort());
  });

  it("every route has at least one allowed role (no orphans)", () => {
    for (const r of ROUTE_MATRIX) {
      // empty allowedRoles is only allowed if we genuinely want a route nobody can hit;
      // none should exist today. Document explicitly if added.
      expect(r.allowedRoles.length, `route ${r.path} has no allowed roles`).toBeGreaterThan(0);
    }
  });

  it("every :id route declares a recordKey", () => {
    for (const r of ROUTE_MATRIX) {
      if (r.path.includes(":id")) {
        expect(r.recordKey, `route ${r.path} uses :id but has no recordKey`).toBeTruthy();
      }
    }
  });

  it("no duplicate paths in the route matrix", () => {
    const seen = new Set<string>();
    for (const p of ROUTE_PATHS) {
      expect(seen.has(p), `duplicate route ${p}`).toBe(false);
      seen.add(p);
    }
  });

  it("every action target is rpc: or fn: prefixed", () => {
    for (const a of ACTION_MATRIX) {
      expect(a.target.startsWith("rpc:") || a.target.startsWith("fn:"),
        `action ${a.id} target must be rpc:|fn:, got ${a.target}`).toBe(true);
    }
  });

  it("every action allowed role is in the approved list", () => {
    for (const a of ACTION_MATRIX) {
      for (const role of a.allowedRoles) {
        expect(APPROVED).toContain(role);
      }
    }
  });

  it("every action declares at least one side-effect check (unless intentionally empty)", () => {
    const ALLOWED_EMPTY = new Set(["view_internal_notes"]);
    for (const a of ACTION_MATRIX) {
      if (ALLOWED_EMPTY.has(a.id)) continue;
      expect(a.sideEffectChecks.length, `action ${a.id} declares no side-effect checks`).toBeGreaterThan(0);
    }
  });
});
