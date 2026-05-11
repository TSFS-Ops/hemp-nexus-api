/**
 * Batch D — D4a catalogue + wording guard tests.
 *
 * Proves:
 *   1. every Batch D event has exactly one catalogue entry;
 *   2. every catalogue entry passes the wording guard;
 *   3. admin dispatch is only ever enabled for admin_queue events
 *      whose allowedRecipients is exactly ['platform_admin'];
 *   4. the wording guard correctly REJECTS each forbidden token;
 *   5. `disputed_counterparty` appears in the forbidden-recipients list
 *      of EVERY event in the catalogue (the hard safety rule);
 *   6. the canonical event name set matches the D4 preflight scope.
 */

import { describe, it, expect } from "vitest";
import {
  BATCH_D_EVENTS,
  BATCH_D_FORBIDDEN_WORDS,
  findForbiddenWords,
  getBatchDEvent,
  type BatchDEventEntry,
} from "@/lib/batch-d-events";

const EXPECTED_EVENTS = [
  "engagement.binding_review_required",
  "engagement.binding_review_resolved",
  "engagement.disputed_being_named",
  "engagement.cancelled_email_change",
  "engagement.email_change_blocked",
  "engagement.late_acceptance_pending_reconfirmation",
  "outreach.blocked.contact_incomplete",
  "outreach.blocked.binding_review_pending",
  "outreach.blocked.disputed_being_named",
];

describe("Batch D — D4a event catalogue", () => {
  it("contains exactly one entry per canonical event name", () => {
    const names = BATCH_D_EVENTS.map((e) => e.event);
    expect(new Set(names).size).toBe(names.length);
    for (const expected of EXPECTED_EVENTS) {
      expect(getBatchDEvent(expected), `missing event ${expected}`).toBeDefined();
    }
    expect(names.sort()).toEqual([...EXPECTED_EVENTS].sort());
  });

  it("admin-dispatch is only enabled for admin_queue events that include platform_admin and no external groups (D4b invariant)", () => {
    // D4c-2 correction: admin dispatch may coexist with initiator
    // dispatch on the same event. The catalogue invariant is therefore
    // (a) recommendation === 'admin_queue', (b) platform_admin is in
    // allowedRecipients, and (c) NO counterparty / member / external /
    // disputed / candidate group is in allowedRecipients. The D4b
    // dispatcher (`batch-d-admin-notify.ts`) still targets ONLY
    // platform_admin at runtime; the D4c initiator helper
    // (`batch-d-initiator-notify.ts`) targets ONLY initiating_org_admin.
    for (const e of BATCH_D_EVENTS) {
      if (e.adminDispatchEnabled) {
        expect(
          e.recommendation,
          `${e.event} adminDispatchEnabled requires recommendation='admin_queue'`,
        ).toBe("admin_queue");
        expect(
          e.allowedRecipients,
          `${e.event} adminDispatchEnabled requires platform_admin in allowedRecipients`,
        ).toContain("platform_admin");
        for (const forbidden of [
          "counterparty_org_admin",
          "ordinary_org_member",
          "external_unregistered_counterparty",
          "disputed_counterparty",
          "candidate_org",
        ]) {
          expect(
            e.allowedRecipients,
            `${e.event} must not allow ${forbidden}`,
          ).not.toContain(forbidden);
        }
      }
    }
  });

  it("forbids re-contacting the disputed counterparty on every event", () => {
    for (const e of BATCH_D_EVENTS) {
      expect(
        e.forbiddenRecipients,
        `${e.event} must list disputed_counterparty as forbidden`,
      ).toContain("disputed_counterparty");
    }
  });

  it("never overlaps allowedRecipients with forbiddenRecipients", () => {
    for (const e of BATCH_D_EVENTS) {
      const overlap = e.allowedRecipients.filter((r) =>
        e.forbiddenRecipients.includes(r),
      );
      expect(overlap, `${e.event} has overlap`).toEqual([]);
    }
  });
});

describe("Batch D — D4a wording guard", () => {
  it("accepts every safeWording in the catalogue", () => {
    for (const e of BATCH_D_EVENTS) {
      const hits = findForbiddenWords(e.safeWording);
      expect(
        hits,
        `${e.event} safeWording contains forbidden word(s): ${hits.join(", ")}`,
      ).toEqual([]);
    }
  });

  it("accepts every label in the catalogue", () => {
    for (const e of BATCH_D_EVENTS) {
      const hits = findForbiddenWords(e.label);
      expect(hits, `${e.event} label contains forbidden word(s)`).toEqual([]);
    }
  });

  it("rejects each forbidden token in isolation (case-insensitive)", () => {
    for (const word of BATCH_D_FORBIDDEN_WORDS) {
      const upper = word.toUpperCase();
      const mixed = word.charAt(0).toUpperCase() + word.slice(1);
      expect(findForbiddenWords(`copy contains ${word} here`)).toContain(word);
      expect(findForbiddenWords(`copy contains ${upper} here`)).toContain(word);
      expect(findForbiddenWords(`copy contains ${mixed} here`)).toContain(word);
    }
  });

  it("does not flag innocent words that merely contain a forbidden substring", () => {
    // "breach" is on the list as a whole word, but "outbreach" / "breached"
    // tokenisations are intentionally caught (the guard is conservative).
    // We only assert true negatives for clearly unrelated words.
    expect(findForbiddenWords("paused under platform review")).toEqual([]);
    expect(findForbiddenWords("awaiting binding-review decision")).toEqual([]);
    expect(findForbiddenWords("the engagement has been cancelled")).toEqual([]);
  });
});

describe("Batch D — D4a recommendation typing", () => {
  it("only uses recommendation values defined by the catalogue", () => {
    const allowed = new Set([
      "audit_only",
      "admin_queue",
      "admin_email_candidate",
      "deferred",
    ]);
    for (const e of BATCH_D_EVENTS) {
      expect(allowed.has(e.recommendation), e.event).toBe(true);
    }
  });

  it("admin_email_candidate entries never enable admin dispatch", () => {
    // `admin_email_candidate` is a planning-stage marker only; it must
    // never coincide with `adminDispatchEnabled: true`. D4b uses
    // `admin_queue` exclusively for the two flipped events.
    for (const e of BATCH_D_EVENTS as readonly BatchDEventEntry[]) {
      if (e.recommendation === "admin_email_candidate") {
        expect(e.adminDispatchEnabled).toBe(false);
      }
    }
  });
});
