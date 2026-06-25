/**
 * P-5 Batch 4 Stage 5 — desk (organisation / counterparty user) UI
 * contract tests.
 *
 * Static contract checks (no DOM render). We confirm:
 *  - The 5 shared desk components exist with the expected exports.
 *  - The 2 desk pages exist and default-export the expected component.
 *  - No desk file calls supabase.from('p5_batch4_*') or supabase.rpc directly.
 *  - No desk file imports the admin RPC wrapper (`p5b4Admin`) or the
 *    admin summary client (`p5b4SummaryClient`).
 *  - The Desk shell registers two /desk/p5-batch4 routes.
 *  - The org-user client is invoke-only and pins audience=org_user.
 *  - The edge function declares the org_user audience and the
 *    forbidden-fields list for that audience.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

const COMPONENTS = [
  "P5B4DeskStatusBadge",
  "P5B4DeskMilestoneProgress",
  "P5B4DeskBlockerNotice",
  "P5B4DeskEvidenceTask",
  "P5B4DeskNextAction",
];

const PAGES = ["Index", "CaseDetail"];

function read(rel: string): string {
  const p = join(ROOT, rel);
  if (!existsSync(p)) throw new Error(`missing: ${rel}`);
  return readFileSync(p, "utf8");
}

describe("P-5 Batch 4 Stage 5 — desk UI contract", () => {
  it.each(COMPONENTS)("ships shared desk component %s", (name) => {
    const text = read(`src/pages/desk/p5-batch4/components/${name}.tsx`);
    expect(text).toMatch(new RegExp(`export\\s+(default\\s+)?function\\s+${name}\\b`));
  });

  it.each(PAGES)("ships desk page %s", (name) => {
    const text = read(`src/pages/desk/p5-batch4/${name}.tsx`);
    expect(text).toMatch(/export\s+default\s+function\s+P5Batch4Desk/);
  });

  it("no desk file calls supabase.from('p5_batch4_*') directly", () => {
    for (const rel of [
      ...COMPONENTS.map((c) => `components/${c}`),
      ...PAGES,
    ]) {
      const text = read(`src/pages/desk/p5-batch4/${rel}.tsx`);
      expect(text).not.toMatch(/supabase\s*\.\s*from\(\s*['"]p5_batch4_/);
    }
  });

  it("no desk file calls supabase.rpc directly", () => {
    for (const rel of [
      ...COMPONENTS.map((c) => `components/${c}`),
      ...PAGES,
    ]) {
      const text = read(`src/pages/desk/p5-batch4/${rel}.tsx`);
      expect(text).not.toMatch(/supabase\s*\.\s*rpc\(/);
    }
  });

  it("no desk file imports the admin RPC wrapper or admin summary client", () => {
    for (const rel of [
      ...COMPONENTS.map((c) => `components/${c}`),
      ...PAGES,
    ]) {
      const text = read(`src/pages/desk/p5-batch4/${rel}.tsx`);
      expect(text).not.toMatch(/\bp5b4Admin\b/);
      expect(text).not.toMatch(/\bp5b4SummaryClient\b/);
      expect(text).not.toMatch(/@\/lib\/p5-batch4\/summary-client/);
    }
  });

  it("desk shell registers /desk/p5-batch4 routes", () => {
    const text = read("src/pages/Desk.tsx");
    const routes = text.match(/<Route\s+path=["']p5-batch4[^"']*["'][\s\S]*?\/>/g) ?? [];
    expect(routes.length).toBeGreaterThanOrEqual(2);
  });

  it("org-user client is invoke-only and pins audience=org_user", () => {
    const text = read("src/lib/p5-batch4/org-user-client.ts");
    expect(text).toMatch(/functions\.invoke/);
    expect(text).not.toMatch(/supabase\s*\.\s*from\(/);
    expect(text).toMatch(/audience['"]?\s*,\s*['"]org_user['"]/);
    expect(text).not.toMatch(/audience['"]?\s*,\s*['"]admin['"]/);
    expect(text).not.toMatch(/audience['"]?\s*,\s*['"]funder['"]/);
  });

  it("edge function declares the org_user audience and forbidden fields", () => {
    const text = read("supabase/functions/p5-batch4-execution-summary/index.ts");
    expect(text).toMatch(/audience === "org_user"/);
    expect(text).toMatch(/ORG_USER_SAFE_FIELDS/);
    for (const f of [
      "owner_user_id",
      "funder_status",
      "finality_status",
      "provider_dependency_status",
      "internal_note",
    ]) {
      expect(text).toMatch(new RegExp(`FORBIDDEN_ORG_USER_FIELDS[\\s\\S]{0,400}${f}`));
    }
  });

  it("desk evidence component uses p5b4OrgUser.submitEvidence (the only allowed mutation)", () => {
    const text = read("src/pages/desk/p5-batch4/components/P5B4DeskEvidenceTask.tsx");
    expect(text).toMatch(/p5b4OrgUser\.submitEvidence/);
    expect(text).not.toMatch(/p5b4Admin\./);
  });

  it("desk components never render raw evidence file references / hashes", () => {
    for (const rel of [
      ...COMPONENTS.map((c) => `components/${c}`),
      ...PAGES,
    ]) {
      const text = read(`src/pages/desk/p5-batch4/${rel}.tsx`);
      // Allowed: variables named `hash` inside the upload helper for the
      // RPC call. Forbidden: JSX rendering of `file_reference` or `file_hash`.
      expect(text).not.toMatch(/\{[^}]*\bfile_reference\b[^}]*\}/);
      expect(text).not.toMatch(/\{[^}]*\bfile_hash\b[^}]*\}/);
    }
  });
});
