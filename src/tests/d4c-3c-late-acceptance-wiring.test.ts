/**
 * D4c-3c — Wiring contract test for the late-acceptance recorded path.
 *
 * Pins the static contract that the counterparty `respond` handler in
 * `supabase/functions/poi-engagements/index.ts`:
 *   • calls `dispatchD4cInitiatorAlert` exactly once with the
 *     `engagement.late_acceptance_pending_reconfirmation` event;
 *   • passes a stable dedupeKey, sourceFunction "poi-engagements",
 *     and only NON-PII metadata (request_id + previous_status);
 *   • runs AFTER the late-acceptance state is committed (after the
 *     atomic_record_late_acceptance success log) and BEFORE the
 *     200 response is built;
 *   • is wrapped in try/catch so the primary late-acceptance flow
 *     succeeds even if the helper throws or is unavailable;
 *   • is NOT also wired into the reconfirm or decline branches.
 *
 * Live behaviour (queueing, dedupe, suppression, no-leakage) is exercised
 * by `supabase/functions/d4c-late-acceptance-reconfirmation-live-proof/`.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve as pathResolve } from "node:path";

const SRC = readFileSync(
  pathResolve(
    process.cwd(),
    "supabase/functions/poi-engagements/index.ts",
  ),
  "utf8",
);

describe("D4c-3c — late-acceptance pending-reconfirmation wiring", () => {
  it("imports the helper", () => {
    expect(SRC).toMatch(
      /import\s*\{\s*dispatchD4cInitiatorAlert\s*\}\s*from\s*"\.\.\/_shared\/batch-d-initiator-notify\.ts"/,
    );
  });

  it("invokes dispatchD4cInitiatorAlert exactly once for late_acceptance_pending_reconfirmation", () => {
    const matches = SRC.match(
      /dispatchD4cInitiatorAlert\(\s*supabase\s*,\s*\{[\s\S]*?eventType:\s*"engagement\.late_acceptance_pending_reconfirmation"/g,
    ) ?? [];
    expect(matches.length).toBe(1);
  });

  function lateAcceptDispatchBlock(): string {
    // Walk to the eventType literal, then back to the enclosing
    // `dispatchD4cInitiatorAlert(supabase, {`, then forward to the
    // matching `});` (the close of THIS dispatch call only).
    const eventIdx = SRC.indexOf(
      'eventType: "engagement.late_acceptance_pending_reconfirmation"',
    );
    expect(eventIdx).toBeGreaterThan(-1);
    const startIdx = SRC.lastIndexOf(
      "dispatchD4cInitiatorAlert(supabase, {",
      eventIdx,
    );
    expect(startIdx).toBeGreaterThan(-1);
    // Forward scan with brace-depth tracking from the opening `{`.
    const openBrace = SRC.indexOf("{", startIdx);
    let depth = 0;
    let i = openBrace;
    for (; i < SRC.length; i++) {
      const ch = SRC[i];
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    // Include trailing `);`.
    const end = SRC.indexOf(";", i) + 1;
    return SRC.slice(startIdx, end);
  }

  it("invocation passes engagementId, sourceFunction, and a stable dedupeKey", () => {
    const block = lateAcceptDispatchBlock();
    expect(block).toMatch(/engagementId:\s*engagement\.id/);
    expect(block).toMatch(/sourceFunction:\s*"poi-engagements"/);
    expect(block).toMatch(
      /dedupeKey:\s*`late_acceptance_pending_reconfirmation:\$\{engagement\.id\}`/,
    );
    expect(block).toMatch(/actorUserId:\s*authCtx\.userId\s*\?\?\s*null/);
  });

  it("invocation passes only safe non-PII metadata (request_id, previous_status)", () => {
    const block = lateAcceptDispatchBlock();
    expect(block).toMatch(/metadata:\s*\{[\s\S]*?request_id:\s*requestId/);
    expect(block).toMatch(/previous_status:\s*currentStatus/);
    for (const banned of [
      "counterparty_email",
      "counterparty_name",
      "counterparty_org_id",
      "new_email",
      "binding_candidates",
      "binding_resolution",
      "commodity",
      "price_amount",
      "quantity_amount",
      "price_currency",
      "disputed",
      "candidate",
    ]) {
      expect(
        block.includes(banned),
        `dispatch metadata must not reference "${banned}"`,
      ).toBe(false);
    }
  });

  it("invocation is wrapped in try/catch so the late-acceptance flow stays best-effort", () => {
    const idx = SRC.indexOf(
      'eventType: "engagement.late_acceptance_pending_reconfirmation"',
    );
    expect(idx).toBeGreaterThan(-1);
    const window = SRC.slice(Math.max(0, idx - 600), idx + 1200);
    expect(window).toMatch(/try\s*\{[\s\S]*dispatchD4cInitiatorAlert\(/);
    expect(window).toMatch(/\}\s*catch\s*\(/);
    expect(window).toMatch(/non-fatal/);
  });

  it("dispatch happens AFTER the atomic_record_late_acceptance success log and BEFORE the 200 response", () => {
    const successLogIdx = SRC.indexOf(
      "late-accepted engagement ${engagement.id}; awaiting initiator reconfirmation",
    );
    const dispatchIdx = SRC.indexOf(
      'eventType: "engagement.late_acceptance_pending_reconfirmation"',
    );
    const responseIdx = SRC.indexOf(
      'counterparty_response: "accepted_after_expiry"',
      dispatchIdx,
    );
    expect(successLogIdx).toBeGreaterThan(-1);
    expect(dispatchIdx).toBeGreaterThan(successLogIdx);
    expect(responseIdx).toBeGreaterThan(dispatchIdx);
  });

  it("reconfirm + decline-late-acceptance route handler does NOT dispatch the pending-reconfirmation event", () => {
    // The reconfirm/decline branch is gated by
    //   parts[1] === "reconfirm" || parts[1] === "decline-late-acceptance"
    const startIdx = SRC.indexOf(
      'parts[1] === "reconfirm" || parts[1] === "decline-late-acceptance"',
    );
    expect(startIdx).toBeGreaterThan(-1);
    const block = SRC.slice(startIdx, startIdx + 8000);
    expect(block).not.toContain(
      "engagement.late_acceptance_pending_reconfirmation",
    );
  });
});

