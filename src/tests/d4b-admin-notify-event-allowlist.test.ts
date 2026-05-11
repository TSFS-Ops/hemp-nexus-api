/**
 * Batch D — D4b admin notify event allowlist invariants.
 *
 * Proves at the catalogue level (TS surface) that:
 *   1. Exactly two events have `adminDispatchEnabled: true`:
 *      `engagement.binding_review_required` and
 *      `engagement.disputed_being_named`.
 *   2. The flipped events use `recommendation: 'admin_queue'` and
 *      `allowedRecipients: ['platform_admin']` only.
 *   3. Every other event keeps `adminDispatchEnabled: false`.
 *   4. `adminDispatchEnabled` is the ONLY dispatch flag on the catalogue
 *      type — no `emailEnabled`, no `orgEmailEnabled`, etc. (guards
 *      against accidental "general email permission" drift).
 */

import { describe, it, expect } from "vitest";
import { BATCH_D_EVENTS } from "@/lib/batch-d-events";

const EXPECTED_DISPATCH = new Set([
  "engagement.binding_review_required",
  "engagement.disputed_being_named",
]);

describe("Batch D — D4b dispatch allowlist", () => {
  it("flips exactly the two D4b events and no others", () => {
    const flipped = BATCH_D_EVENTS.filter((e) => e.adminDispatchEnabled).map(
      (e) => e.event,
    );
    expect(new Set(flipped)).toEqual(EXPECTED_DISPATCH);
  });

  it("flipped events are admin_queue, include platform_admin, and forbid counterparty/external groups", () => {
    // After the D4c-2 correction pass, D4b admin-dispatch events MAY
    // also list `initiating_org_admin` in allowedRecipients (so the D4c
    // initiator helper can dispatch). They MUST still:
    //   • use recommendation 'admin_queue'
    //   • include 'platform_admin' in allowedRecipients
    //   • never list counterparty / external / disputed groups
    const FORBIDDEN = [
      "counterparty_org_admin",
      "ordinary_org_member",
      "external_unregistered_counterparty",
      "disputed_counterparty",
      "candidate_org",
    ];
    for (const e of BATCH_D_EVENTS) {
      if (!e.adminDispatchEnabled) continue;
      expect(e.recommendation).toBe("admin_queue");
      expect([...e.allowedRecipients]).toContain("platform_admin");
      for (const banned of FORBIDDEN) {
        expect(
          [...e.allowedRecipients].includes(banned as never),
          `${e.event}: allowedRecipients must not include ${banned}`,
        ).toBe(false);
      }
    }
  });

  it("every non-flipped event remains adminDispatchEnabled:false", () => {
    for (const e of BATCH_D_EVENTS) {
      if (EXPECTED_DISPATCH.has(e.event)) continue;
      expect(e.adminDispatchEnabled, e.event).toBe(false);
    }
  });

  it("catalogue entry has no general email/org dispatch flags", () => {
    const sample = BATCH_D_EVENTS[0] as unknown as Record<string, unknown>;
    // adminDispatchEnabled is the only allowed dispatch flag. The
    // following keys MUST NOT appear (defence against drift back to a
    // generic outbound-email permission model).
    for (const banned of [
      "emailEnabled",
      "orgEmailEnabled",
      "counterpartyEmailEnabled",
      "externalEmailEnabled",
    ]) {
      expect(banned in sample).toBe(false);
    }
  });
});
