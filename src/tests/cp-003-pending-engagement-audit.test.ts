/**
 * CP-003 — Pending Engagement audit (signed canonical names)
 * ──────────────────────────────────────────────────────────────────────────
 *
 * Source: Izenzo_Client_Only_Decision_Form_SIGNED.pdf, CP-003.
 *
 * Pins (additive, do not remove existing canonical or sibling events):
 *   1. Edge function `poi-engagements/index.ts` emits BOTH signed CP-003
 *      canonical audit actions:
 *        • pending_engagement.identity_incomplete_email_only_detected
 *        • pending_engagement.outreach_blocked_missing_counterparty_name
 *   2. The legacy sibling `pending_engagement.outreach_blocked_missing_name`
 *      is preserved (no rename, no removal — additive only).
 *   3. CP-002 emitters are not touched.
 *   4. CP-006 / CP-009 / CP-012 / CP-015 canonical audit names are not
 *      renamed or removed.
 *   5. The CP-003 emit path stays a non-fatal audit insert that throws an
 *      ApiException — no POI mint, no WaD trigger, no credit burn, no
 *      payment event reachable from this branch.
 *
 * Static source-of-truth pin so a future refactor cannot silently drop
 * either signed CP-003 canonical name.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const EDGE = readFileSync(
  resolve(__dirname, "../../supabase/functions/poi-engagements/index.ts"),
  "utf8",
);

describe("CP-003 — signed canonical audit actions", () => {
  it("emits pending_engagement.identity_incomplete_email_only_detected", () => {
    expect(EDGE).toMatch(
      /action:\s*"pending_engagement\.identity_incomplete_email_only_detected"/,
    );
  });

  it("emits pending_engagement.outreach_blocked_missing_counterparty_name", () => {
    expect(EDGE).toMatch(
      /action:\s*"pending_engagement\.outreach_blocked_missing_counterparty_name"/,
    );
  });

  it("emits the signed outreach-blocked name from at least two surfaces (preview + send)", () => {
    const re = /pending_engagement\.outreach_blocked_missing_counterparty_name/g;
    const hits = EDGE.match(re) ?? [];
    expect(hits.length).toBeGreaterThanOrEqual(2);
  });
});

describe("CP-003 — legacy sibling preserved (additive only)", () => {
  it("keeps pending_engagement.outreach_blocked_missing_name", () => {
    expect(EDGE).toMatch(
      /action:\s*"pending_engagement\.outreach_blocked_missing_name"/,
    );
  });
});

describe("CP-003 — block path stays a hard refusal (no POI/WaD/credit/payment side effects)", () => {
  it("the signed outreach-block emit is followed by a throw ApiException, not a send call", () => {
    const idx = EDGE.indexOf(
      "pending_engagement.outreach_blocked_missing_counterparty_name",
    );
    expect(idx).toBeGreaterThan(0);
    const after = EDGE.slice(idx, idx + 4000);
    expect(after).toMatch(/throw new ApiException/);
    // Must not invoke a send / payment / token-burn / WaD seal in this branch.
    expect(after).not.toMatch(/sendOutreachEmail|atomic_token_burn|atomic_generate_poi|seal_wad|paystack/i);
  });

  it("metadata pins the signed reason fields for the outreach-block emit", () => {
    const idx = EDGE.indexOf(
      "pending_engagement.outreach_blocked_missing_counterparty_name",
    );
    const slice = EDGE.slice(Math.max(0, idx - 1500), idx + 200);
    expect(slice).toMatch(/blocked_reason:\s*"missing_counterparty_name"/);
    expect(slice).toMatch(/attempted_action:\s*"send_outreach"/);
    expect(slice).toMatch(/counterparty_email_present:\s*true/);
    expect(slice).toMatch(/counterparty_name_present:\s*false/);
  });
});

describe("CP-003 — does not regress CP-002 / CP-006 / CP-009 / CP-012 / CP-015 canonical names", () => {
  const SIBLINGS = [
    "pending_engagement.no_contact_details_detected",
    "pending_engagement.outreach_blocked_missing_email",
    "pending_engagement.contact_details_added",
    "pending_engagement.auto_bound_registered_org",
    "pending_engagement.binding_review_required",
    "pending_engagement.outreach_blocked_binding_review_required",
    "pending_engagement.late_acceptance_reconfirmed_by_initiator",
    "pending_engagement.late_acceptance_declined_by_initiator",
    "pending_engagement.email_change_blocked_requires_new_engagement",
    "engagement.email_change_refused",
  ];
  for (const action of SIBLINGS) {
    it(`preserves ${action}`, () => {
      const re = new RegExp(`action:\\s*"${action.replace(/\./g, "\\.")}"`);
      expect(EDGE).toMatch(re);
    });
  }
});
