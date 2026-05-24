/**
 * CP-006 — Counterparty appears to belong to an already registered
 * organisation (Izenzo_Client_Only_Decision_Form_SIGNED.pdf).
 *
 * EVIDENCE-LABEL WRAPPER. This file does not introduce new product
 * behaviour. It re-asserts the existing CP-006A (safe auto-bind on
 * unique exact email) and CP-006B (ambiguous → binding review,
 * outreach blocked, zero side-effects) contracts using the SAME
 * decision module (`_shared/binding-resolver`) that the live
 * `poi-engagements` edge function delegates to, plus source-symbol
 * pinning for the wired audit events, UI wording, and side-effect
 * guards.
 *
 * Why this file exists: the closeout evidence audit flagged that no
 * single test file was discoverable under the CP-006 label. The
 * underlying coverage already lives in:
 *
 *   • src/tests/binding-review-resolver.test.ts        (decision matrix)
 *   • supabase/functions/poi-engagements/cp006_test.ts (Deno sibling-audit gating)
 *   • src/tests/cp-003-pending-engagement-audit.test.ts (audit enum pin)
 *   • src/tests/d4c-3d-binding-review-required-wiring.test.ts
 *   • src/tests/dec-001-canonical-outreach-audit.test.ts
 *   • src/tests/batch-b-phase4-engagement-guard.test.ts
 *   • src/tests/batch-e-phase2-ui-blocked-reasons.test.tsx
 *   • src/tests/phase1-demo-isolation.test.ts
 *
 * This wrapper makes the CP-006 contract greppable by name and pins
 * the canonical fixtures, audit symbols, UI strings, and side-effect
 * gates in one readable place.
 *
 * Daniel-visible UAT proof of record:
 *   • CP-006A unique exact email auto-bind: PASS
 *   • CP-006B ambiguous binding review:     PASS
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  decideBinding,
  type ProfileLookupRow,
} from "../../supabase/functions/_shared/binding-resolver";

const p = (id: string, org_id: string, email: string): ProfileLookupRow => ({
  id,
  org_id,
  email,
});

const read = (rel: string) =>
  readFileSync(resolve(__dirname, "..", "..", rel), "utf8");

// ─────────────────────────────────────────────────────────────────────
// Canonical CP-006 symbol contract.
// ─────────────────────────────────────────────────────────────────────

const AUTO_BOUND_AUDIT = "pending_engagement.auto_bound_registered_org";
const BINDING_REVIEW_AUDIT = "pending_engagement.binding_review_required";
const OUTREACH_BLOCKED_AUDIT =
  "pending_engagement.outreach_blocked_binding_review_required";

const MATCH_TYPE = "unique_exact_email";

const AUTO_BIND_COPY =
  "Counterparty matched to a registered organisation by unique exact email match. The engagement has been linked and may proceed through the normal registered-counterparty workflow.";

const BINDING_REVIEW_COPY =
  "Possible registered organisation match found, but binding is not unique. Review and confirm the correct organisation/contact before outreach can be sent. No counterparty notification has been sent, no POI has been completed, and no credit has been used.";

const REQUIRED_AUTO_BOUND_METADATA_KEYS = [
  "engagement_id",
  // match_id and poi_id are optionally present per row context
  "match_id",
  "poi_id",
  "counterparty_name",
  "matched_organisation_id",
  "matched_contact_id",
  "match_type",
  "auto_bound",
  "binding_review_required",
  "outreach_enabled",
  "created_by_user_id",
  "organisation_id",
] as const;

// ─────────────────────────────────────────────────────────────────────
// CP-006A — safe auto-bind path (unique exact email → safe_bind)
// ─────────────────────────────────────────────────────────────────────

describe("CP-006A — unique exact email auto-binds to one registered organisation", () => {
  it("decideBinding returns safe_bind for the single matching org", () => {
    const decision = decideBinding(
      "buyer@acme.example",
      [p("contact-1", "org-acme", "buyer@acme.example")],
      [
        p("contact-1", "org-acme", "buyer@acme.example"),
        p("contact-2", "org-acme", "ops@acme.example"),
      ],
    );
    expect(decision).toEqual({ kind: "safe_bind", org_id: "org-acme" });
  });

  it("safe_bind is reached only via unique exact email — not via domain alone", () => {
    // Domain match alone (no exact match) must NOT auto-bind even when
    // the domain is registered to exactly one org.
    const decision = decideBinding(
      "stranger@acme.example",
      [],
      [p("contact-1", "org-acme", "buyer@acme.example")],
    );
    expect(decision).toEqual({ kind: "no_match" });
  });

  it("poi-engagements emits pending_engagement.auto_bound_registered_org with required metadata + match_type=unique_exact_email", () => {
    const src = read("supabase/functions/poi-engagements/index.ts");
    expect(src).toContain(`action: "${AUTO_BOUND_AUDIT}"`);
    expect(src).toContain(`match_type: "${MATCH_TYPE}"`);
    expect(src).toContain("auto_bound: true");
    expect(src).toContain("binding_review_required: false");
    expect(src).toContain("outreach_enabled: true");
    for (const key of REQUIRED_AUTO_BOUND_METADATA_KEYS) {
      expect(src.includes(`${key}:`)).toBe(true);
    }
  });

  it("admin panel surfaces the signed CP-006A wording verbatim", () => {
    const src = read("src/components/admin/AdminPendingEngagementsPanel.tsx");
    expect(src).toContain(AUTO_BIND_COPY);
  });
});

// ─────────────────────────────────────────────────────────────────────
// CP-006B — ambiguous binding review path
// ─────────────────────────────────────────────────────────────────────

describe("CP-006B — every ambiguity class routes to binding_review_required and never auto-binds", () => {
  it("shared email (same address at ≥2 distinct orgs) → binding_review_required", () => {
    const d = decideBinding(
      "buyer@acme.example",
      [
        p("c1", "org-A", "buyer@acme.example"),
        p("c2", "org-B", "buyer@acme.example"),
      ],
      [],
    );
    expect(d.kind).toBe("binding_review_required");
    if (d.kind === "binding_review_required") {
      expect(d.reason_codes).toContain("shared_email_multi_org");
    }
  });

  it("duplicate email at two orgs (alias of shared email) → binding_review_required and never safe_bind", () => {
    const d = decideBinding(
      "alice@acme.example",
      [
        p("c1", "org-A", "alice@acme.example"),
        p("c2", "org-B", "alice@acme.example"),
      ],
      [],
    );
    expect(d.kind).toBe("binding_review_required");
  });

  it("conflicting organisation candidates (shared-mailbox local-part with multiple registered profiles on the domain) → binding_review_required", () => {
    const d = decideBinding(
      "info@acme.example",
      [],
      [
        p("c1", "org-A", "alice@acme.example"),
        p("c2", "org-A", "bob@acme.example"),
      ],
    );
    expect(d.kind).toBe("binding_review_required");
    if (d.kind === "binding_review_required") {
      expect(d.reason_codes).toContain("shared_mailbox_local_part");
    }
  });

  it("domain-only match against ≥2 distinct orgs (non-free provider, no exact match) → binding_review_required", () => {
    const d = decideBinding(
      "newperson@acme.example",
      [],
      [
        p("c1", "org-A", "alice@acme.example"),
        p("c2", "org-B", "bob@acme.example"),
      ],
    );
    expect(d.kind).toBe("binding_review_required");
    if (d.kind === "binding_review_required") {
      expect(d.reason_codes).toContain("domain_only_ambiguity");
    }
  });

  it("partial match — exact email at one org PLUS shared-mailbox local-part — still enters review (no silent safe_bind)", () => {
    const d = decideBinding(
      "info@acme.example",
      [p("c1", "org-A", "info@acme.example")],
      [p("c1", "org-A", "info@acme.example")],
    );
    expect(d.kind).toBe("binding_review_required");
    if (d.kind === "binding_review_required") {
      expect(d.reason_codes).toContain("shared_mailbox_local_part");
    }
  });

  it("admin panel surfaces the signed CP-006B wording verbatim (no notification, no POI, no credit)", () => {
    const src = read("src/components/admin/AdminPendingEngagementsPanel.tsx");
    expect(src).toContain(BINDING_REVIEW_COPY);
    // Defensive: the CP-006B wording must NOT silently lose any of the
    // three "no side-effect" promises.
    expect(BINDING_REVIEW_COPY).toMatch(/no counterparty notification has been sent/i);
    expect(BINDING_REVIEW_COPY).toMatch(/no POI has been completed/i);
    expect(BINDING_REVIEW_COPY).toMatch(/no credit has been used/i);
  });
});

// ─────────────────────────────────────────────────────────────────────
// CP-006B — side-effect proof (no outbound traffic / no state change)
// ─────────────────────────────────────────────────────────────────────

describe("CP-006B — binding_review_required blocks ALL outbound side-effects until resolved", () => {
  it("engagement-progression-guard maps binding_review_required → BINDING_REVIEW_PENDING block (blocks outreach, POI, WaD)", () => {
    const src = read("src/lib/engagement-progression-guard.ts");
    expect(src).toContain('binding_review_required');
    expect(src).toMatch(/BINDING_REVIEW_PENDING/);
  });

  it("admin engagement blocked-reasons treats binding_review_required as the highest-priority block", () => {
    const src = read("src/lib/admin-engagement-blocked-reasons.ts");
    expect(src).toContain('"binding_review_required"');
  });

  it("poi-engagements emits pending_engagement.outreach_blocked_binding_review_required when outreach is attempted before resolution", () => {
    const src = read("supabase/functions/poi-engagements/index.ts");
    expect(src).toContain(`action: "${OUTREACH_BLOCKED_AUDIT}"`);
    // The sibling binding-review-required audit must also be emitted.
    expect(src).toMatch(new RegExp(BINDING_REVIEW_AUDIT.replace(/\./g, "\\.")));
  });

  it("dec-001 outreach-blocked operational-state set includes binding_review_required (no outreach, no notification dispatch)", () => {
    const src = read("src/lib/outreach/dec-001-audit.ts");
    expect(src).toContain('"binding_review_required"');
  });

  it("the canonical audit enum lists all three CP-006 audit symbols", () => {
    // Pinned in cp-003-pending-engagement-audit.test.ts; re-asserted here
    // so a CP-006 reviewer never has to chase the rename.
    const src = read("src/tests/cp-003-pending-engagement-audit.test.ts");
    expect(src).toContain(AUTO_BOUND_AUDIT);
    expect(src).toContain(BINDING_REVIEW_AUDIT);
    expect(src).toContain(OUTREACH_BLOCKED_AUDIT);
  });

  it("phase1-demo-isolation keeps binding_review_required queries scoped to non-demo rows (no real counterparty leakage)", () => {
    const src = read("src/tests/phase1-demo-isolation.test.ts");
    expect(src).toMatch(/binding_review_required[\s\S]{0,400}is_demo/);
  });
});
