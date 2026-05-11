/**
 * Batch D — D4c-0 catalogue extension test.
 *
 * Pins the late-acceptance-after-expiry catalogue entry. D4c-0 only
 * adds the catalogue surface; outbound dispatch is NOT wired by this
 * step. The tests here therefore guard:
 *
 *   1. the new event exists with the canonical name;
 *   2. its safeWording uses cautious language (expired / recorded /
 *      reconfirmation required) and avoids unsafe finality language
 *      (binding, sealed, completed, executed, final, etc.);
 *   3. it is `adminDispatchEnabled: false` (no D4b/D4c outbound yet);
 *   4. the disputed counterparty, candidate orgs, and external
 *      unregistered counterparties are all in `forbiddenRecipients`;
 *   5. the recommendation is the catalogue's audit-only level (D4c-2
 *      will introduce the initiator dispatch path; that is out of
 *      scope for D4c-0).
 */

import { describe, it, expect } from "vitest";
import {
  BATCH_D_EVENTS,
  findForbiddenWords,
  getBatchDEvent,
} from "@/lib/batch-d-events";

const EVENT = "engagement.late_acceptance_pending_reconfirmation";

const UNSAFE_FINALITY_PHRASES = [
  "accepted as final",
  "binding",
  "sealed",
  "completed",
  "confirmed trade",
  "executed",
  "final",
  "mutual poi",
];

describe("Batch D — D4c-0 late-acceptance catalogue entry", () => {
  const entry = getBatchDEvent(EVENT);

  it("exists in the canonical catalogue", () => {
    expect(entry).toBeDefined();
  });

  it("is not yet wired for outbound dispatch (adminDispatchEnabled=false)", () => {
    expect(entry!.adminDispatchEnabled).toBe(false);
  });

  it("recommendation is audit_only at the D4c-0 stage", () => {
    expect(entry!.recommendation).toBe("audit_only");
  });

  it("forbids disputed_counterparty, candidate_org, and external_unregistered_counterparty", () => {
    expect(entry!.forbiddenRecipients).toContain("disputed_counterparty");
    expect(entry!.forbiddenRecipients).toContain("candidate_org");
    expect(entry!.forbiddenRecipients).toContain(
      "external_unregistered_counterparty",
    );
  });

  it("does not list any of those groups under allowedRecipients", () => {
    for (const banned of [
      "disputed_counterparty",
      "candidate_org",
      "external_unregistered_counterparty",
      "counterparty_org_admin",
      "ordinary_org_member",
    ] as const) {
      expect(entry!.allowedRecipients).not.toContain(banned);
    }
  });

  it("safeWording passes the forbidden-word guard", () => {
    expect(findForbiddenWords(entry!.safeWording)).toEqual([]);
    expect(findForbiddenWords(entry!.label)).toEqual([]);
  });

  it("safeWording uses cautious language and not finality phrases", () => {
    const w = entry!.safeWording.toLowerCase();
    expect(w).toContain("expired");
    expect(w).toContain("recorded");
    expect(w).toContain("reconfirmation");
    for (const phrase of UNSAFE_FINALITY_PHRASES) {
      expect(
        w.includes(phrase),
        `safeWording must not contain finality phrase "${phrase}"`,
      ).toBe(false);
    }
  });

  it("safeWording explicitly states no POI / no WaD / no credit usage", () => {
    const w = entry!.safeWording.toLowerCase();
    expect(w).toMatch(/no proof of intent|no poi/);
    expect(w).toMatch(/no without a doubt|no wad/);
    expect(w).toContain("no credit");
  });

  it("appears exactly once in the catalogue", () => {
    const matches = BATCH_D_EVENTS.filter((e) => e.event === EVENT);
    expect(matches.length).toBe(1);
  });
});
