/**
 * D4c-3e — Wiring contract test for the disputed-being-named path.
 *
 * Pins that the POST /poi-engagements/:id/dispute handler in
 * `supabase/functions/poi-engagements/index.ts`:
 *   • imports `dispatchD4cInitiatorAlert`;
 *   • dispatches `engagement.disputed_being_named` exactly once,
 *     after the disputed_being_named state has been committed;
 *   • uses the stable dedupe key `disputed_being_named:${engagementId}`;
 *   • is best-effort (try/catch wrapped, primary dispute flow unaffected);
 *   • passes only NON-PII operational metadata, NEVER counterparty /
 *     candidate / disputed identity / dispute reason / commercial fields.
 *
 * Live behaviour (queueing, dedupe, suppression, no-leakage) is exercised
 * by `supabase/functions/d4c-disputed-being-named-live-proof/`.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve as pathResolve } from "node:path";

const SRC = readFileSync(
  pathResolve(__dirname, "../../supabase/functions/poi-engagements/index.ts"),
  "utf8",
);

function findD4cDisputedCall(): string {
  let searchFrom = 0;
  while (true) {
    const idx = SRC.indexOf("dispatchD4cInitiatorAlert(supabase, {", searchFrom);
    if (idx < 0) return "";
    const end = SRC.indexOf("});", idx);
    const slice = SRC.slice(idx, end > 0 ? end + 3 : idx + 1200);
    if (slice.includes('"engagement.disputed_being_named"')) {
      return slice;
    }
    searchFrom = idx + 1;
  }
}

describe("D4c-3e — disputed_being_named wiring", () => {
  it("imports the helper", () => {
    expect(SRC).toContain(
      `import { dispatchD4cInitiatorAlert } from "../_shared/batch-d-initiator-notify.ts"`,
    );
  });

  it("contains exactly one D4c initiator dispatch for disputed_being_named", () => {
    const occurrences = SRC.split(
      "dedupeKey: `disputed_being_named:${engagementId}`",
    ).length - 1;
    expect(occurrences).toBe(1);
  });

  it("dispatch lives inside the POST /dispute handler, after the commit", () => {
    const callBlock = findD4cDisputedCall();
    expect(callBlock).not.toBe("");
    const dispatchIdx = SRC.indexOf(
      `eventType: "engagement.disputed_being_named"`,
    );
    expect(dispatchIdx).toBeGreaterThan(0);
    // The dispute handler is `if (req.method === "POST" && engagementId && parts[1] === "dispute")`.
    const handlerIdx = SRC.lastIndexOf(`parts[1] === "dispute"`, dispatchIdx);
    expect(handlerIdx).toBeGreaterThan(0);
    // The commit (`engagement_status: "disputed_being_named"`) must precede the dispatch.
    const commitIdx = SRC.lastIndexOf(`engagement_status: "disputed_being_named"`, dispatchIdx);
    expect(commitIdx).toBeGreaterThan(handlerIdx);
    expect(commitIdx).toBeLessThan(dispatchIdx);
  });

  it("uses the expected event type, source function, dedupe key, and actorUserId", () => {
    const callBlock = findD4cDisputedCall();
    expect(callBlock).toContain('eventType: "engagement.disputed_being_named"');
    expect(callBlock).toContain('sourceFunction: "poi-engagements"');
    expect(callBlock).toContain("dedupeKey: `disputed_being_named:${engagementId}`");
    expect(callBlock).toContain("actorUserId: authCtx.userId ?? null");
  });

  it("is best-effort (try/catch wrapped, primary flow protected)", () => {
    const dispatchIdx = SRC.indexOf(
      `eventType: "engagement.disputed_being_named"`,
    );
    expect(dispatchIdx).toBeGreaterThan(0);
    const tryIdx = SRC.lastIndexOf("try {", dispatchIdx);
    expect(tryIdx).toBeGreaterThan(0);
    const tail = SRC.slice(dispatchIdx, dispatchIdx + 1500);
    expect(tail).toMatch(/catch\s*\([^)]*\)\s*\{[\s\S]*?non-fatal/);
  });

  it("metadata contains no counterparty/candidate/disputed/commercial/dispute-text fields", () => {
    const callBlock = findD4cDisputedCall();
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
      "dispute_reason",
      "disputed_by_token_hash",
      "token_hash",
      "dispute_source",
      "reason:",
    ];
    for (const f of forbidden) {
      expect(callBlock).not.toContain(f);
    }
    expect(callBlock).toContain("request_id");
    expect(callBlock).toContain("previous_status");
    expect(callBlock).toContain("previous_operational_state");
  });

  it("relies on the already-disputed 409 early-return for replay-safety", () => {
    // The handler returns ALREADY_DISPUTED (409) when the row is already
    // in disputed_being_named state, BEFORE reaching the dispatch site.
    const earlyAbortIdx = SRC.indexOf('"ALREADY_DISPUTED"');
    expect(earlyAbortIdx).toBeGreaterThan(0);
    const dispatchIdx = SRC.indexOf(
      `eventType: "engagement.disputed_being_named"`,
    );
    expect(earlyAbortIdx).toBeLessThan(dispatchIdx);
    // Single dispatch site, asserted above.
    const occurrences = SRC.split(
      "dedupeKey: `disputed_being_named:${engagementId}`",
    ).length - 1;
    expect(occurrences).toBe(1);
  });
});
