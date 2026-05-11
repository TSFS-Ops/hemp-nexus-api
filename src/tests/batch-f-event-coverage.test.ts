/**
 * Batch F — canonical Batch D/E event coverage contract.
 *
 * Single source of truth for "what is each Batch D/E event allowed to
 * do at runtime?". Pins, for every entry in `BATCH_D_EVENTS`:
 *
 *   1. An explicit classification (audit_only | admin_dispatched |
 *      initiator_dispatched | both_dispatched). A new catalogue entry
 *      added without an entry here will fail this test loudly — it is
 *      the gate that forces every Batch F+ event to declare its
 *      delivery class on the way in.
 *
 *   2. The classification is consistent with the catalogue:
 *        - admin_dispatched  ⇒ catalogue.adminDispatchEnabled = true
 *        - audit_only        ⇒ catalogue.adminDispatchEnabled = false
 *
 *   3. Dispatcher allowlists in the deployed Deno helpers match the
 *      classification:
 *        - admin_dispatched events appear in `D4B_DISPATCH_EVENTS`
 *          (`_shared/batch-d-admin-notify.ts`).
 *        - initiator_dispatched events appear in the D4c initiator
 *          catalogue (`_shared/batch-d-initiator-notify.ts`).
 *        - audit_only events appear in NEITHER dispatcher.
 *
 *   4. `outreach.blocked.*` events are audit-only forever. They are
 *      never permitted in any dispatcher allowlist (defence in depth on
 *      top of `batch-e-outreach-blocked-emit.test.ts`).
 *
 *   5. No catalogue event ever permits a counterparty / member /
 *      external / disputed / candidate recipient group, regardless of
 *      classification.
 *
 *   6. Every classified `*_dispatched` event has at least one wiring
 *      site in production source (poi-engagements, lifecycle-scheduler,
 *      or a _shared helper). An admin-dispatched event with no
 *      `notification-dispatch` call site, or an initiator-dispatched
 *      event with no `dispatchD4cInitiatorAlert` call site, is a bug.
 *      We grep by event name (not by call count) so this test does not
 *      become brittle when a new emit site is added in a future batch.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

import { BATCH_D_EVENTS } from "@/lib/batch-d-events";

const REPO_ROOT = join(__dirname, "..", "..");
const POI_ENGAGEMENTS_SRC = readFileSync(
  join(REPO_ROOT, "supabase/functions/poi-engagements/index.ts"),
  "utf8",
);
const LIFECYCLE_SCHEDULER_SRC = readFileSync(
  join(REPO_ROOT, "supabase/functions/lifecycle-scheduler/index.ts"),
  "utf8",
);
const D4B_ADMIN_NOTIFY_SRC = readFileSync(
  join(REPO_ROOT, "supabase/functions/_shared/batch-d-admin-notify.ts"),
  "utf8",
);
const D4C_INITIATOR_NOTIFY_SRC = readFileSync(
  join(REPO_ROOT, "supabase/functions/_shared/batch-d-initiator-notify.ts"),
  "utf8",
);

type Classification =
  | "audit_only"
  | "admin_dispatched"
  | "initiator_dispatched"
  | "both_dispatched";

/**
 * Explicit classification per event. Adding an event to BATCH_D_EVENTS
 * WITHOUT adding it here is a hard test failure (see the "every
 * catalogue event is classified" assertion). When you add a new event,
 * decide its delivery class deliberately and add it here.
 */
const EVENT_CLASSIFICATION: Record<string, Classification> = {
  // Admin-queue + initiator notice. Wired by both D4b and D4c.
  "engagement.binding_review_required": "both_dispatched",
  // Audit-only on the catalogue (no admin dispatch), but the D4c
  // helper dispatches a generic resolution notice to the initiating
  // org admin.
  "engagement.binding_review_resolved": "initiator_dispatched",
  // Admin-queue + initiator notice. Wired by both D4b and D4c.
  "engagement.disputed_being_named": "both_dispatched",
  // Initiator-only notice (no admin dispatch).
  "engagement.cancelled_email_change": "initiator_dispatched",
  // Audit-only. No outbound dispatcher; surfaced via UI only.
  "engagement.email_change_blocked": "audit_only",
  // Initiator-only notice; the late-acceptance reconfirmation flow.
  "engagement.late_acceptance_pending_reconfirmation":
    "initiator_dispatched",
  // Batch E outreach-blocked audit family. Audit-only forever; UI
  // copy is rendered locally by `getInitiatorBlockedCopy` /
  // `getInitiatorOutreachBlockCopy`.
  "outreach.blocked.contact_incomplete": "audit_only",
  "outreach.blocked.binding_review_pending": "audit_only",
  "outreach.blocked.disputed_being_named": "audit_only",
};

const FORBIDDEN_RECIPIENTS = [
  "counterparty_org_admin",
  "ordinary_org_member",
  "external_unregistered_counterparty",
  "disputed_counterparty",
  "candidate_org",
] as const;

const OUTREACH_BLOCKED_PREFIX = "outreach.blocked.";

function isAdminDispatched(c: Classification): boolean {
  return c === "admin_dispatched" || c === "both_dispatched";
}
function isInitiatorDispatched(c: Classification): boolean {
  return c === "initiator_dispatched" || c === "both_dispatched";
}

describe("Batch F — canonical event coverage", () => {
  it("every catalogue event has an explicit classification", () => {
    for (const e of BATCH_D_EVENTS) {
      expect(
        EVENT_CLASSIFICATION[e.event],
        `Catalogue event '${e.event}' has no Batch F classification. ` +
          `Add it to EVENT_CLASSIFICATION in batch-f-event-coverage.test.ts ` +
          `with one of: audit_only | admin_dispatched | initiator_dispatched | both_dispatched.`,
      ).toBeDefined();
    }
  });

  it("every classification refers to a real catalogue event", () => {
    const catalogueNames = new Set(BATCH_D_EVENTS.map((e) => e.event));
    for (const name of Object.keys(EVENT_CLASSIFICATION)) {
      expect(
        catalogueNames.has(name),
        `Classification refers to '${name}' which is not in BATCH_D_EVENTS.`,
      ).toBe(true);
    }
  });

  it("classification matches catalogue.adminDispatchEnabled", () => {
    for (const e of BATCH_D_EVENTS) {
      const c = EVENT_CLASSIFICATION[e.event];
      if (!c) continue;
      if (isAdminDispatched(c)) {
        expect(
          e.adminDispatchEnabled,
          `${e.event} is classified ${c} but catalogue.adminDispatchEnabled=false`,
        ).toBe(true);
      } else {
        expect(
          e.adminDispatchEnabled,
          `${e.event} is classified ${c} but catalogue.adminDispatchEnabled=true`,
        ).toBe(false);
      }
    }
  });

  it("admin-dispatched events appear in D4B_DISPATCH_EVENTS keys", () => {
    for (const e of BATCH_D_EVENTS) {
      const c = EVENT_CLASSIFICATION[e.event];
      if (!c || !isAdminDispatched(c)) continue;
      expect(
        D4B_ADMIN_NOTIFY_SRC.includes(`"${e.event}"`),
        `${e.event} is admin_dispatched but not present as a literal in batch-d-admin-notify.ts`,
      ).toBe(true);
    }
  });

  it("initiator-dispatched events appear in the D4c initiator catalogue", () => {
    for (const e of BATCH_D_EVENTS) {
      const c = EVENT_CLASSIFICATION[e.event];
      if (!c || !isInitiatorDispatched(c)) continue;
      expect(
        D4C_INITIATOR_NOTIFY_SRC.includes(`event: "${e.event}"`),
        `${e.event} is initiator_dispatched but not present as a catalogue entry in batch-d-initiator-notify.ts`,
      ).toBe(true);
    }
  });

  it("audit-only events appear in NEITHER dispatcher allowlist", () => {
    for (const e of BATCH_D_EVENTS) {
      const c = EVENT_CLASSIFICATION[e.event];
      if (c !== "audit_only") continue;
      // Admin allowlist: the literal must not appear as a key in the
      // D4B_DISPATCH_EVENT_TO_LABEL map. We approximate by requiring
      // the literal be absent OR only present in a comment context.
      const adminLines = D4B_ADMIN_NOTIFY_SRC.split("\n").filter((l) =>
        l.includes(`"${e.event}"`),
      );
      for (const line of adminLines) {
        expect(
          /^\s*\*|\/\/|never|excluded|not allowed|forbidden/i.test(line),
          `audit-only event '${e.event}' appears in batch-d-admin-notify.ts in a non-comment context: ${line}`,
        ).toBe(true);
      }
      // Initiator allowlist: must not be a `event: "..."` entry.
      expect(
        D4C_INITIATOR_NOTIFY_SRC.includes(`event: "${e.event}"`),
        `audit-only event '${e.event}' must not be a catalogue entry in batch-d-initiator-notify.ts`,
      ).toBe(false);
    }
  });

  it("outreach.blocked.* events are never in any dispatcher (regression guard)", () => {
    for (const e of BATCH_D_EVENTS) {
      if (!e.event.startsWith(OUTREACH_BLOCKED_PREFIX)) continue;
      // Same shape as the audit-only assertion, but unconditional —
      // even if a future maintainer mis-classifies an outreach.blocked
      // event, this assertion fires.
      expect(
        D4C_INITIATOR_NOTIFY_SRC.includes(`event: "${e.event}"`),
        `${e.event} must NEVER be added to the D4c initiator catalogue`,
      ).toBe(false);
      const adminLines = D4B_ADMIN_NOTIFY_SRC.split("\n").filter((l) =>
        l.includes(`"${e.event}"`),
      );
      for (const line of adminLines) {
        expect(
          /^\s*\*|\/\/|never|excluded|not allowed|forbidden/i.test(line),
          `${e.event} must NEVER be added to batch-d-admin-notify.ts (offending line: ${line})`,
        ).toBe(true);
      }
    }
  });

  it("no catalogue event ever permits a counterparty/member/external/disputed/candidate recipient", () => {
    for (const e of BATCH_D_EVENTS) {
      for (const banned of FORBIDDEN_RECIPIENTS) {
        expect(
          e.allowedRecipients,
          `${e.event} must not allow ${banned}`,
        ).not.toContain(banned);
      }
    }
  });
});

describe("Batch F — emit-site coverage", () => {
  /**
   * Every dispatched event must have at least one wiring site in
   * production source. We grep by event name across the two surfaces
   * that own engagement state (poi-engagements + lifecycle-scheduler)
   * — this is a presence check, NOT a call-count check, to avoid the
   * brittleness called out in the Batch F prompt.
   */
  for (const e of BATCH_D_EVENTS) {
    const c = EVENT_CLASSIFICATION[e.event];
    if (!c || c === "audit_only") continue;
    it(`'${e.event}' (${c}) has at least one production wiring site`, () => {
      const inPoi = POI_ENGAGEMENTS_SRC.includes(`"${e.event}"`);
      const inLifecycle = LIFECYCLE_SCHEDULER_SRC.includes(`"${e.event}"`);
      expect(
        inPoi || inLifecycle,
        `${e.event} is classified ${c} but has no literal wiring site in poi-engagements or lifecycle-scheduler`,
      ).toBe(true);
    });
  }

  it("every audit-only event has at least one emit site or is intentionally UI-only", () => {
    // Audit-only events fall into two camps:
    //   a) emitted by the server as `audit_logs.action` rows
    //      (the outreach.blocked.* family + engagement.email_change_blocked
    //      style cases);
    //   b) intentionally not emitted at the catalogue level — i.e. the
    //      catalogue entry exists only to document a UI-visible state.
    // We require category (a) for every entry today: every audit-only
    // event MUST appear in poi-engagements as a literal action string.
    // If a future entry is genuinely UI-only, add it to UI_ONLY_EVENTS
    // below WITH a comment explaining why.
    const UI_ONLY_EVENTS = new Set<string>([
      // (none today)
    ]);
    for (const e of BATCH_D_EVENTS) {
      const c = EVENT_CLASSIFICATION[e.event];
      if (c !== "audit_only") continue;
      if (UI_ONLY_EVENTS.has(e.event)) continue;
      const inPoi = POI_ENGAGEMENTS_SRC.includes(`"${e.event}"`);
      const inLifecycle = LIFECYCLE_SCHEDULER_SRC.includes(`"${e.event}"`);
      expect(
        inPoi || inLifecycle,
        `audit-only event '${e.event}' has no literal emit site in poi-engagements or lifecycle-scheduler. ` +
          `If this is intentional, add it to UI_ONLY_EVENTS with a justification.`,
      ).toBe(true);
    }
  });
});

describe("Batch F — legacy contact.incomplete_detected fully retired", () => {
  it("no source file references the legacy contact.incomplete_detected action", () => {
    // Sanity: Batch E left no dual-write to retire later. This test
    // pins that fact so a future regression cannot silently re-introduce
    // the legacy event.
    const sources = [
      POI_ENGAGEMENTS_SRC,
      LIFECYCLE_SCHEDULER_SRC,
      D4B_ADMIN_NOTIFY_SRC,
      D4C_INITIATOR_NOTIFY_SRC,
    ];
    for (const src of sources) {
      expect(src.includes("contact.incomplete_detected")).toBe(false);
    }
  });
});
