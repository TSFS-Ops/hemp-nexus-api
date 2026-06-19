/**
 * e2e/role-negative/wrong-actions.spec.ts
 *
 * For each (action, disallowed role):
 *   1. Capture before-state via service-role read
 *   2. Invoke the RPC/edge function DIRECTLY as the disallowed role
 *   3. Assert HTTP status ∈ {401,403,404} with no payload leakage
 *   4. Capture after-state
 *   5. Assert no mutation (compareNoMutation)
 *
 * Notification / provider side-effect checks are documented in the
 * evidence row — automated `notification_dispatches` row-count diff is
 * Phase 2 because it requires per-action filters the seeder doesn't
 * emit yet.
 */
import { test, expect } from "../helpers/evidence-rn";
import { ACTION_MATRIX } from "../fixtures/permissions";
import { ROLES, type Role } from "../fixtures/users";
import { callRpcAs, callEdgeAs } from "../helpers/direct-actions";
import { captureBeforeState, captureAfterState, compareNoMutation } from "../helpers/state";
import { getRecord } from "../fixtures/records";
import { expectSafeDeniedResponse } from "../helpers/assertions";

async function invoke(target: string, role: Role, args: Record<string, unknown>) {
  if (target.startsWith("rpc:")) return callRpcAs(role, target.slice(4), args);
  if (target.startsWith("fn:"))  return callEdgeAs(role, target.slice(3), args);
  throw new Error(`unknown target ${target}`);
}

for (const action of ACTION_MATRIX) {
  const disallowed = ROLES.filter((r) => !action.allowedRoles.includes(r));
  for (const role of disallowed) {
    test(`wrong-action · ${role} cannot ${action.id}`, async ({ ev }) => {
      const id = action.recordKey ? getRecord("A", action.recordKey) : undefined;
      if (action.recordKey && !id) test.skip(true, "Phase-2 seeded record missing");

      ev.set({
        test_type: "direct_backend",
        role_used: role,
        organisation_used: action.recordKey ? "Organisation A TEST/UAT" : "global",
        route_or_action_tested: `${action.target} (${action.id})`,
        record_type: action.recordKey,
        seeded_record_reference: id,
        expected_result: "denied_no_mutation",
        notes: `side-effect checks: ${action.sideEffectChecks.join(",")}`,
      });

      const before = action.recordKey && id ? await captureBeforeState(action.recordKey, id) : null;
      ev.set({ before_state: before });

      const args: Record<string, unknown> = id ? { id } : {};
      const res = await invoke(action.target, role, args);
      // Build a fake Response-like for expectSafeDeniedResponse
      const fakeRes = new Response(res.body, { status: res.status });
      await expectSafeDeniedResponse(fakeRes);

      const after = action.recordKey && id ? await captureAfterState(action.recordKey, id) : null;
      ev.set({ after_state: after });
      const cmp = compareNoMutation(before, after);
      expect(cmp.equal, `record mutated despite denied action: ${cmp.diff}`).toBe(true);
    });
  }
}
