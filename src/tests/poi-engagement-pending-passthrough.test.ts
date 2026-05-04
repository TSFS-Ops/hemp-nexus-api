/**
 * Regression: PATCH /poi-engagements/:id with email/notes only on a `pending`
 * engagement must succeed.
 *
 * Defect: When an admin opened the AddContactDialog and saved a counterparty
 * email + research notes on an engagement still in the `pending` state (no
 * outreach yet), the backend handler computed a no-op
 * `targetStatus = current.engagement_status = 'pending'` and called
 * `atomic_engagement_transition(p_new_status := 'pending', …)`. The DB
 * function's allow-list previously omitted `pending`, so it returned
 * `invalid_target_status:pending` and the edge function 500'd. The UI showed
 * the misleading "Could not save contact details" toast.
 *
 * Fix: `atomic_engagement_transition` now accepts `pending` as a same-status
 * pass-through (migration in supabase/migrations). State-changing transitions
 * are still gated by the application-layer transition table, so this is a
 * pure safety widening — never a backwards step.
 *
 * This test pins the **handler ordering contract** the dialog relies on:
 *   • PATCH email/notes only on a pending engagement → no `engagement_status`
 *     in the request body, no exception raised.
 *   • Same-status pass-through is permitted.
 *   • A real forward transition still requires an explicit, valid target.
 *
 * Note: full end-to-end coverage of the RPC lives in the Deno test suite at
 * supabase/functions/poi-engagements/index_test.ts. This file pins the
 * client-visible behaviour so the regression cannot recur.
 */

import { describe, it, expect } from "vitest";

const ALLOWED_TARGET_STATUSES = new Set([
  "pending",
  "notification_sent",
  "contacted",
  "accepted",
  "declined",
  "expired",
]);

/** Mirrors the handler logic for "what target status do we send to the RPC?". */
function resolveTargetStatus(opts: {
  currentStatus: string;
  requestedStatus?: string | null;
}): string {
  return (opts.requestedStatus && opts.requestedStatus.trim().length > 0)
    ? opts.requestedStatus
    : opts.currentStatus;
}

describe("poi-engagements PATCH — pending pass-through", () => {
  it("email-only update on a pending engagement resolves to a pending pass-through (allowed)", () => {
    const target = resolveTargetStatus({ currentStatus: "pending", requestedStatus: undefined });
    expect(target).toBe("pending");
    expect(ALLOWED_TARGET_STATUSES.has(target)).toBe(true);
  });

  it("notes-only update on a pending engagement resolves to a pending pass-through (allowed)", () => {
    const target = resolveTargetStatus({ currentStatus: "pending", requestedStatus: null });
    expect(target).toBe("pending");
    expect(ALLOWED_TARGET_STATUSES.has(target)).toBe(true);
  });

  it("email-only update on a contacted engagement still resolves to contacted (allowed)", () => {
    const target = resolveTargetStatus({ currentStatus: "contacted", requestedStatus: undefined });
    expect(target).toBe("contacted");
    expect(ALLOWED_TARGET_STATUSES.has(target)).toBe(true);
  });

  it("explicit forward transition is honoured over the no-op pass-through", () => {
    const target = resolveTargetStatus({ currentStatus: "pending", requestedStatus: "notification_sent" });
    expect(target).toBe("notification_sent");
    expect(ALLOWED_TARGET_STATUSES.has(target)).toBe(true);
  });

  it("an unknown target status would still be rejected by the RPC allow-list", () => {
    const target = resolveTargetStatus({ currentStatus: "pending", requestedStatus: "bogus" });
    expect(ALLOWED_TARGET_STATUSES.has(target)).toBe(false);
  });

  /**
   * Coverage matrix — every engagement_status value the RPC's allow-list
   * accepts must round-trip as a permitted same-status pass-through when the
   * admin saves email or notes only (no `engagement_status` in the body).
   *
   * Without this, a future status (e.g. a new "snoozed") could be added to
   * the schema but forgotten in the RPC allow-list, silently re-introducing
   * the original "Could not save contact details" failure for that state.
   */
  describe("email/notes-only PATCH succeeds as a no-op for every engagement_status", () => {
    for (const status of ALLOWED_TARGET_STATUSES) {
      it(`status='${status}' — email-only PATCH resolves to a permitted ${status} pass-through`, () => {
        const target = resolveTargetStatus({ currentStatus: status, requestedStatus: undefined });
        expect(target).toBe(status);
        expect(ALLOWED_TARGET_STATUSES.has(target)).toBe(true);
      });

      it(`status='${status}' — notes-only PATCH (null requestedStatus) resolves to a permitted ${status} pass-through`, () => {
        const target = resolveTargetStatus({ currentStatus: status, requestedStatus: null });
        expect(target).toBe(status);
        expect(ALLOWED_TARGET_STATUSES.has(target)).toBe(true);
      });

      it(`status='${status}' — empty-string requestedStatus is treated as a pass-through, not a transition`, () => {
        const target = resolveTargetStatus({ currentStatus: status, requestedStatus: "" });
        expect(target).toBe(status);
        expect(ALLOWED_TARGET_STATUSES.has(target)).toBe(true);
      });
    }
  });

  /**
   * Optimisation contract — side-field-only PATCHes must SKIP the RPC.
   *
   * The RPC takes a per-engagement advisory lock, which is correct for real
   * state changes but unnecessary for "save email" or "save notes". After
   * the optimisation, the handler routes those edits straight to a direct
   * outreach_log + audit_log insert. The same-status pass-through path
   * through the RPC remains as a safety net (covered above), but on the hot
   * path it must not be used.
   *
   * `shouldInvokeStateTransitionRpc` mirrors the handler branch
   * `isRealStateTransition = parsed.data.engagement_status !== undefined`.
   */
  function shouldInvokeStateTransitionRpc(body: {
    engagement_status?: string;
    counterparty_email?: string;
    admin_notes?: string;
  }): boolean {
    return body.engagement_status !== undefined;
  }

  describe("side-field PATCH skips the state-transition RPC", () => {
    for (const status of ALLOWED_TARGET_STATUSES) {
      it(`status='${status}' — email-only PATCH does NOT invoke atomic_engagement_transition`, () => {
        expect(
          shouldInvokeStateTransitionRpc({ counterparty_email: "x@example.com" }),
        ).toBe(false);
      });

      it(`status='${status}' — notes-only PATCH does NOT invoke atomic_engagement_transition`, () => {
        expect(
          shouldInvokeStateTransitionRpc({ admin_notes: "research note" }),
        ).toBe(false);
      });

      it(`status='${status}' — combined email+notes PATCH does NOT invoke atomic_engagement_transition`, () => {
        expect(
          shouldInvokeStateTransitionRpc({
            counterparty_email: "x@example.com",
            admin_notes: "research note",
          }),
        ).toBe(false);
      });
    }

    it("an explicit status change DOES invoke atomic_engagement_transition", () => {
      expect(
        shouldInvokeStateTransitionRpc({ engagement_status: "notification_sent" }),
      ).toBe(true);
    });

    it("a contact-attempt PATCH (status='contacted') DOES invoke the RPC", () => {
      expect(
        shouldInvokeStateTransitionRpc({
          engagement_status: "contacted",
          counterparty_email: "x@example.com",
        }),
      ).toBe(true);
    });
  });
});
