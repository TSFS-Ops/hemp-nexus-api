/**
 * Batch E — outreach.blocked.* canonical-emit + initiator-copy contract.
 *
 * Phase 1 deliverable. Pins:
 *   1. The three canonical catalogue events
 *      (`outreach.blocked.contact_incomplete`,
 *      `outreach.blocked.binding_review_pending`,
 *      `outreach.blocked.disputed_being_named`) exist as audit-only
 *      entries with `adminDispatchEnabled: false`.
 *   2. The `poi-engagements` edge function source emits these exact
 *      action strings at the gate sites.
 *   3. The initiator-side neutral copy helper passes the Batch D
 *      forbidden-word guard and exposes no counterparty / candidate /
 *      dispute / commercial placeholders.
 *   4. The D4c initiator dispatcher allowlist still excludes
 *      `outreach.blocked.*` (regression guard).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

import {
  BATCH_D_EVENTS,
  findForbiddenWords,
  getBatchDEvent,
} from "@/lib/batch-d-events";
import {
  INITIATOR_BLOCKED_COPY,
  INITIATOR_OUTREACH_BLOCK_COPY,
  getInitiatorBlockedCopy,
  getInitiatorOutreachBlockCopy,
} from "@/lib/initiator-blocked-copy";

const REPO_ROOT = join(__dirname, "..", "..");
const POI_ENGAGEMENTS_SRC = readFileSync(
  join(REPO_ROOT, "supabase/functions/poi-engagements/index.ts"),
  "utf8",
);
const D4C_INITIATOR_SRC = readFileSync(
  join(REPO_ROOT, "supabase/functions/_shared/batch-d-initiator-notify.ts"),
  "utf8",
);

const OUTREACH_BLOCKED_EVENTS = [
  "outreach.blocked.contact_incomplete",
  "outreach.blocked.binding_review_pending",
  "outreach.blocked.disputed_being_named",
] as const;

// Tokens that must NEVER appear in initiator-facing copy. These are
// fields that would leak counterparty / candidate / dispute / commercial
// identity if interpolated into a template.
const FORBIDDEN_PLACEHOLDERS = [
  "{counterparty",
  "{candidate",
  "{disputed",
  "{commodity",
  "{price",
  "{quantity",
  "{org_name",
  "{contact_email",
  "{contact_name",
];

describe("Batch E :: catalogue surface", () => {
  it("each outreach.blocked.* event is audit-only and never admin-dispatched", () => {
    for (const ev of OUTREACH_BLOCKED_EVENTS) {
      const entry = getBatchDEvent(ev);
      expect(entry, `missing catalogue entry for ${ev}`).toBeDefined();
      expect(entry!.recommendation).toBe("audit_only");
      expect(entry!.adminDispatchEnabled).toBe(false);
      // Initiator-only or initiating-org-admin only — never any
      // counterparty / candidate / disputed / external recipient.
      for (const banned of [
        "counterparty_org_admin",
        "external_unregistered_counterparty",
        "disputed_counterparty",
        "candidate_org",
      ]) {
        expect(
          entry!.allowedRecipients,
          `${ev} must not allow ${banned}`,
        ).not.toContain(banned);
      }
    }
  });

  it("the D4c initiator allowlist excludes every outreach.blocked.* event", () => {
    // Hard regression guard: if a future edit slips an outreach.blocked
    // event into the D4c-2 helper we want this to fail loudly. We grep
    // the source so the test is independent of any helper export shape.
    for (const ev of OUTREACH_BLOCKED_EVENTS) {
      // The string may legitimately appear inside a comment that
      // documents the exclusion — accept a reference only when it sits
      // in the same line as the word "exclude" / "excluded" / "must not".
      const lines = D4C_INITIATOR_SRC.split("\n").filter((l) => l.includes(ev));
      for (const line of lines) {
        expect(
          /exclude|excluded|must not|never|outside/i.test(line),
          `${ev} appears in batch-d-initiator-notify.ts in a non-exclusion context: ${line}`,
        ).toBe(true);
      }
    }
  });
});

describe("Batch E :: poi-engagements emits canonical audit actions", () => {
  for (const ev of OUTREACH_BLOCKED_EVENTS) {
    it(`emits "${ev}" at a gate site`, () => {
      // Look for the literal string appearing as an `action:` write.
      // The two contact-incomplete sites use a `for (const action of [...])`
      // loop containing the literal; the disputed/binding sites assign it
      // to a `canonicalAction` constant. Both shapes contain the literal.
      const occurrences = POI_ENGAGEMENTS_SRC.split(`"${ev}"`).length - 1;
      expect(
        occurrences,
        `expected at least one literal occurrence of "${ev}" in poi-engagements/index.ts`,
      ).toBeGreaterThanOrEqual(1);
    });
  }

  it("legacy contact.incomplete_detected emit has been retired (Batch H)", () => {
    // Batch H — dependency audit confirmed zero production consumers.
    // The legacy event must no longer appear as a string literal in
    // poi-engagements/index.ts (comments referencing the historical
    // name are stripped before the assertion).
    const codeOnly = POI_ENGAGEMENTS_SRC
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .map((l) => l.replace(/\/\/.*$/, ""))
      .join("\n");
    expect(
      codeOnly.includes(`"contact.incomplete_detected"`),
      "legacy contact.incomplete_detected literal must not appear in production code",
    ).toBe(false);
  });
});

describe("Batch E :: initiator copy is neutral and safe", () => {
  const allCopy = [
    ...Object.values(INITIATOR_BLOCKED_COPY),
    ...Object.values(INITIATOR_OUTREACH_BLOCK_COPY),
  ];

  it("passes the Batch D forbidden-word guard for headline / body / next", () => {
    for (const c of allCopy) {
      for (const text of [c.headline, c.body, c.next ?? ""]) {
        const hits = findForbiddenWords(text);
        expect(hits, `forbidden word(s) in copy: ${text}`).toEqual([]);
      }
    }
  });

  it("never embeds counterparty / candidate / dispute / commercial placeholders", () => {
    for (const c of allCopy) {
      const blob = `${c.headline}\n${c.body}\n${c.next ?? ""}`.toLowerCase();
      for (const ph of FORBIDDEN_PLACEHOLDERS) {
        expect(blob.includes(ph), `placeholder ${ph} in copy: ${blob}`).toBe(
          false,
        );
      }
    }
  });

  it("getInitiatorBlockedCopy / getInitiatorOutreachBlockCopy are total over their declared codes", () => {
    for (const code of Object.keys(INITIATOR_BLOCKED_COPY)) {
      expect(getInitiatorBlockedCopy(code as never)).not.toBeNull();
    }
    for (const code of Object.keys(INITIATOR_OUTREACH_BLOCK_COPY)) {
      expect(getInitiatorOutreachBlockCopy(code as never)).not.toBeNull();
    }
    expect(getInitiatorBlockedCopy(null)).toBeNull();
    expect(getInitiatorOutreachBlockCopy(null)).toBeNull();
  });

  it("catalogue safeWording for each outreach.blocked.* event also passes the wording guard (sanity)", () => {
    for (const ev of OUTREACH_BLOCKED_EVENTS) {
      const entry = getBatchDEvent(ev)!;
      expect(findForbiddenWords(entry.safeWording)).toEqual([]);
    }
  });
});

describe("Batch E :: catalogue parity (sanity)", () => {
  it("BATCH_D_EVENTS still contains the three outreach.blocked.* events", () => {
    const names = BATCH_D_EVENTS.map((e) => e.event);
    for (const ev of OUTREACH_BLOCKED_EVENTS) {
      expect(names).toContain(ev);
    }
  });
});
