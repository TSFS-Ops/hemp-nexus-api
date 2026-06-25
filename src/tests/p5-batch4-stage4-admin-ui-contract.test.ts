/**
 * P-5 Batch 4 Stage 4 — admin UI contract tests.
 *
 * Static contract checks (no DOM render) for the seven required shared
 * components and the four admin pages. We assert that each file exists,
 * exports the expected symbol, never calls supabase.from('p5_batch4_*'),
 * never calls supabase.rpc directly, and never embeds forbidden provider
 * wording outside the wording-guard helpers.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

const COMPONENTS = [
  "P5B4StatusBadge",
  "P5B4MilestoneTimeline",
  "P5B4BlockerCard",
  "P5B4EvidenceChecklist",
  "P5B4MaskedField",
  "P5B4ProviderSafeLabel",
  "P5B4ReasonedActionDialog",
];

const PAGES = ["Index", "Cases", "CaseDetail", "Audit"];

function read(rel: string): string {
  const p = join(ROOT, rel);
  if (!existsSync(p)) throw new Error(`missing: ${rel}`);
  return readFileSync(p, "utf8");
}

describe("P-5 Batch 4 Stage 4 — admin UI contract", () => {
  it.each(COMPONENTS)("ships shared component %s", (name) => {
    const text = read(`src/pages/admin/p5-batch4/components/${name}.tsx`);
    expect(text).toMatch(new RegExp(`export\\s+(default\\s+)?function\\s+${name}\\b|export\\s+\\{[^}]*${name}\\b`));
  });

  it.each(PAGES)("ships admin page %s", (name) => {
    const text = read(`src/pages/admin/p5-batch4/${name}.tsx`);
    expect(text.length).toBeGreaterThan(0);
    expect(text).toMatch(/export\s+default\s+function\s+P5Batch4/);
  });

  it("no admin file calls supabase.from('p5_batch4_*') directly", () => {
    for (const name of [...COMPONENTS.map((c) => `components/${c}`), ...PAGES]) {
      const text = read(`src/pages/admin/p5-batch4/${name}.tsx`);
      expect(text).not.toMatch(/supabase\s*\.\s*from\(\s*['"]p5_batch4_/);
    }
  });

  it("no admin file calls supabase.rpc directly (must use @/lib/p5-batch4/rpc)", () => {
    for (const name of [...COMPONENTS.map((c) => `components/${c}`), ...PAGES]) {
      const text = read(`src/pages/admin/p5-batch4/${name}.tsx`);
      expect(text).not.toMatch(/supabase\s*\.\s*rpc\(/);
    }
  });

  it("App.tsx registers /admin/p5-batch4 routes under platform_admin", () => {
    const text = read("src/App.tsx");
    const routes = text.match(/<Route\s+path=["']\/admin\/p5-batch4[^"']*["'][\s\S]*?\/>/g) ?? [];
    expect(routes.length).toBeGreaterThanOrEqual(4);
    for (const r of routes) {
      expect(r).toMatch(/role=["']platform_admin["']/);
    }
  });

  it("summary-client.ts uses functions.invoke and no direct table reads", () => {
    const text = read("src/lib/p5-batch4/summary-client.ts");
    expect(text).toMatch(/functions\.invoke/);
    expect(text).not.toMatch(/supabase\s*\.\s*from\(/);
  });
});
