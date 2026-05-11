/**
 * Batch D — Production binding-review resolver (pure decision logic).
 *
 * Verifies `decideBinding` from
 * `supabase/functions/_shared/binding-resolver.ts` against the safety
 * contract approved 2026-05:
 *
 *   • unique exact email → safe_bind to that one org
 *   • duplicate exact email across ≥2 orgs → binding_review_required
 *     ("shared_email_multi_org")
 *   • shared-mailbox local-part with ≥1 registered candidate →
 *     binding_review_required ("shared_mailbox_local_part")
 *   • shared-mailbox local-part with NO registered candidate → no_match
 *   • domain registered to ≥2 distinct orgs (non-free domain, no exact
 *     match) → binding_review_required ("domain_only_ambiguity")
 *   • free-provider domain with no exact match → no_match (never review)
 *   • exact match on a free-provider domain at exactly one org →
 *     safe_bind (the per-mailbox uniqueness rule still applies)
 *
 * The DB-aware wrapper is intentionally NOT exercised here — the
 * Deno-side contract test in `supabase/functions/poi-engagements/`
 * pins that path. This file pins the safety-critical decision
 * surface that drives every reason-code.
 */

import { describe, it, expect } from "vitest";
import {
  decideBinding,
  isSharedMailboxLocalPart,
  isFreeProviderDomain,
  splitEmail,
  type ProfileLookupRow,
} from "../../supabase/functions/_shared/binding-resolver";

const p = (id: string, org_id: string, email: string): ProfileLookupRow => ({
  id,
  org_id,
  email,
});

describe("binding-resolver — splitEmail / helpers", () => {
  it("isSharedMailboxLocalPart matches the approved list", () => {
    for (const lp of [
      "info",
      "sales",
      "admin",
      "accounts",
      "contact",
      "hello",
      "support",
      "ops",
      "finance",
    ]) {
      expect(isSharedMailboxLocalPart(lp)).toBe(true);
    }
    expect(isSharedMailboxLocalPart("alice")).toBe(false);
    expect(isSharedMailboxLocalPart("INFO")).toBe(true);
  });

  it("isFreeProviderDomain matches the approved list", () => {
    expect(isFreeProviderDomain("gmail.com")).toBe(true);
    expect(isFreeProviderDomain("Outlook.com")).toBe(true);
    expect(isFreeProviderDomain("acme.co.za")).toBe(false);
  });

  it("splitEmail rejects malformed input", () => {
    expect(splitEmail("not-an-email")).toBeNull();
    expect(splitEmail("a@b@c")).toBeNull();
    expect(splitEmail("alice@acme.com")).toEqual({
      localPart: "alice",
      domain: "acme.com",
    });
  });
});

describe("binding-resolver — decideBinding", () => {
  it("unique exact email → safe_bind", () => {
    const decision = decideBinding(
      "alice@acme.com",
      [p("p1", "org-A", "alice@acme.com")],
      [p("p1", "org-A", "alice@acme.com"), p("p2", "org-A", "bob@acme.com")],
    );
    expect(decision).toEqual({ kind: "safe_bind", org_id: "org-A" });
  });

  it("duplicate exact email across two orgs → binding_review_required (shared_email_multi_org)", () => {
    const decision = decideBinding(
      "alice@acme.com",
      [
        p("p1", "org-A", "alice@acme.com"),
        p("p2", "org-B", "alice@acme.com"),
      ],
      [],
    );
    expect(decision.kind).toBe("binding_review_required");
    if (decision.kind === "binding_review_required") {
      expect(decision.reason_codes).toContain("shared_email_multi_org");
      expect(decision.candidates.length).toBe(2);
    }
  });

  it("shared-mailbox local-part WITH registered candidates → binding_review_required", () => {
    const decision = decideBinding(
      "info@acme.com",
      [], // no exact match
      [
        p("p1", "org-A", "alice@acme.com"),
        p("p2", "org-A", "bob@acme.com"),
      ],
    );
    expect(decision.kind).toBe("binding_review_required");
    if (decision.kind === "binding_review_required") {
      expect(decision.reason_codes).toContain("shared_mailbox_local_part");
    }
  });

  it("shared-mailbox local-part with EXACT match at one org still enters review (not safe_bind)", () => {
    const decision = decideBinding(
      "info@acme.com",
      [p("p1", "org-A", "info@acme.com")],
      [p("p1", "org-A", "info@acme.com")],
    );
    expect(decision.kind).toBe("binding_review_required");
    if (decision.kind === "binding_review_required") {
      expect(decision.reason_codes).toContain("shared_mailbox_local_part");
    }
  });

  it("shared-mailbox local-part with NO registered candidates → no_match (no review)", () => {
    const decision = decideBinding(
      "info@unknown-co.example",
      [],
      [],
    );
    expect(decision).toEqual({ kind: "no_match" });
  });

  it("domain registered to ≥2 orgs, no exact match, non-free domain → binding_review_required (domain_only_ambiguity)", () => {
    const decision = decideBinding(
      "newperson@acme.com",
      [],
      [
        p("p1", "org-A", "alice@acme.com"),
        p("p2", "org-B", "bob@acme.com"),
      ],
    );
    expect(decision.kind).toBe("binding_review_required");
    if (decision.kind === "binding_review_required") {
      expect(decision.reason_codes).toContain("domain_only_ambiguity");
    }
  });

  it("domain registered to only ONE org, no exact match → no_match (no auto-bind via domain alone)", () => {
    const decision = decideBinding(
      "newperson@acme.com",
      [],
      [p("p1", "org-A", "alice@acme.com")],
    );
    expect(decision).toEqual({ kind: "no_match" });
  });

  it("free-provider domain with no exact match → no_match (never review on domain alone)", () => {
    const decision = decideBinding(
      "newperson@gmail.com",
      [],
      [
        p("p1", "org-A", "alice@gmail.com"),
        p("p2", "org-B", "bob@gmail.com"),
        p("p3", "org-C", "carol@gmail.com"),
      ],
    );
    expect(decision).toEqual({ kind: "no_match" });
  });

  it("free-provider domain with unique exact match → safe_bind", () => {
    const decision = decideBinding(
      "alice@gmail.com",
      [p("p1", "org-A", "alice@gmail.com")],
      [],
    );
    expect(decision).toEqual({ kind: "safe_bind", org_id: "org-A" });
  });

  it("free-provider domain with duplicate exact match across 2 orgs → still binding_review_required", () => {
    const decision = decideBinding(
      "alice@gmail.com",
      [
        p("p1", "org-A", "alice@gmail.com"),
        p("p2", "org-B", "alice@gmail.com"),
      ],
      [],
    );
    expect(decision.kind).toBe("binding_review_required");
    if (decision.kind === "binding_review_required") {
      expect(decision.reason_codes).toContain("shared_email_multi_org");
    }
  });

  it("conflicting name/email ambiguity does not auto-bind (multi-org exact)", () => {
    // Two profiles share the email but have different orgs — must not
    // pick one silently regardless of which appears first.
    const decisionAB = decideBinding(
      "shared@acme.com",
      [
        p("pA", "org-A", "shared@acme.com"),
        p("pB", "org-B", "shared@acme.com"),
      ],
      [],
    );
    const decisionBA = decideBinding(
      "shared@acme.com",
      [
        p("pB", "org-B", "shared@acme.com"),
        p("pA", "org-A", "shared@acme.com"),
      ],
      [],
    );
    expect(decisionAB.kind).toBe("binding_review_required");
    expect(decisionBA.kind).toBe("binding_review_required");
  });

  it("ignores rows with null/empty org_id defensively", () => {
    const decision = decideBinding(
      "alice@acme.com",
      [
        p("p1", "org-A", "alice@acme.com"),
        // Simulate a row that slipped past the .not('org_id','is',null) filter
        { id: "p2", org_id: "" as unknown as string, email: "alice@acme.com" },
      ],
      [],
    );
    expect(decision).toEqual({ kind: "safe_bind", org_id: "org-A" });
  });
});
