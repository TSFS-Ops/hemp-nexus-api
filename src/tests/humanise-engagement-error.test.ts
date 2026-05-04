/**
 * humaniseEngagementError — regression test
 *
 * Pins the mapping from opaque server codes returned by `poi-engagements`
 * (and the underlying `atomic_engagement_transition` RPC) to the plain-English
 * copy shown inside AddContactDialog. If a future server change starts
 * emitting a different code, the dialog must continue to fall back gracefully
 * rather than show a bare technical string.
 */

import { describe, it, expect } from "vitest";
import { humaniseEngagementError } from "@/lib/humanise-engagement-error";

describe("humaniseEngagementError", () => {
  it("translates invalid_target_status:<status> into an admin-friendly headline", () => {
    const r = humaniseEngagementError("invalid_target_status:pending");
    expect(r.headline).toMatch(/unexpected state/i);
    expect(r.hint).toMatch(/refresh/i);
    expect(r.technical).toContain("invalid_target_status:pending");
  });

  it("handles INVALID_TRANSITION from the application layer", () => {
    const r = humaniseEngagementError({ message: "INVALID_TRANSITION: pending → contacted not allowed" });
    expect(r.headline).toMatch(/status change isn't allowed/i);
    expect(r.technical).toMatch(/INVALID_TRANSITION/);
  });

  it("handles VALIDATION_ERROR / Zod-style messages", () => {
    const r = humaniseEngagementError("VALIDATION_ERROR: counterparty_email is too short");
    expect(r.headline).toMatch(/validation/i);
    expect(r.hint).toMatch(/254 characters/);
  });

  it("handles NOT_FOUND / engagement_not_found", () => {
    const r = humaniseEngagementError("engagement_not_found");
    expect(r.headline).toMatch(/could not be found/i);
  });

  it("handles permission / RLS rejections", () => {
    const r = humaniseEngagementError("forbidden: RLS denied");
    expect(r.headline).toMatch(/don't have permission/i);
  });

  it("handles maintenance window rejections", () => {
    const r = humaniseEngagementError("Service temporarily unavailable for maintenance");
    expect(r.headline).toMatch(/temporarily paused/i);
  });

  it("handles bare 'non-2xx' transport errors without leaking jargon", () => {
    const r = humaniseEngagementError(new Error("Edge function returned a non-2xx status code"));
    expect(r.headline).toMatch(/did not respond cleanly/i);
    expect(r.headline).not.toMatch(/non-2xx/i);
  });

  it("falls back to the server's own message when no pattern matches", () => {
    const r = humaniseEngagementError({ message: "Something quite specific happened" });
    expect(r.hint).toBe("Something quite specific happened");
    expect(r.technical).toBe("Something quite specific happened");
  });

  it("never throws on null / undefined / weird shapes", () => {
    expect(() => humaniseEngagementError(null)).not.toThrow();
    expect(() => humaniseEngagementError(undefined)).not.toThrow();
    expect(() => humaniseEngagementError(42)).not.toThrow();
    expect(humaniseEngagementError(null).headline).toMatch(/could not save/i);
  });
});
