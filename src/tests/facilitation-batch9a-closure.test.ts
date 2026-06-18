/**
 * Batch 9A — Closure vocabulary alignment + sensitive-outcome guard.
 *
 * Pure unit tests over the SSOT. These pin:
 *  - new master-spec outcomes are present (no_response, invalid_details, closed_by_admin)
 *  - existing accepted outcomes remain (backwards-compat with Batches 1–8)
 *  - the sensitive-outcome set requires an evidenced closing_reason
 *  - browser SSOT matches the Deno SSOT (drift guard runs separately)
 */
import { describe, it, expect } from "vitest";
import {
  OUTCOMES,
  SENSITIVE_OUTCOMES_REQUIRING_REASON,
  CLOSURE_REASON_MIN_LENGTH,
  type FacilitationOutcome,
} from "@/lib/facilitation-case-state";

describe("Batch 9A — closure vocabulary alignment", () => {
  const aliases: FacilitationOutcome[] = ["no_response", "invalid_details", "closed_by_admin"];

  it.each(aliases)("includes master-spec alias %s", (outcome) => {
    expect((OUTCOMES as readonly string[]).includes(outcome)).toBe(true);
  });

  it("preserves all Batches 1–8 outcomes", () => {
    for (const o of [
      "converted_to_known_counterparty_poi",
      "linked_to_existing_organisation",
      "new_counterparty_profile_created",
      "more_information_not_provided",
      "counterparty_declined",
      "unable_to_contact",
      "blocked_by_compliance",
      "duplicate_case",
      "cancelled_by_requester",
      "outside_supported_scope",
      "closed_by_admin_decision",
      "no_authority_confirmed",
    ]) {
      expect((OUTCOMES as readonly string[]).includes(o)).toBe(true);
    }
  });

  it("sensitive-outcome set covers exactly the master-spec list", () => {
    const sensitive = [...SENSITIVE_OUTCOMES_REQUIRING_REASON].sort();
    expect(sensitive).toEqual(
      [
        "blocked_by_compliance",
        "duplicate_case",
        "invalid_details",
        "more_information_not_provided",
        "no_response",
        "unable_to_contact",
      ].sort(),
    );
  });

  it("minimum closing-reason length is 10", () => {
    expect(CLOSURE_REASON_MIN_LENGTH).toBe(10);
  });

  it("sensitive outcomes are all valid OUTCOMES", () => {
    for (const o of SENSITIVE_OUTCOMES_REQUIRING_REASON) {
      expect((OUTCOMES as readonly string[]).includes(o)).toBe(true);
    }
  });

  it("non-sensitive closure outcomes are NOT in the required-reason set", () => {
    for (const o of [
      "converted_to_known_counterparty_poi",
      "cancelled_by_requester",
      "outside_supported_scope",
      "closed_by_admin_decision",
      "closed_by_admin",
      "linked_to_existing_organisation",
    ] as FacilitationOutcome[]) {
      expect(SENSITIVE_OUTCOMES_REQUIRING_REASON.has(o)).toBe(false);
    }
  });
});
