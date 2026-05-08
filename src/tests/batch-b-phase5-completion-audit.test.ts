/**
 * Batch B Phase 5 — Completion audit pin tests.
 *
 * Closes out Phase 5 by proving that the deferred surfaces (email templates,
 * notification-dispatch, document/evidence generators, admin panel,
 * API messages) are either migrated to the wording engine or evidenced
 * as safe by the audit batch.
 *
 * Each test cites the audit decision in its assertion so any future
 * change that violates the contract fails here, not in production.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { execSync } from "child_process";

const TEMPLATE_DIR = "supabase/functions/_shared/transactional-email-templates";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("Batch B Phase 5 — completion audit", () => {
  describe("Email templates", () => {
    it("acceptance-receipt is fired only by atomic_engagement_transition (proven by migration)", () => {
      // Evidence: supabase/migrations/20260424151001_*.sql line 153 inserts
      // acceptance_receipts; supabase/migrations/20260508*.sql (Phase 2/3
      // RPCs) do NOT insert into acceptance_receipts. Late acceptance and
      // reconfirm therefore never enqueue this email.
      const phase23 = execSync(
        "ls supabase/migrations/20260508*.sql | xargs grep -l acceptance_receipts || true",
        { encoding: "utf8" },
      ).trim();
      expect(phase23, "Phase 2/3 RPCs must not write acceptance_receipts").toBe("");
    });

    it("state-transition email labels match-states only — never engagement states", () => {
      const text = read(`${TEMPLATE_DIR}/state-transition.tsx`);
      // Must not key off any engagement_status value.
      expect(text).not.toMatch(/late_acceptance|accepted_after_expiry|renewed_from/);
    });

    it("outreach-intent-to-trade is pre-acceptance copy and never claims mutual/binding/sealed engagement", () => {
      const text = read(`${TEMPLATE_DIR}/outreach-intent-to-trade.tsx`);
      // Allowed: "verified counterparty" (describes initiator's KYC),
      // "sealed Proof-of-Intent records" (describes platform infra).
      // Forbidden in the engagement-state sense:
      expect(text).not.toMatch(/\bmutually accepted\b/i);
      expect(text).not.toMatch(/\bboth parties have (accepted|confirmed)\b/i);
      expect(text).not.toMatch(/auto[-\s_]?decline/i);
    });

    it("no engagement-related template references the new Batch B states (deferred until Phase 6 wires them)", () => {
      // Proof: until Phase 6 ships the scheduler/window-expiry events, no
      // template renders late_acceptance / reconfirmation / renewed copy.
      // If a future template introduces any of these strings without going
      // through engagement-wording.ts, this guard will catch it.
      const files = execSync(`ls ${TEMPLATE_DIR}/*.tsx`, { encoding: "utf8" })
        .trim()
        .split("\n");
      for (const f of files) {
        const text = read(f);
        if (/late.acceptance|accepted_after_expiry|renewed_engagement|reconfirmation_window/i.test(text)) {
          // Allowed only if the template imports the wording engine.
          expect(text, `${f} mentions a new Batch B state — must import engagement-wording.ts`).toMatch(
            /engagement-wording/,
          );
        }
      }
    });
  });

  describe("notification-dispatch", () => {
    it("is a generic dispatcher — does not contain engagement-state copy of its own", () => {
      const text = read("supabase/functions/notification-dispatch/index.ts");
      expect(text).not.toMatch(/late.acceptance|accepted_after_expiry|renewed_engagement/i);
      expect(text).not.toMatch(/auto[-\s_]?decline/i);
    });

    it("lifecycle-scheduler does not currently emit late-acceptance / reconfirmation / renewed notifications", () => {
      // Phase 6 work has not shipped. Lifecycle scheduler emits only pod
      // breach + stale-unilateral notifications today. This test pins that
      // surface so a future addition is forced through the wording engine.
      const text = read("supabase/functions/lifecycle-scheduler/index.ts");
      expect(text).not.toMatch(/late.acceptance|accepted_after_expiry|renewed_engagement|reconfirmation_window/i);
    });
  });

  describe("Document / evidence generators", () => {
    it("deal-certificate refuses to render unless match.state === 'completed'", () => {
      const text = read("supabase/functions/deal-certificate/index.ts");
      expect(text).toMatch(/matchState\s*!==\s*["']completed["']/);
    });
    it("draft-poi does not render any engagement-state copy", () => {
      const text = read("supabase/functions/draft-poi/index.ts");
      expect(text).not.toMatch(/\b(?:mutual|binding|sealed|settled|executed|finalised)\b/i);
      expect(text).not.toMatch(/late.acceptance|accepted_after_expiry|renewed_engagement/i);
    });
    it("evidence-pack only renders 'Settled' alongside the persisted settled_at field", () => {
      const text = read("supabase/functions/evidence-pack/index.ts");
      // Must not invent settled wording — every settled-row must come from match.settled_at.
      expect(text).toMatch(/settled_at/);
      expect(text).not.toMatch(/late.acceptance|accepted_after_expiry|renewed_engagement/i);
    });
  });

  describe("Admin surfaces", () => {
    const adminText = read("src/components/admin/AdminPendingEngagementsPanel.tsx");
    it("recognises late_acceptance_pending_initiator_reconfirmation in the type union", () => {
      expect(adminText).toMatch(/"late_acceptance_pending_initiator_reconfirmation"/);
    });
    it("renders late acceptance with explicit late-acceptance wording — never as 'Accepted'", () => {
      expect(adminText).toMatch(
        /late_acceptance_pending_initiator_reconfirmation:\s*\n?\s*"Late acceptance/,
      );
    });
    it("never describes late acceptance or window-elapse as auto-decline", () => {
      expect(adminText).not.toMatch(/auto[-\s_]?decline/i);
    });
  });

  describe("API-facing messages (poi-engagements edge function)", () => {
    const apiText = read("supabase/functions/poi-engagements/index.ts");
    it("late-acceptance API messages are legally safe", () => {
      // Stable error codes are fine; messages must not say accepted-mutually,
      // binding, or auto-decline.
      expect(apiText).not.toMatch(/auto[-\s_]?decline/i);
      expect(apiText).not.toMatch(/mutually accepted|both parties have (accepted|confirmed)/i);
    });
    it("late-acceptance handler returns 'Late acceptance' / 'awaiting initiator reconfirmation' wording", () => {
      expect(apiText).toMatch(/Late acceptance has already been recorded/);
      expect(apiText).toMatch(/awaiting initiator reconfirmation/);
    });
  });

  describe("Wording guard scan paths cover the audited surfaces", () => {
    const guard = read("scripts/check-engagement-wording.mjs");
    it("includes admin components (under src/components)", () => {
      expect(guard).toMatch(/src\/components/);
    });
    it("includes both email-template directories", () => {
      expect(guard).toMatch(/_shared\/email-templates/);
      expect(guard).toMatch(/_shared\/transactional-email-templates/);
    });
    it("includes supabase/functions (notification-dispatch, document generators, edge fns)", () => {
      expect(guard).toMatch(/supabase\/functions/);
    });
  });
});
