/**
 * docs-ownership-explicitness — Phase 1 ownership-ambiguity guardrail.
 *
 * Test #8 from the Phase 1 brief:
 *   8. api-docs-examples-use-ownership-explicit-naming
 *
 * The point of this test is to lock in the Phase 1 documentation
 * corrections so that future GPT/AI edits cannot quietly remove the
 * perspective notes that disambiguate:
 *
 *   - counterparty record vs. opposite party vs. named lead
 *     (src/pages/docs/Counterparties.tsx)
 *   - opposite-slot references and single-side acknowledgement vs
 *     bilateral acceptance (src/pages/docs/Matches.tsx)
 *   - webhook payloads being scoped to the subscribing org and
 *     `counterparty_*` fields being relative to that subscriber
 *     (src/pages/docs/Webhooks.tsx)
 *
 * It also forbids the legacy ambiguous wording so that a regression
 * (e.g. "notifies the counterparty by email" without the named-lead
 * caveat) fails the test instead of silently shipping.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const DOCS_DIR = join(process.cwd(), "src", "pages", "docs");

function readDoc(name: string): string {
  return readFileSync(join(DOCS_DIR, name), "utf8");
}

describe("docs-ownership-explicitness — Counterparties page", () => {
  const text = readDoc("Counterparties.tsx");

  it("distinguishes counterparty RECORD from opposite party from named lead", () => {
    expect(text).toMatch(/counterparty record/i);
    expect(text).toMatch(/opposite party/i);
    expect(text).toMatch(/named lead/i);
  });

  it("does NOT contain the regressive 'notifies the counterparty by email' phrasing", () => {
    expect(text).not.toMatch(/notifies the counterparty by email/i);
  });

  it("clarifies that engagement hold-point is single-side, not both-party POI commitment", () => {
    expect(text).toMatch(/single-side/i);
    expect(text).toMatch(/both-party POI commitment/i);
  });
});

describe("docs-ownership-explicitness — Matches page", () => {
  const text = readDoc("Matches.tsx");

  it("retrieve-a-match section talks about opposite slot, not bare 'counterparty references'", () => {
    expect(text).toMatch(/opposite to the viewer/i);
    expect(text).toMatch(/buyer_org_id/);
    expect(text).toMatch(/seller_org_id/);
    expect(text).not.toMatch(/embedded\s+counterparty references/i);
  });

  it("lifecycle table flags single-side acknowledgement for intent_declared / counterparty_sighted", () => {
    expect(text).toMatch(/single-side acknowledgement/i);
    // Committed must be flagged as the BILATERAL milestone.
    expect(text).toMatch(/BOTH parties have signed Proof of Intent/i);
  });

  it("confirm-intent callout distinguishes acknowledgement from bilateral acceptance", () => {
    expect(text).toMatch(/single-side and is .*not.* the same as bilateral acceptance/i);
  });
});

describe("docs-ownership-explicitness — Webhooks page", () => {
  const text = readDoc("Webhooks.tsx");

  it("includes the perspective callout for counterparty_* fields", () => {
    expect(text).toMatch(/Perspective/);
    expect(text).toMatch(/subscribing org/i);
    expect(text).toMatch(/opposite/i);
    expect(text).toMatch(/counterparty_/);
  });

  it("explains that the same match emits one delivery per subscribed org", () => {
    expect(text).toMatch(/one delivery per subscribed org/i);
  });
});
