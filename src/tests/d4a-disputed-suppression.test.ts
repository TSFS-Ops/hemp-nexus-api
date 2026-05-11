/**
 * Batch D — D4a disputed-counterparty suppression test.
 *
 * Proves the pure helper `isDisputedCounterpartySuppressed` correctly
 * blocks outreach for any engagement in `disputed_being_named` (either
 * the canonical `engagement_status` or the `operational_state` shadow
 * column written by the dispute action). This mirror is what future
 * D4b/D4c dispatchers MUST call before composing a recipient list.
 *
 * The server-side enforcement already exists in
 *   supabase/functions/poi-engagements/index.ts :: evaluateOutreachGate
 * and is exercised by the d2a-live-proof harness; this test guarantees
 * the client/dispatch mirror cannot drift from the server contract.
 */

import { describe, it, expect } from "vitest";
import {
  isDisputedCounterpartySuppressed,
  DISPUTED_COUNTERPARTY_SUPPRESSED_CODE,
  BATCH_D_EVENTS,
} from "@/lib/batch-d-events";

describe("Batch D — D4a disputed-counterparty suppression", () => {
  it("suppresses when engagement_status = disputed_being_named", () => {
    expect(
      isDisputedCounterpartySuppressed({
        engagement_status: "disputed_being_named",
        operational_state: null,
      }),
    ).toBe(true);
  });

  it("suppresses when operational_state = disputed_being_named", () => {
    expect(
      isDisputedCounterpartySuppressed({
        engagement_status: "pending_acceptance",
        operational_state: "disputed_being_named",
      }),
    ).toBe(true);
  });

  it("does NOT suppress for unrelated states", () => {
    expect(
      isDisputedCounterpartySuppressed({
        engagement_status: "pending_acceptance",
        operational_state: null,
      }),
    ).toBe(false);
    expect(
      isDisputedCounterpartySuppressed({
        engagement_status: "accepted",
        operational_state: "binding_review_required",
      }),
    ).toBe(false);
    expect(
      isDisputedCounterpartySuppressed({
        engagement_status: "cancelled_for_email_change",
        operational_state: "cancelled_for_email_change",
      }),
    ).toBe(false);
  });

  it("treats null / undefined / empty input as not-suppressed (safe default for non-engagement contexts)", () => {
    expect(isDisputedCounterpartySuppressed(null)).toBe(false);
    expect(isDisputedCounterpartySuppressed(undefined)).toBe(false);
    expect(isDisputedCounterpartySuppressed({})).toBe(false);
  });

  it("exposes a stable suppression code constant", () => {
    expect(DISPUTED_COUNTERPARTY_SUPPRESSED_CODE).toBe(
      "DISPUTED_COUNTERPARTY_SUPPRESSED",
    );
  });

  it("aligns with catalogue: every Batch D event forbids the disputed counterparty", () => {
    // Defence-in-depth: if a future PR adds an event but forgets to list
    // disputed_counterparty as forbidden, the suppression contract would
    // be silently weakened. This test pins the invariant.
    for (const e of BATCH_D_EVENTS) {
      expect(
        e.forbiddenRecipients.includes("disputed_counterparty"),
        `${e.event} must forbid disputed_counterparty`,
      ).toBe(true);
    }
  });
});
