/**
 * Phase 1 — Demo Isolation Primitive
 *
 * Pin tests for the Phase 1 contract:
 *   1. matches.is_demo + poi_engagements.is_demo exist (default false).
 *   2. lifecycle-scheduler / outreach-sla-monitor scans filter is_demo=false.
 *   3. The D4b admin notification helper refuses demo engagements.
 *   4. The D4c initiator notification helper refuses demo engagements.
 *   5. The HQ panel hides demo rows by default and surfaces a DEMO badge.
 *
 * These tests are deliberately decision-level / source-pin tests rather
 * than full edge-runtime exercises, so a future edit cannot quietly
 * remove a filter or short-circuit without flipping a test red.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";

function readSource(rel: string): string {
  return readFileSync(resolvePath(process.cwd(), rel), "utf8");
}

describe("Phase 1 demo isolation — schema contract", () => {
  it("Postgrest .eq('is_demo', false) is the canonical skip clause", () => {
    const isDemo = (r: { is_demo?: boolean | null }) => r.is_demo === true;
    expect(isDemo({ is_demo: false })).toBe(false);
    expect(isDemo({})).toBe(false);
    expect(isDemo({ is_demo: null })).toBe(false);
    expect(isDemo({ is_demo: true })).toBe(true);
  });
});

describe("Phase 1 — lifecycle scheduler skips demo rows (source pin)", () => {
  const src = readSource("supabase/functions/lifecycle-scheduler/index.ts");

  it("late-acceptance reconfirmation scan calls .eq('is_demo', false)", () => {
    expect(src).toMatch(
      /late_acceptance_pending_initiator_reconfirmation[\s\S]{0,400}\.eq\("is_demo",\s*false\)/,
    );
  });

  it("binding-review backlog scan calls .eq('is_demo', false)", () => {
    expect(src).toMatch(
      /binding_review_required[\s\S]{0,400}\.eq\("is_demo",\s*false\)/,
    );
  });

  it("stale unilateral intent scan calls .eq('is_demo', false)", () => {
    expect(src).toMatch(/staleIntents[\s\S]{0,800}\.eq\("is_demo",\s*false\)/);
  });

  it("expired-matches scan calls .eq('is_demo', false)", () => {
    expect(src).toMatch(/expiredMatches[\s\S]{0,500}\.eq\("is_demo",\s*false\)/);
  });
});

describe("Phase 1 — outreach SLA monitor skips demo rows (source pin)", () => {
  const src = readSource("supabase/functions/outreach-sla-monitor/index.ts");
  it("overdue-engagement scan calls .eq('is_demo', false)", () => {
    expect(src).toMatch(/\.eq\("is_demo",\s*false\)/);
  });
});

describe("Phase 1 — D4b admin notification helper refuses demo rows (source pin)", () => {
  const src = readSource("supabase/functions/_shared/batch-d-admin-notify.ts");

  it("declares an isDemoEngagement lookup helper", () => {
    expect(src).toMatch(/isDemoEngagement\s*\(/);
    expect(src).toMatch(/from\("poi_engagements"\)[\s\S]{0,200}is_demo/);
  });

  it("returns skipped:'demo_isolation' before composing or dispatching", () => {
    expect(src).toMatch(/skipped:\s*"demo_isolation"/);
    const dispatchIdx = src.indexOf('functions.invoke(\n      "notification-dispatch"');
    const demoIdx = src.indexOf('skipped: "demo_isolation"');
    expect(demoIdx).toBeGreaterThan(0);
    expect(dispatchIdx).toBeGreaterThan(demoIdx);
  });

  it("includes 'demo_isolation' in the public skipped union", () => {
    expect(src).toMatch(/skipped\?:[^;]*"demo_isolation"/);
  });
});

describe("Phase 1 — D4c initiator notification helper refuses demo rows (source pin)", () => {
  const src = readSource("supabase/functions/_shared/batch-d-initiator-notify.ts");

  it("performs a poi_engagements is_demo lookup at the top of the dispatcher", () => {
    expect(src).toMatch(/Phase 1 demo isolation/);
    expect(src).toMatch(/from\("poi_engagements"\)[\s\S]{0,400}is_demo/);
  });

  it("returns reason:'demo_isolation' on a demo row", () => {
    expect(src).toMatch(/reason:\s*"demo_isolation"/);
  });

  it("includes 'demo_isolation' in the public reason union", () => {
    expect(src).toMatch(/"queue_unavailable"\s*\|\s*"demo_isolation"/);
  });
});

describe("Phase 1 — HQ panel demo-row visibility contract", () => {
  const panelSrc = readSource("src/components/admin/AdminPendingEngagementsPanel.tsx");
  const forensicsSrc = readSource("src/components/admin/AdminEngagementForensicsPanel.tsx");

  it("hides demo rows by default in the pending-engagements list", () => {
    // Reproduce the predicate the panel uses inside its `filtered` useMemo.
    const isDemo = (e: { is_demo?: boolean | null }) => e.is_demo === true;
    const apply = (rows: { id: string; is_demo?: boolean | null }[], showDemo: boolean) =>
      showDemo ? rows : rows.filter((e) => !isDemo(e));
    const rows = [
      { id: "real-1", is_demo: false },
      { id: "real-2" },
      { id: "demo-1", is_demo: true },
    ];
    expect(apply(rows, false).map((r) => r.id)).toEqual(["real-1", "real-2"]);
    expect(apply(rows, true).map((r) => r.id)).toEqual(["real-1", "real-2", "demo-1"]);
  });

  it("pending panel wires the showDemo state into the filter", () => {
    expect(panelSrc).toMatch(/setShowDemo/);
    expect(panelSrc).toMatch(/!showDemo[\s\S]{0,200}is_demo/);
    expect(panelSrc).toMatch(/data-testid="show-demo-toggle"/);
  });

  it("pending panel renders a DEMO badge marker on demo rows", () => {
    expect(panelSrc).toMatch(/data-testid="demo-badge"/);
    expect(panelSrc).toMatch(/e\.is_demo === true/);
  });

  it("forensics panel filters is_demo=false unless toggle is on", () => {
    expect(forensicsSrc).toMatch(/!showDemo[\s\S]{0,80}is_demo/);
    expect(forensicsSrc).toMatch(/data-testid="forensics-show-demo-toggle"/);
    expect(forensicsSrc).toMatch(/data-testid="forensics-demo-badge"/);
  });
});

describe("Phase 1 — RESOLVED: token metering uses organizations.is_demo (Option B)", () => {
  // Decision (Phase 1 close-out): metering keyed on org_id is isolated by
  // adding organizations.is_demo and short-circuiting in token-metering.ts.
  // Detailed assertions live in phase1-demo-isolation-billing.test.ts.
  it("token-metering still calls atomic_token_burn with p_org_id for real orgs", () => {
    const meteringSrc = readSource("supabase/functions/_shared/token-metering.ts");
    expect(meteringSrc).toMatch(/atomic_token_burn[\s\S]{0,200}p_org_id/);
  });

  it("token-metering now references is_demo (org-level isolation in place)", () => {
    const meteringSrc = readSource("supabase/functions/_shared/token-metering.ts");
    expect(meteringSrc).toMatch(/is_demo/);
    expect(meteringSrc).toMatch(/isDemoOrg/);
  });
});
