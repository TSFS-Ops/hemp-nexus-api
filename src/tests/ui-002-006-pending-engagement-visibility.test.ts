/**
 * UI-002 / UI-006 — Pending Engagement visibility across admin scope and
 * browser refresh.
 *
 * Source-pin tests. They verify the agreed contract:
 *
 *   1. AdminPendingEngagementsPanel renames `fetchKnownCounts` →
 *      `fetchOffScopeCounts` and counts `counterparty_type != 'unknown'
 *      OR counterparty_type IS NULL`.
 *   2. Off-scope banner appears whenever `scope === 'unknown'` and
 *      off-scope total > 0, with a "Switch to All" action that flips
 *      scope to "all".
 *   3. Inline empty-state hint renders when the filtered table is empty
 *      but off-scope rows exist.
 *   4. PendingEngagementSection accepts `isLoading` and `softRouteHint`
 *      props and renders a loading stub instead of returning null.
 *   5. use-match-details.ts invalidates `["engagement-status-gate",
 *      matchId]` after both legacy `handleSettle` and `handleStateAction`
 *      soft-route 202 responses.
 *   6. MatchDetails plumbs `isLoading` from the engagement-status query
 *      down to PendingEngagementSection.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("UI-002 — Admin Pending Engagements off-scope visibility", () => {
  const admin = read("src/components/admin/AdminPendingEngagementsPanel.tsx");

  it("uses fetchOffScopeCounts (renamed from fetchKnownCounts)", () => {
    expect(admin).toContain("fetchOffScopeCounts");
    expect(admin).not.toMatch(/\bfetchKnownCounts\b/);
  });

  it("counts every row where counterparty_type != 'unknown' OR is null", () => {
    expect(admin).toMatch(
      /counterparty_type\.neq\.unknown,counterparty_type\.is\.null/,
    );
    // Must not silently filter to known-only any more.
    expect(admin).not.toMatch(/\.eq\(\s*"counterparty_type"\s*,\s*"known"\s*\)/);
  });

  it("renders the off-scope banner gated on scope='unknown' and off-scope total > 0", () => {
    expect(admin).toContain('data-testid="off-scope-banner"');
    expect(admin).toMatch(
      /scope === "unknown" && offScopeTotalCount > 0/,
    );
  });

  it("provides a one-click Switch to All action", () => {
    expect(admin).toContain('data-testid="off-scope-view-all"');
    expect(admin).toMatch(/onClick=\{\(\) => setScope\("all"\)\}/);
  });

  it("renders an inline empty-state hint when the table is empty but off-scope rows exist", () => {
    expect(admin).toContain('data-testid="off-scope-empty-hint"');
    expect(admin).toMatch(/exist in other scopes/);
  });
});

describe("UI-006 — PendingEngagementSection loading + defensive stub", () => {
  const section = read("src/components/match/PendingEngagementSection.tsx");

  it("accepts isLoading and softRouteHint props", () => {
    expect(section).toMatch(/isLoading\?:\s*boolean/);
    expect(section).toMatch(/softRouteHint\?:\s*boolean/);
  });

  it("renders a loading/defensive stub instead of returning null", () => {
    expect(section).toContain('data-testid="pending-engagement-loading"');
    expect(section).toMatch(
      /if \(!engagement && \(isLoading \|\| softRouteHint\)\)/,
    );
    expect(section).toMatch(/Pending Engagement status is loading/);
  });
});

describe("UI-006 — Soft-route invalidates the engagement-status-gate query", () => {
  const hook = read("src/hooks/use-match-details.ts");

  it("invalidates [\"engagement-status-gate\", matchId] in legacy handleSettle soft-route", () => {
    // Both branches must invalidate the engagement-status-gate query.
    const matches = hook.match(
      /queryKey:\s*\["engagement-status-gate",\s*match\.id\]/g,
    );
    expect(matches).not.toBeNull();
    expect((matches ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("invalidates the engagement query in the generate-poi soft-route branch", () => {
    // Find the generate-poi soft-route block and confirm an
    // invalidateQueries call sits inside it.
    const idx = hook.indexOf("softRouted && actionPath === \"generate-poi\"");
    expect(idx).toBeGreaterThan(-1);
    const slice = hook.slice(idx, idx + 1200);
    expect(slice).toMatch(
      /invalidateQueries\(\{\s*queryKey:\s*\["engagement-status-gate"/,
    );
  });
});

describe("UI-006 — MatchDetails plumbs isLoading to PendingEngagementSection", () => {
  const page = read("src/pages/MatchDetails.tsx");

  it("destructures isLoading from the engagement-status useQuery", () => {
    expect(page).toMatch(
      /isLoading:\s*engagementLoading\s*\}\s*=\s*useQuery/,
    );
  });

  it("passes isLoading into PendingEngagementSection", () => {
    expect(page).toMatch(/isLoading=\{engagementLoading\}/);
  });
});
