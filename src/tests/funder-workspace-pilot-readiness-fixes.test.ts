/**
 * Institutional Funder Evidence Workspace — Pilot readiness fixes
 * (post-Batch 6 forensic audit)
 *
 * Static guards covering the two fixes applied after the audit:
 * 1. The funder-evidence-packs Storage bucket is created reproducibly
 *    via migration (not only referenced by policy), so a fresh
 *    deployment has a working bucket for pack generation/download.
 * 2. Platform admins can only SELECT izenzo_shared (shared-comment)
 *    rows from funder_workspace_notes, never funder_internal rows.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MIG_DIR = "supabase/migrations";

function allMigrations(): string {
    return readdirSync(MIG_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .map((f) => readFileSync(join(MIG_DIR, f), "utf8"))
      .join("\n");
}

describe("Pilot readiness fix 1 — funder-evidence-packs bucket is created by migration", () => {
    const sql = allMigrations();

           it("inserts the bucket row idempotently", () => {
                 expect(sql).toMatch(
                         /INSERT INTO storage\.buckets \(id, name, public\)\s+VALUES \('funder-evidence-packs', 'funder-evidence-packs', false\)/,
                       );
                 expect(sql).toMatch(/ON CONFLICT \(id\) DO NOTHING/);
           });

           it("bucket creation appears in a migration, not only in storage policy text", () => {
                 // Regression guard: previously only CREATE POLICY statements referenced
                  // this bucket id; nothing ever inserted it into storage.buckets.
                  const bucketInsertCount = (
                          sql.match(/INSERT INTO storage\.buckets[^;]*funder-evidence-packs/g) ?? []
                        ).length;
                 expect(bucketInsertCount).toBeGreaterThanOrEqual(1);
           });
});

describe("Pilot readiness fix 2 — admin cannot read funder-internal notes", () => {
    const sql = allMigrations();

           it("fw_note_admin_select is scoped to izenzo_shared visibility only", () => {
                 const idx = sql.lastIndexOf('CREATE POLICY "fw_note_admin_select"');
                 expect(idx, "fw_note_admin_select policy present").toBeGreaterThan(-1);
                 const block = sql.slice(idx, idx + 400);
                 expect(block).toMatch(
                         /USING \(public\.p5b3_is_platform_admin\(\) AND visibility = 'izenzo_shared'\)/,
                       );
           });

           it("the fixed policy definition is the last one applied (overrides the original Batch 5 grant)", () => {
                 const originalIdx = sql.indexOf('CREATE POLICY "fw_note_admin_select"');
                 const fixedIdx = sql.lastIndexOf('CREATE POLICY "fw_note_admin_select"');
                 expect(fixedIdx).toBeGreaterThan(originalIdx);
           });

           it("funder-internal notes remain visible only to the owning funder organisation", () => {
                 expect(sql).toMatch(
                         /"fw_note_funder_select"[\s\S]{0,200}funder_organisation_id = public\.fw_current_funder_org_v1\(\)/,
                       );
           });
});
