/**
 * D4c-3b — Wiring contract test for the binding-review resolution path.
 *
 * Pins the static contract that the resolve-binding handler in
 * `supabase/functions/poi-engagements/index.ts`:
 *   • calls `dispatchD4cInitiatorAlert` with the correct event type,
 *     stable dedupe key, and source function;
 *   • passes only NON-PII metadata (request_id, resolution,
 *     previous_operational_state) and NEVER counterparty / candidate /
 *     disputed fields, commodity, price, or quantity;
 *   • is gated on `parsed.data.resolution !== "rejected"` so the rejected
 *     branch (which reasserts binding_review_required) does NOT send;
 *   • runs AFTER the audit-log insert and INSIDE a try/catch so the
 *     primary resolve flow succeeds even if the helper throws.
 *
 * Live behaviour (queueing, dedupe, suppression, no-leakage) is exercised
 * by `supabase/functions/d4c-binding-review-resolved-live-proof/`.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve as pathResolve } from "node:path";

const SRC = readFileSync(
  pathResolve(__dirname, "../../supabase/functions/poi-engagements/index.ts"),
  "utf8",
);

describe("D4c-3b — resolve-binding wiring", () => {
  it("imports the helper", () => {
    expect(SRC).toContain(
      `import { dispatchD4cInitiatorAlert } from "../_shared/batch-d-initiator-notify.ts"`,
    );
  });

  it("invokes dispatchD4cInitiatorAlert from the resolve-binding branch with the expected contract", () => {
    // Locate the resolve-binding handler block.
    const startIdx = SRC.indexOf('parts[1] === "resolve-binding"');
    expect(startIdx).toBeGreaterThan(0);
    // The next handler block starts at decline-late-acceptance / reconfirm.
    const endIdx = SRC.indexOf("decline-late-acceptance", startIdx);
    expect(endIdx).toBeGreaterThan(startIdx);
    const block = SRC.slice(startIdx, endIdx);

    expect(block).toContain("dispatchD4cInitiatorAlert");
    expect(block).toContain('eventType: "engagement.binding_review_resolved"');
    expect(block).toContain('sourceFunction: "poi-engagements"');
    expect(block).toContain("dedupeKey: `binding_review_resolved:${engagementId}`");
    expect(block).toContain("actorUserId: authCtx.userId ?? null");
  });

  it("is gated to NOT fire on the rejected branch", () => {
    const startIdx = SRC.indexOf('parts[1] === "resolve-binding"');
    const endIdx = SRC.indexOf("decline-late-acceptance", startIdx);
    const block = SRC.slice(startIdx, endIdx);
    expect(block).toMatch(/if\s*\(\s*parsed\.data\.resolution\s*!==\s*"rejected"\s*\)/);
  });

  it("is best-effort (try/catch wrapped, primary flow protected)", () => {
    const startIdx = SRC.indexOf('parts[1] === "resolve-binding"');
    const endIdx = SRC.indexOf("decline-late-acceptance", startIdx);
    const block = SRC.slice(startIdx, endIdx);
    // The dispatch site must be inside a try, with a non-fatal warn in catch.
    const dispatchIdx = block.indexOf("dispatchD4cInitiatorAlert");
    const tryIdx = block.lastIndexOf("try {", dispatchIdx);
    expect(tryIdx).toBeGreaterThan(0);
    // The catch following that try must contain "non-fatal".
    const tail = block.slice(dispatchIdx);
    expect(tail).toMatch(/catch\s*\([^)]*\)\s*\{[\s\S]*?non-fatal/);
  });

  it("dispatch happens AFTER the audit_logs insert", () => {
    const startIdx = SRC.indexOf('parts[1] === "resolve-binding"');
    const endIdx = SRC.indexOf("decline-late-acceptance", startIdx);
    const block = SRC.slice(startIdx, endIdx);
    const auditIdx = block.indexOf('"engagement.binding_review_resolved"');
    // First occurrence is the audit_logs.action, second is the helper eventType.
    const dispatchIdx = block.indexOf("dispatchD4cInitiatorAlert");
    expect(auditIdx).toBeGreaterThan(0);
    expect(dispatchIdx).toBeGreaterThan(auditIdx);
  });

  it("metadata passed to the helper contains no counterparty/candidate/disputed/commercial fields", () => {
    const startIdx = SRC.indexOf("dispatchD4cInitiatorAlert(supabase, {");
    expect(startIdx).toBeGreaterThan(0);
    // Find the binding_review_resolved call specifically.
    let searchFrom = 0;
    let callIdx = -1;
    while (true) {
      const idx = SRC.indexOf("dispatchD4cInitiatorAlert(supabase, {", searchFrom);
      if (idx < 0) break;
      const slice = SRC.slice(idx, idx + 1500);
      if (slice.includes('"engagement.binding_review_resolved"')) {
        callIdx = idx;
        break;
      }
      searchFrom = idx + 1;
    }
    expect(callIdx).toBeGreaterThan(0);
    const callBlock = SRC.slice(callIdx, callIdx + 1500);
    // metadata block content
    const forbidden = [
      "counterparty_email",
      "counterparty_name",
      "counterparty_org_name",
      "new_email",
      "candidate",
      "binding_candidates",
      "commodity",
      "price",
      "quantity",
      "disputed_",
    ];
    for (const f of forbidden) {
      expect(callBlock).not.toContain(f);
    }
    // expected keys present
    expect(callBlock).toContain("request_id");
    expect(callBlock).toContain("resolution");
    expect(callBlock).toContain("previous_operational_state");
  });
});
