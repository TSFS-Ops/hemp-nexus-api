/**
 * Tests for the lightweight client-analytics shim.
 *
 * These cover the public contract:
 *   - localStorage counters bucket per (event, outcome) and accumulate
 *   - a CustomEvent is dispatched on every track call so live subscribers
 *     (debug panels, future telemetry shippers) don't need to poll
 *   - reset wipes the snapshot
 *   - calling on the server (or with broken storage) is a no-op, never throws
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  CLIENT_ANALYTICS_DOM_EVENT,
  CLIENT_ANALYTICS_EVENT_NAMES,
  getClientAnalyticsCounters,
  resetClientAnalyticsCounters,
  trackClientEvent,
} from "./client-analytics";

describe("client-analytics", () => {
  beforeEach(() => {
    localStorage.clear();
    resetClientAnalyticsCounters();
  });

  it("buckets counters by event name + outcome and accumulates totals", () => {
    trackClientEvent({
      name: CLIENT_ANALYTICS_EVENT_NAMES.COPY_REF,
      payload: { surface: "alert", outcome: "success", hasRef: true },
    });
    trackClientEvent({
      name: CLIENT_ANALYTICS_EVENT_NAMES.COPY_REF,
      payload: { surface: "toast", outcome: "success", hasRef: true },
    });
    trackClientEvent({
      name: CLIENT_ANALYTICS_EVENT_NAMES.COPY_REF,
      payload: { surface: "alert", outcome: "denied", hasRef: true, reason: "NotAllowedError" },
    });

    const snap = getClientAnalyticsCounters();
    expect(snap["wad.attest_error.copy_ref:success"].total).toBe(2);
    expect(snap["wad.attest_error.copy_ref:denied"].total).toBe(1);
    // Last payload is preserved for triage.
    expect(snap["wad.attest_error.copy_ref:denied"].lastPayload.reason).toBe(
      "NotAllowedError",
    );
  });

  it("dispatches a CustomEvent for live subscribers", () => {
    const listener = vi.fn();
    window.addEventListener(CLIENT_ANALYTICS_DOM_EVENT, listener);

    trackClientEvent({
      name: CLIENT_ANALYTICS_EVENT_NAMES.COPY_REF,
      payload: { surface: "alert", outcome: "success", hasRef: true },
    });

    expect(listener).toHaveBeenCalledTimes(1);
    const detail = (listener.mock.calls[0][0] as CustomEvent).detail;
    expect(detail.name).toBe("wad.attest_error.copy_ref");
    expect(detail.payload.outcome).toBe("success");
    expect(typeof detail.at).toBe("string");

    window.removeEventListener(CLIENT_ANALYTICS_DOM_EVENT, listener);
  });

  it("resetClientAnalyticsCounters wipes the snapshot", () => {
    trackClientEvent({
      name: CLIENT_ANALYTICS_EVENT_NAMES.COPY_REF,
      payload: { surface: "alert", outcome: "success", hasRef: true },
    });
    expect(Object.keys(getClientAnalyticsCounters())).toHaveLength(1);
    resetClientAnalyticsCounters();
    expect(getClientAnalyticsCounters()).toEqual({});
  });

  it("does not throw when localStorage.setItem rejects", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceeded");
    });

    expect(() =>
      trackClientEvent({
        name: CLIENT_ANALYTICS_EVENT_NAMES.COPY_REF,
        payload: { surface: "alert", outcome: "success", hasRef: true },
      }),
    ).not.toThrow();

    spy.mockRestore();
  });
});
