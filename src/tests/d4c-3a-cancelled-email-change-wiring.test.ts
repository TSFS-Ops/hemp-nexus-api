/**
 * D4c-3a wiring proof — `poi-engagements/index.ts` calls
 * `dispatchD4cInitiatorAlert` with the correct shape after the
 * cancelled-email-change commit. This is a STATIC source-shape
 * assertion (the production route is exercised end-to-end by
 * `supabase/functions/d4c-cancelled-email-change-live-proof/`).
 *
 * Pinning the call shape here protects the contract:
 *   - eventType is the catalogue-allowlisted constant
 *   - sourceFunction is "poi-engagements"
 *   - dedupeKey is stable per engagement id
 *   - metadata never references counterparty/candidate/disputed fields
 *   - the dispatch is wrapped in try/catch so the cancellation flow
 *     stays best-effort
 *   - the dispatch happens AFTER the audit-log insert and BEFORE
 *     the response is built (i.e. only after commit)
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SOURCE = readFileSync(
  resolve(
    process.cwd(),
    "supabase/functions/poi-engagements/index.ts",
  ),
  "utf8",
);

describe("D4c-3a — cancelled-email-change initiator alert wiring", () => {
  it("imports dispatchD4cInitiatorAlert from the shared helper", () => {
    expect(SOURCE).toMatch(
      /import\s*\{\s*dispatchD4cInitiatorAlert\s*\}\s*from\s*"\.\.\/_shared\/batch-d-initiator-notify\.ts"/,
    );
  });

  it("invokes dispatchD4cInitiatorAlert exactly once for the cancelled_email_change event", () => {
    // Other D4c-3* phases wire additional events (e.g. D4c-3b wires
    // binding_review_resolved), so total dispatch sites grow. The 3a
    // contract is: exactly one call carries the cancelled_email_change
    // event type.
    const matches = SOURCE.match(
      /dispatchD4cInitiatorAlert\(\s*supabase\s*,\s*\{[\s\S]*?eventType:\s*"engagement\.cancelled_email_change"/g,
    ) ?? [];
    expect(matches.length).toBe(1);
  });

  it("invocation uses the cancelled_email_change event type", () => {
    expect(SOURCE).toMatch(
      /dispatchD4cInitiatorAlert\(\s*supabase\s*,\s*\{\s*[\s\S]*?eventType:\s*"engagement\.cancelled_email_change"/,
    );
  });

  it("invocation passes engagementId, sourceFunction, and a stable dedupeKey", () => {
    const block = SOURCE.match(
      /dispatchD4cInitiatorAlert\([\s\S]*?\}\s*\)\s*;/,
    )?.[0] ?? "";
    expect(block).toMatch(/engagementId\s*,/);
    expect(block).toMatch(/sourceFunction:\s*"poi-engagements"/);
    expect(block).toMatch(/dedupeKey:\s*`cancelled_email_change:\$\{engagementId\}`/);
  });

  it("invocation passes only safe non-PII metadata (request_id, previous_status)", () => {
    const block = SOURCE.match(
      /dispatchD4cInitiatorAlert\([\s\S]*?\}\s*\)\s*;/,
    )?.[0] ?? "";
    expect(block).toMatch(/metadata:\s*\{[\s\S]*?request_id:\s*requestId/);
    expect(block).toMatch(/previous_status:\s*current\.engagement_status/);
    // Forbidden references inside the call site:
    for (const banned of [
      "counterparty_email",
      "new_email",
      "counterparty_org_id",
      "binding_candidates",
      "binding_resolution",
      "commodity",
      "price_amount",
      "quantity_amount",
      "disputed",
      "candidate",
    ]) {
      expect(
        block.includes(banned),
        `dispatch metadata must not reference "${banned}"`,
      ).toBe(false);
    }
  });

  it("invocation is wrapped in a try/catch so cancellation stays best-effort", () => {
    // Look at the surrounding ~12 lines to confirm try { ... dispatch ... } catch
    const idx = SOURCE.indexOf("dispatchD4cInitiatorAlert(");
    expect(idx).toBeGreaterThan(-1);
    const window = SOURCE.slice(Math.max(0, idx - 400), idx + 800);
    expect(window).toMatch(/try\s*\{[\s\S]*dispatchD4cInitiatorAlert\(/);
    expect(window).toMatch(/\}\s*catch\s*\(/);
  });

  it("dispatch happens AFTER the cancel audit insert and BEFORE the response build", () => {
    const auditIdx = SOURCE.indexOf('action: "engagement.cancelled_for_email_change"');
    const dispatchIdx = SOURCE.indexOf("dispatchD4cInitiatorAlert(");
    // There are many `const responseBody = ...` declarations across
    // other route handlers; only the FIRST one AFTER the dispatch
    // closes this branch.
    const responseIdx = SOURCE.indexOf(
      "const responseBody = { engagement: updated };",
      dispatchIdx,
    );
    expect(auditIdx).toBeGreaterThan(-1);
    expect(dispatchIdx).toBeGreaterThan(auditIdx);
    expect(responseIdx).toBeGreaterThan(dispatchIdx);
  });
});
