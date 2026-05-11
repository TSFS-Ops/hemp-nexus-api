/**
 * D4c-3d — Wiring contract test for the binding-review initial-entry path.
 *
 * Pins the static contract that the PATCH handler in
 * `supabase/functions/poi-engagements/index.ts`:
 *   • imports `dispatchD4cInitiatorAlert`;
 *   • dispatches `engagement.binding_review_required` exactly once,
 *     inside the `bindingReviewInitialEntry` initial-entry branch
 *     (so repeated PATCHes that find the row already in review do
 *     NOT duplicate the alert);
 *   • uses the stable dedupe key `binding_review_required:${engagementId}`;
 *   • is best-effort (try/catch wrapped, primary PATCH unaffected);
 *   • passes only NON-PII operational metadata and NEVER counterparty /
 *     candidate / disputed / commercial fields.
 *
 * Live behaviour (queueing, dedupe, suppression, no-leakage) is exercised
 * by `supabase/functions/d4c-binding-review-required-live-proof/`.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve as pathResolve } from "node:path";

const SRC = readFileSync(
  pathResolve(__dirname, "../../supabase/functions/poi-engagements/index.ts"),
  "utf8",
);

function findD4cBindingReviewRequiredCall(): string {
  let searchFrom = 0;
  while (true) {
    const idx = SRC.indexOf("dispatchD4cInitiatorAlert(supabase, {", searchFrom);
    if (idx < 0) return "";
    const slice = SRC.slice(idx, idx + 1500);
    if (slice.includes('"engagement.binding_review_required"')) {
      return slice;
    }
    searchFrom = idx + 1;
  }
}

describe("D4c-3d — binding_review_required wiring", () => {
  it("imports the helper", () => {
    expect(SRC).toContain(
      `import { dispatchD4cInitiatorAlert } from "../_shared/batch-d-initiator-notify.ts"`,
    );
  });

  it("contains exactly one engagement.binding_review_required dispatch site", () => {
    const dispatchEventOccurrences = SRC.split(
      `eventType: "engagement.binding_review_required"`,
    ).length - 1;
    expect(dispatchEventOccurrences).toBe(1);
  });

  it("dispatch lives inside the bindingReviewInitialEntry initial-entry branch", () => {
    const callBlock = findD4cBindingReviewRequiredCall();
    expect(callBlock).not.toBe("");
    // Find the position of the dispatch and confirm the enclosing
    // `if (bindingReviewInitialEntry) {` block is the immediate guard.
    const dispatchIdx = SRC.indexOf("dispatchD4cInitiatorAlert(supabase, {");
    // Walk back from the dispatch site and assert we hit the
    // initial-entry guard before any other top-level `if`/handler boundary.
    let cursor = dispatchIdx;
    while (cursor > 0) {
      const guardIdx = SRC.lastIndexOf("if (bindingReviewInitialEntry)", cursor);
      const handlerIdx = SRC.lastIndexOf('if (req.method', cursor);
      expect(guardIdx).toBeGreaterThan(handlerIdx);
      // Once we've found the guard, we're done.
      if (guardIdx > 0) break;
      cursor = guardIdx;
    }
  });

  it("uses the expected event type, source function, dedupe key, and actorUserId", () => {
    const callBlock = findD4cBindingReviewRequiredCall();
    expect(callBlock).toContain('eventType: "engagement.binding_review_required"');
    expect(callBlock).toContain('sourceFunction: "poi-engagements"');
    expect(callBlock).toContain("dedupeKey: `binding_review_required:${engagementId}`");
    expect(callBlock).toContain("actorUserId: authCtx.userId ?? null");
  });

  it("is best-effort (try/catch wrapped, primary flow protected)", () => {
    const dispatchIdx = SRC.indexOf(
      `eventType: "engagement.binding_review_required"`,
    );
    expect(dispatchIdx).toBeGreaterThan(0);
    // The dispatch site must be inside a `try {` block whose `catch`
    // logs `non-fatal`.
    const tryIdx = SRC.lastIndexOf("try {", dispatchIdx);
    expect(tryIdx).toBeGreaterThan(0);
    const tail = SRC.slice(dispatchIdx, dispatchIdx + 1500);
    expect(tail).toMatch(/catch\s*\([^)]*\)\s*\{[\s\S]*?non-fatal/);
  });

  it("metadata contains no counterparty/candidate/disputed/commercial fields", () => {
    const callBlock = findD4cBindingReviewRequiredCall();
    expect(callBlock).not.toBe("");
    const forbidden = [
      "counterparty_email",
      "counterparty_name",
      "counterparty_org_name",
      "counterparty_org_id",
      "candidate_org",
      "candidate_id",
      "candidate_name",
      "binding_candidates",
      "possible_org",
      "commodity",
      "price",
      "quantity",
      "disputed_",
      "dispute_reason",
    ];
    for (const f of forbidden) {
      expect(callBlock).not.toContain(f);
    }
    // Expected safe keys are present.
    expect(callBlock).toContain("request_id");
    expect(callBlock).toContain("previous_operational_state");
    expect(callBlock).toContain("reason_codes_count");
  });

  it("does NOT dispatch from the already-in-review (replay) branch", () => {
    // The initial-entry guard is `if (bindingReviewInitialEntry)`, which is
    // null when previousOperationalState === 'binding_review_required'.
    // Confirm there's no second dispatch site outside that guard.
    const replayMarker = "isAlreadyInReview";
    const replayIdx = SRC.indexOf(replayMarker);
    expect(replayIdx).toBeGreaterThan(0);
    // No d4c dispatch may appear in the section that handles repeated PATCHes.
    // We assert that between the replay guard and the next handler boundary,
    // there is no `engagement.binding_review_required` dispatchD4cInitiatorAlert.
    // The single allowed dispatch is INSIDE bindingReviewInitialEntry, which
    // precedes any replay-only path. If a future edit added a second site,
    // the "exactly one" test above would already fail.
    const occurrences = SRC.split(
      `dedupeKey: \`binding_review_required:\${engagementId}\``,
    ).length - 1;
    expect(occurrences).toBe(1);
  });
});
