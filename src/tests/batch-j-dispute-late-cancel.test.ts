/**
 * Batch J — Dispute, late acceptance, supersession and initiator-cancel
 * source-pin regression suite.
 *
 * These tests pin the source of `supabase/functions/poi-engagements/index.ts`
 * (and the cross-cutting db migrations) so the Batch J contract cannot
 * silently regress:
 *
 *   F3 — `POST /poi-engagements/:id/cancel-by-initiator` route exists
 *        with: idempotency-key requirement, state guards (cancellable
 *        statuses + irreversible POI states), engagement_status set to
 *        `cancelled_by_initiator`, audit_logs row, optional
 *        admin_risk_items row keyed `engagement_refund_decision_required`,
 *        NO automatic refund.
 *
 *   F4 — `evaluateSupersessionGate` exists and is wired into both the
 *        `respond` (accept/decline) AND `dispute` routes. Constant
 *        `SUPERSEDED_ENGAGEMENT_STATUSES` carries the two terminal-by-
 *        supersession enum values.
 *
 *   F5 — `cancel-for-email-change` performs a typed
 *        `ENGAGEMENT_ALREADY_REPLACED` pre-check before relying on the
 *        DB unique-index backstop.
 *
 *   AUD-006 — initiator-cancellation writes `audit_logs` with action
 *             `engagement.cancelled_by_initiator`.
 *
 *   MATCH-002 — late-acceptance reconfirmation route is still wired and
 *               uses the `atomic_record_late_acceptance` RPC for the
 *               expired-but-eligible path.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

const ROOT = process.cwd();
const POI = readFileSync(
  path.join(ROOT, "supabase/functions/poi-engagements/index.ts"),
  "utf8",
);

describe("Batch J — poi-engagements source pin", () => {
  // ── F3 ────────────────────────────────────────────────────────────────
  describe("F3 initiator cancellation route", () => {
    it("mounts POST /cancel-by-initiator", () => {
      expect(POI).toMatch(
        /parts\[1\] === "cancel-by-initiator"/,
      );
    });

    it("requires Idempotency-Key", () => {
      const slice = POI.split('parts[1] === "cancel-by-initiator"')[1] ?? "";
      const route = slice.split('parts[1] === "cancel-for-email-change"')[0];
      expect(route).toMatch(/Idempotency-Key header is required/);
    });

    it("guards against non-cancellable statuses + irreversible POI states", () => {
      expect(POI).toMatch(/INITIATOR_CANCELLABLE_STATUSES/);
      expect(POI).toMatch(/IRREVERSIBLE_POI_STATES/);
      expect(POI).toMatch(/ENGAGEMENT_NOT_CANCELLABLE/);
      expect(POI).toMatch(/POI_STATE_IRREVERSIBLE/);
    });

    it("writes engagement_status = cancelled_by_initiator", () => {
      expect(POI).toMatch(/engagement_status: "cancelled_by_initiator"/);
    });

    it("writes an audit_logs row with engagement.cancelled_by_initiator action (AUD-006)", () => {
      expect(POI).toMatch(/action: "engagement\.cancelled_by_initiator"/);
    });

    it("never auto-refunds — instead files admin_risk_items refund_decision_required", () => {
      expect(POI).toMatch(/admin_risk_items/);
      expect(POI).toMatch(/engagement_refund_decision_required/);
      expect(POI).toMatch(/auto_refund_issued: false/);
    });

    it("verifies initiator org admin OR platform_admin", () => {
      const slice = POI.split('parts[1] === "cancel-by-initiator"')[1] ?? "";
      const route = slice.split('parts[1] === "cancel-for-email-change"')[0];
      expect(route).toMatch(/is_org_admin/);
      expect(route).toMatch(/isPlatformAdminCaller/);
    });
  });

  // ── F4 ────────────────────────────────────────────────────────────────
  describe("F4 supersession gate", () => {
    it("defines SUPERSEDED_ENGAGEMENT_STATUSES with both terminal values", () => {
      expect(POI).toMatch(/SUPERSEDED_ENGAGEMENT_STATUSES = new Set/);
      expect(POI).toMatch(/"cancelled_email_change"/);
      expect(POI).toMatch(/"cancelled_by_initiator"/);
    });

    it("exposes evaluateSupersessionGate helper returning ENGAGEMENT_SUPERSEDED", () => {
      expect(POI).toMatch(/function evaluateSupersessionGate/);
      expect(POI).toMatch(/"ENGAGEMENT_SUPERSEDED"/);
    });

    it("wires the gate into BOTH respond (accept/decline) and dispute routes", () => {
      // Count occurrences of the helper call site — must appear at least twice.
      const calls = POI.match(/evaluateSupersessionGate\(/g) ?? [];
      expect(calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ── F5 ────────────────────────────────────────────────────────────────
  describe("F5 duplicate-recreate guard", () => {
    it("pre-checks ENGAGEMENT_ALREADY_REPLACED before the DB unique-index backstop", () => {
      expect(POI).toMatch(/ENGAGEMENT_ALREADY_REPLACED/);
      // Must live INSIDE the cancel-for-email-change branch.
      const slice = POI.split('parts[1] === "cancel-for-email-change"')[1] ?? "";
      expect(slice).toMatch(/ENGAGEMENT_ALREADY_REPLACED/);
    });
  });

  // ── MATCH-002 retained ─────────────────────────────────────────────────
  describe("MATCH-002 late acceptance — still wired", () => {
    it("calls atomic_record_late_acceptance from the respond route", () => {
      expect(POI).toMatch(/atomic_record_late_acceptance/);
      expect(POI).toMatch(/late_acceptance_pending_initiator_reconfirmation/);
    });
  });
});

describe("Batch J — migration source pin", () => {
  const MIG_DIR = path.join(ROOT, "supabase/migrations");
  const files = readdirSync(MIG_DIR);
  const allMig = files
    .filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(path.join(MIG_DIR, f), "utf8"))
    .join("\n");

  it("adds cancelled_by_initiator to engagement_status enum", () => {
    expect(allMig).toMatch(/cancelled_by_initiator/);
  });

  it("adds superseded_by_engagement_id column", () => {
    expect(allMig).toMatch(/superseded_by_engagement_id/);
  });

  it("adds a partial unique index on (match_id, lower(counterparty_email)) for active rows", () => {
    expect(allMig).toMatch(/uniq_poi_engagements_active_match_email/);
  });
});
