/**
 * Batch D — D4b defensive disputed-counterparty suppression mirror.
 *
 * D4b's helper never derives a recipient from engagement / contact /
 * org data — recipients are hard-coded inside `notification-dispatch`.
 * This test pins the policy at the catalogue surface:
 *
 *   1. `disputed_counterparty` is in `forbiddenRecipients` of EVERY
 *      flipped (admin-dispatch enabled) event.
 *   2. `external_unregistered_counterparty` is in `forbiddenRecipients`
 *      of EVERY flipped event.
 *   3. The pure helper `isDisputedCounterpartySuppressed` correctly
 *      flags engagements in `disputed_being_named` so any future
 *      caller gating on it fails closed.
 *   4. Even when the event IS `engagement.disputed_being_named`,
 *      the platform-admin alert is still allowed (that is the *point*
 *      of the alert) — verified at the catalogue level.
 */

import { describe, it, expect } from "vitest";
import {
  BATCH_D_EVENTS,
  isDisputedCounterpartySuppressed,
} from "@/lib/batch-d-events";

describe("Batch D — D4b disputed-counterparty suppression (defensive)", () => {
  it("forbids disputed_counterparty on every adminDispatchEnabled event", () => {
    for (const e of BATCH_D_EVENTS) {
      if (!e.adminDispatchEnabled) continue;
      expect(e.forbiddenRecipients).toContain("disputed_counterparty");
      expect(e.forbiddenRecipients).toContain(
        "external_unregistered_counterparty",
      );
    }
  });

  it("isDisputedCounterpartySuppressed flags both status surfaces", () => {
    expect(
      isDisputedCounterpartySuppressed({
        engagement_status: "disputed_being_named",
        operational_state: null,
      }),
    ).toBe(true);
    expect(
      isDisputedCounterpartySuppressed({
        engagement_status: null,
        operational_state: "disputed_being_named",
      }),
    ).toBe(true);
    expect(
      isDisputedCounterpartySuppressed({
        engagement_status: "open",
        operational_state: null,
      }),
    ).toBe(false);
    expect(isDisputedCounterpartySuppressed(null)).toBe(false);
  });

  it("platform_admin remains the sole allowed recipient on the dispute event", () => {
    const dispute = BATCH_D_EVENTS.find(
      (e) => e.event === "engagement.disputed_being_named",
    );
    expect(dispute).toBeDefined();
    expect(dispute!.adminDispatchEnabled).toBe(true);
    expect([...dispute!.allowedRecipients]).toEqual(["platform_admin"]);
  });
});
