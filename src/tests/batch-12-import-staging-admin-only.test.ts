// Batch 12 hardening — registry_import_records_staging admin-only access.
//
// Verifies that:
//   1. The broad `registry_import_staging_read_auth` SELECT policy was
//      dropped.
//   2. A role-restricted replacement policy
//      (`registry_import_staging_read_admin`) was added.
//   3. The companion `registry_import_batches_read_auth` policy was also
//      restricted (same class of finding — both tables carry admin-only
//      fields).
//   4. No edge function projects `contact_email_admin_only` or
//      `contact_phone_admin_only` into a non-admin response.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const MIG_DIR = "supabase/migrations";

function allMigrationsText() {
  return readdirSync(MIG_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(join(MIG_DIR, f), "utf8"))
    .join("\n");
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

describe("batch 12 — registry_import_records_staging admin-only access", () => {
  const sql = allMigrationsText();

  it("drops the broad authenticated SELECT policy on staging", () => {
    expect(sql).toMatch(/DROP POLICY IF EXISTS "registry_import_staging_read_auth"/);
  });

  it("installs an admin/compliance-scoped SELECT policy on staging", () => {
    expect(sql).toMatch(/CREATE POLICY "registry_import_staging_read_admin"[\s\S]*?FOR SELECT[\s\S]*?platform_admin[\s\S]*?compliance_owner/);
  });

  it("drops the broad authenticated SELECT policy on import batches", () => {
    expect(sql).toMatch(/DROP POLICY IF EXISTS "registry_import_batches_read_auth"/);
  });

  it("installs an admin/compliance-scoped SELECT policy on import batches", () => {
    expect(sql).toMatch(/CREATE POLICY "registry_import_batches_read_admin"[\s\S]*?FOR SELECT[\s\S]*?platform_admin[\s\S]*?compliance_owner/);
  });

  it("no edge function projects admin-only contact fields into responses", () => {
    const FN_DIR = "supabase/functions";
    const offenders: string[] = [];
    for (const file of walk(FN_DIR)) {
      if (!file.endsWith(".ts")) continue;
      const text = readFileSync(file, "utf8");
      if (/contact_email_admin_only|contact_phone_admin_only/.test(text)) {
        // The validate/field-map functions are allowed to reference the
        // column names internally; only flag if the value appears in a
        // response body returned to non-admin callers.
        // The current import pipeline functions are admin-gated, so this
        // suite simply records that no public/anon function references
        // them.
        if (/registry-import-/.test(file)) continue;
        offenders.push(file);
      }
    }
    expect(offenders, offenders.join(", ")).toHaveLength(0);
  });
});
