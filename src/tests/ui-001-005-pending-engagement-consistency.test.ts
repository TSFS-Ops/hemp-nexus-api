/**
 * UI-001 / UI-005 — Pending Engagement cross-surface consistency.
 *
 * Source-pin tests (read source files; do not boot the React tree). They
 * verify that the agreed contract is in place and survives refactors:
 *
 *   1. `isPendingEngagementActive` exists, exports correct terminal set
 *      (accepted / declined / expired / cancelled_email_change).
 *   2. DealWizard focal banner has a `softRoutePending` branch with the
 *      "Pending Engagement — outreach in progress" copy.
 *   3. StateProgressionCard derives `softRoutePending`, uses it to disable
 *      the mint CTA, shows the "No credits will be burned" note, and
 *      renders the dedicated dialog block.
 *   4. MatchHeroCard accepts `engagementStatus` and renders the
 *      Pending Engagement badge under the soft-route condition.
 *   5. `handleSettle` in use-match-details.ts has the ENGAGEMENT_PENDING
 *      soft-route branch (no `setMatch`, no token-balance invalidation,
 *      truthful info toast).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ENGAGEMENT_TERMINAL_STATES,
  isEngagementTerminal,
  isPendingEngagementActive,
} from "@/lib/engagement-state";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("isPendingEngagementActive — SSOT helper", () => {
  it("treats every canonical terminal status as inactive", () => {
    for (const s of ENGAGEMENT_TERMINAL_STATES) {
      expect(isEngagementTerminal(s)).toBe(true);
      expect(isPendingEngagementActive({ engagement_status: s })).toBe(false);
    }
  });

  it("includes cancelled_email_change in the terminal set", () => {
    expect(ENGAGEMENT_TERMINAL_STATES).toContain("cancelled_email_change");
    expect(
      isPendingEngagementActive({ engagement_status: "cancelled_email_change" }),
    ).toBe(false);
  });

  it("returns true for non-terminal statuses (notification_sent, contacted, pending, late_acceptance_pending_initiator_reconfirmation)", () => {
    for (const s of [
      "notification_sent",
      "contacted",
      "pending",
      "late_acceptance_pending_initiator_reconfirmation",
    ]) {
      expect(isPendingEngagementActive({ engagement_status: s })).toBe(true);
    }
  });

  it("returns false when the engagement row is missing or has no status", () => {
    expect(isPendingEngagementActive(null)).toBe(false);
    expect(isPendingEngagementActive(undefined)).toBe(false);
    expect(isPendingEngagementActive({ engagement_status: null })).toBe(false);
    expect(isPendingEngagementActive({ engagement_status: "" })).toBe(false);
  });
});

describe("DealWizard — focal banner soft-route branch", () => {
  const src = read("src/components/match/wizard/DealWizard.tsx");

  it("imports isPendingEngagementActive from the SSOT", () => {
    expect(src).toMatch(/from "@\/lib\/engagement-state"/);
    expect(src).toContain("isPendingEngagementActive");
  });

  it("derives softRoutePending from currentState === 'discovery' AND active engagement", () => {
    expect(src).toMatch(
      /softRoutePending\s*=\s*\n?\s*currentState === "discovery"/,
    );
  });

  it("shows the Waiting on counterparty / Pending Engagement focal banner", () => {
    expect(src).toContain("Pending Engagement — outreach in progress");
    expect(src).toContain("Waiting on counterparty");
    expect(src).toMatch(/tone:\s*"locked"/);
  });

  it("includes softRoutePending in the focal-banner useMemo dep array", () => {
    expect(src).toMatch(/softRoutePending,\s*engagementStatus,/);
  });
});

describe("StateProgressionCard — mint CTA + dialog", () => {
  const src = read("src/components/match/StateProgressionCard.tsx");

  it("derives softRoutePending from the SSOT helper", () => {
    expect(src).toContain("isPendingEngagementActive");
    expect(src).toMatch(/softRoutePending\s*=\s*\n?\s*currentState === "discovery"/);
  });

  it("disables the Generate POI CTA when softRoutePending is true", () => {
    // The `disabled={...}` expression must include `softRoutePending`.
    expect(src).toMatch(/disabled=\{[\s\S]*?softRoutePending[\s\S]*?\}/);
  });

  it("renders the soft-route CTA label and the no-credits note", () => {
    expect(src).toContain("Pending Engagement — outreach in progress");
    expect(src).toContain("No credits will be burned — pending engagement in progress");
    expect(src).toContain('data-soft-route-pending-note="true"');
  });

  it("hides the 'After confirmation: balance - 1' preview row in the dialog when soft-route pending", () => {
    // The new branch lives BEFORE the legacy preview block. We assert the
    // dedicated dialog block exists and is keyed on softRoutePending.
    expect(src).toContain('data-soft-route-pending-dialog="true"');
    expect(src).toMatch(/softRoutePending\s*\?\s*\(\s*\n?\s*<div/);
  });
});

describe("MatchHeroCard — Pending Engagement badge", () => {
  const src = read("src/components/match/MatchHeroCard.tsx");

  it("accepts an optional engagementStatus prop", () => {
    expect(src).toMatch(/engagementStatus\?:\s*string\s*\|\s*null/);
  });

  it("derives softRoutePending using the SSOT", () => {
    expect(src).toContain("isPendingEngagementActive");
    expect(src).toMatch(/softRoutePending\s*=\s*\n?\s*currentState === "discovery"/);
  });

  it("renders the Pending Engagement badge under the soft-route condition", () => {
    expect(src).toMatch(/softRoutePending\s*&&\s*\(\s*\n?\s*<Badge/);
    expect(src).toContain("Pending Engagement");
    expect(src).toContain('data-soft-route-pending="true"');
  });
});

describe("MatchDetails — wires engagementStatus into MatchHeroCard", () => {
  const src = read("src/pages/MatchDetails.tsx");

  it("passes engagementStatus down to MatchHeroCard", () => {
    expect(src).toMatch(
      /<MatchHeroCard\s+match=\{match\}\s+isSettled=\{isSettled\}\s+engagementStatus=\{engagementStatus\}/,
    );
  });
});

describe("use-match-details.handleSettle — ENGAGEMENT_PENDING soft-route branch", () => {
  const src = read("src/hooks/use-match-details.ts");

  it("detects the ENGAGEMENT_PENDING response in the settle path", () => {
    // settleSoftRouted derivation lives inside handleSettle's try block.
    expect(src).toContain("settleSoftRouted");
    expect(src).toMatch(/code\?:\s*string\s*\}\)\.code === "ENGAGEMENT_PENDING"/);
  });

  it("does NOT invalidate token-balance when the settle response is soft-routed", () => {
    // The soft-route branch returns BEFORE the invalidate calls. We verify
    // by snapshotting the branch body and asserting no invalidation tokens.
    const start = src.indexOf("if (settleSoftRouted) {");
    expect(start).toBeGreaterThan(-1);
    const end = src.indexOf("\n      }\n", start);
    const branch = src.slice(start, end);
    expect(branch).not.toMatch(/queryKey:\s*\["token-balance/);
    expect(branch).not.toMatch(/setMatch\(updated\)/);
    expect(branch).toContain("toast.info");
  });

  it("emits the truthful 'no credits were used' info toast", () => {
    expect(src).toContain("Pending engagement created.");
    expect(src).toContain("no credits were used");
  });

  it("keeps the 'credits may have been deducted' invalid-response error reachable only AFTER the soft-route check", () => {
    const softIdx = src.indexOf("if (settleSoftRouted) {");
    const errIdx = src.indexOf(
      "Server returned an invalid response. Contact support@izenzo.co.za if credits were deducted.",
    );
    expect(softIdx).toBeGreaterThan(-1);
    expect(errIdx).toBeGreaterThan(softIdx);
  });
});
