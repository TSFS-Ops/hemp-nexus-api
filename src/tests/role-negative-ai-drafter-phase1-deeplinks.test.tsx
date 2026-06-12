/**
 * role-negative-ai-drafter-phase1-deeplinks.test.tsx
 *
 * Source-pin coverage for AI Outreach Drafter Phase 1 containment:
 *  - EngagementOutreachDraftPanel is only mounted inside the admin engagement queue
 *  - useEngagementOutreachDraft is only consumed by EngagementOutreachDraftPanel
 *  - AdminPendingEngagementsPanel is only imported by the HQ page
 *  - Both AI drafter edge functions still gate on is_admin and return non-2xx on false
 *
 * No product code is modified.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(process.cwd(), "src");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

const ALL_SRC = walk(SRC);

function importersOf(symbol: string, modulePathFragment: string): string[] {
  const re = new RegExp(
    `import[\\s\\S]*?\\b${symbol}\\b[\\s\\S]*?from\\s+["'][^"']*${modulePathFragment}[^"']*["']`,
    "m",
  );
  return ALL_SRC.filter((f) => {
    // Ignore the module file itself
    if (f.includes(modulePathFragment.replace(/\//g, "/"))) return false;
    return re.test(readFileSync(f, "utf8"));
  });
}

describe("AI Outreach Drafter Phase 1 — containment (role-negative)", () => {
  it("EngagementOutreachDraftPanel is only imported by AdminPendingEngagementsPanel", () => {
    const importers = importersOf("EngagementOutreachDraftPanel", "EngagementOutreachDraftPanel");
    const productImporters = importers.filter((p) => !/[\\/]tests[\\/]|\.test\.|\.spec\./.test(p));
    expect(productImporters.length).toBe(1);
    expect(productImporters[0]).toMatch(/AdminPendingEngagementsPanel\.tsx$/);
  });

  it("useEngagementOutreachDraft is only consumed by EngagementOutreachDraftPanel", () => {
    const importers = importersOf("useEngagementOutreachDraft", "useEngagementOutreachDraft");
    const productImporters = importers.filter((p) => !/[\\/]tests[\\/]|\.test\.|\.spec\./.test(p));
    expect(productImporters.length).toBe(1);
    expect(productImporters[0]).toMatch(/EngagementOutreachDraftPanel\.tsx$/);
  });

  it("AdminPendingEngagementsPanel is only imported by the HQ page", () => {
    const importers = importersOf("AdminPendingEngagementsPanel", "AdminPendingEngagementsPanel");
    const productImporters = importers.filter((p) => !/[\\/]tests[\\/]|\.test\.|\.spec\./.test(p));
    expect(productImporters.length).toBe(1);
    expect(productImporters[0]).toMatch(/pages[\\/]HQ\.tsx$/);
  });

  it("generate-engagement-outreach-draft still has is_admin gate with 403 denial", () => {
    const src = readFileSync(
      join(process.cwd(), "supabase/functions/generate-engagement-outreach-draft/index.ts"),
      "utf8",
    );
    expect(src).toMatch(/rpc\(\s*["']is_admin["']/);
    expect(src).toMatch(/if\s*\(\s*!\s*isAdmin\s*\)/);
    expect(src).toMatch(/403/);
  });

  it("engagement-outreach-draft-decision still has is_admin gate with 403 denial", () => {
    const src = readFileSync(
      join(process.cwd(), "supabase/functions/engagement-outreach-draft-decision/index.ts"),
      "utf8",
    );
    expect(src).toMatch(/rpc\(\s*["']is_admin["']/);
    expect(src).toMatch(/if\s*\(\s*!\s*isAdmin\s*\)/);
    expect(src).toMatch(/403/);
  });

  it("both AI drafter edge functions also reject unauthenticated callers with 401", () => {
    for (const fn of [
      "generate-engagement-outreach-draft",
      "engagement-outreach-draft-decision",
    ]) {
      const src = readFileSync(join(process.cwd(), "supabase/functions", fn, "index.ts"), "utf8");
      expect(src).toMatch(/Unauthorised|Invalid token/);
      expect(src).toMatch(/401/);
    }
  });
});
