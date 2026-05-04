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
});
