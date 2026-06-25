/**
 * P-5 Batch 4 Stage 6 — funder UI contract tests.
 *
 * Static contract checks (no DOM render). We confirm:
 *  - Funder components and pages exist with the expected exports.
 *  - No funder file calls supabase.from('p5_batch4_*') or supabase.rpc directly.
 *  - No funder file imports admin / org-user clients or wrappers.
 *  - Funder routes are registered in src/App.tsx under RequireAuth.
 *  - The funder client is invoke-only and pins audience=funder.
 *  - The Stage 3 edge function applies funder release-only / funder-org
 *    scoping and forbids admin-only fields in the funder projection.
 *  - The only mutation wrapper used by funder UI is p5b4Funder.recordDecision.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

const COMPONENTS = [
  "P5B4FunderShell",
  "P5B4FunderStatusBadge",
  "P5B4FunderUnavailable",
  "P5B4FunderDecisionForm",
];
const PAGES = ["Index", "CaseDetail"];

function read(rel: string): string {
  const p = join(ROOT, rel);
  if (!existsSync(p)) throw new Error(`missing: ${rel}`);
  return readFileSync(p, "utf8");
}

describe("P-5 Batch 4 Stage 6 — funder UI contract", () => {
  it.each(COMPONENTS)("ships funder component %s", (name) => {
    const text = read(`src/pages/funder/p5-batch4/components/${name}.tsx`);
    expect(text).toMatch(new RegExp(`export\\s+(default\\s+)?function\\s+${name}\\b`));
  });

  it.each(PAGES)("ships funder page %s", (name) => {
    const text = read(`src/pages/funder/p5-batch4/${name}.tsx`);
    expect(text).toMatch(/export\s+default\s+function\s+P5Batch4Funder/);
  });

  it("no funder file calls supabase.from('p5_batch4_*') directly", () => {
    for (const rel of [
      ...COMPONENTS.map((c) => `components/${c}`),
      ...PAGES,
    ]) {
      const text = read(`src/pages/funder/p5-batch4/${rel}.tsx`);
      expect(text).not.toMatch(/supabase\s*\.\s*from\(\s*['"]p5_batch4_/);
    }
  });

  it("no funder file calls supabase.rpc directly", () => {
    for (const rel of [
      ...COMPONENTS.map((c) => `components/${c}`),
      ...PAGES,
    ]) {
      const text = read(`src/pages/funder/p5-batch4/${rel}.tsx`);
      expect(text).not.toMatch(/supabase\s*\.\s*rpc\(/);
    }
  });

  it("no funder file imports admin or org-user clients/wrappers", () => {
    for (const rel of [
      ...COMPONENTS.map((c) => `components/${c}`),
      ...PAGES,
    ]) {
      const text = read(`src/pages/funder/p5-batch4/${rel}.tsx`);
      expect(text).not.toMatch(/@\/lib\/p5-batch4\/summary-client/);
      expect(text).not.toMatch(/@\/lib\/p5-batch4\/org-user-client/);
      if (/@\/lib\/p5-batch4\/rpc/.test(text)) {
        expect(text).not.toMatch(/\bp5b4Admin\b/);
        expect(text).not.toMatch(/\bp5b4OrgUser\b/);
      }
    }
  });

  it("only allowed mutation wrapper in funder UI is p5b4Funder.recordDecision", () => {
    const text = read("src/pages/funder/p5-batch4/components/P5B4FunderDecisionForm.tsx");
    expect(text).toMatch(/p5b4Funder\.recordDecision\(/);
    expect(text).not.toMatch(/p5b4Admin\./);
    expect(text).not.toMatch(/p5b4OrgUser\./);
  });

  it("funder client is invoke-only and pins audience=funder", () => {
    const text = read("src/lib/p5-batch4/funder-client.ts");
    expect(text).toMatch(/functions\.invoke/);
    expect(text).not.toMatch(/supabase\s*\.\s*from\(/);
    expect(text).not.toMatch(/supabase\s*\.\s*rpc\(/);
    expect(text).toMatch(/audience["']?\s*,\s*["']funder["']/);
    expect(text).not.toMatch(/["'](admin|org_user)["']/);
  });

  it("funder routes are registered in src/App.tsx under RequireAuth", () => {
    const text = read("src/App.tsx");
    const routes = text.match(
      /<Route\s+path=["']\/funder\/p5-batch4[^"']*["'][\s\S]*?\/>/g,
    ) ?? [];
    expect(routes.length).toBeGreaterThanOrEqual(2);
    for (const m of routes) {
      expect(m).toMatch(/<RequireAuth[\s>]/);
    }
  });

  it("edge function enforces release-only + funder-org scoping for audience=funder", () => {
    const text = read("supabase/functions/p5-batch4-execution-summary/index.ts");
    expect(text).toMatch(/p5b4_current_funder_org/);
    expect(text).toMatch(/p5_batch4_funder_releases/);
    expect(text).toMatch(/neq\(['"]status['"],\s*['"]revoked['"]\)/);
    expect(text).toMatch(/access_expires_at/);
    expect(text).toMatch(/case_not_released_to_funder/);
  });

  it("FORBIDDEN_FUNDER_FIELDS strips admin-only fields from funder projection", () => {
    const text = read("supabase/functions/p5-batch4-execution-summary/index.ts");
    for (const f of [
      "owner_user_id",
      "created_by",
      "linked_company_id",
      "linked_transaction_id",
      "memory_summary_id",
      "finality_status",
      "provider_dependency_status",
    ]) {
      expect(
        new RegExp(`FORBIDDEN_FUNDER_FIELDS[\\s\\S]{0,400}${f}`).test(text),
        `FORBIDDEN_FUNDER_FIELDS missing ${f}`,
      ).toBe(true);
    }
  });
});
