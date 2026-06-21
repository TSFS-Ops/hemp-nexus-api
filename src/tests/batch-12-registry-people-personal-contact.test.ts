// Batch 12 hardening — personal contact protection on registry_company_people.
//
// These tests are SSOT-level invariant checks (no live DB). They validate
// that:
//   1. The migration that creates the protection trigger exists.
//   2. The migration drops the unsafe public read policy.
//   3. The public-safe RPC `registry_company_people_public_safe` exists
//      and projects only non-sensitive columns.
//   4. The public profile edge function does not select personal contact
//      fields.
//   5. Column-level SELECT on personal_* fields is revoked from anon/auth.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MIG_DIR = "supabase/migrations";
function allMigrationsText(): string {
  return readdirSync(MIG_DIR)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(join(MIG_DIR, f), "utf8"))
    .join("\n");
}

describe("batch 12 — registry_company_people personal contact protection", () => {
  const sql = allMigrationsText();

  it("drops the unsafe public read policy", () => {
    expect(sql).toMatch(/DROP POLICY IF EXISTS "public reads public people"/);
  });

  it("installs the public_visible guard trigger", () => {
    expect(sql).toMatch(/registry_company_people_guard_public_visible/);
    expect(sql).toMatch(/cannot set public_visible = true while personal contact fields are populated/);
  });

  it("revokes column-level SELECT on personal contact fields from anon and authenticated", () => {
    expect(sql).toMatch(/REVOKE SELECT \(personal_email, personal_phone, personal_address\)[\s\S]*?FROM anon/);
    expect(sql).toMatch(/REVOKE SELECT \(personal_email, personal_phone, personal_address\)[\s\S]*?FROM authenticated/);
  });

  it("exposes a public-safe RPC whose RETURNS TABLE excludes personal contact fields", () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.registry_company_people_public_safe/);
    // Inspect the RETURNS TABLE projection only — the WHERE clause is
    // allowed to reference personal_* columns because it enforces them
    // to be NULL.
    const fnBlock = sql.split(/CREATE OR REPLACE FUNCTION public\.registry_company_people_public_safe/)[1] ?? "";
    const returnsBlock = fnBlock.split(/LANGUAGE sql/i)[0] ?? "";
    expect(returnsBlock).not.toMatch(/personal_email/);
    expect(returnsBlock).not.toMatch(/personal_phone/);
    expect(returnsBlock).not.toMatch(/personal_address/);
  });

  it("public profile edge function never selects personal_* columns", () => {
    const fn = readFileSync(
      "supabase/functions/registry-company-profile/index.ts",
      "utf8",
    );
    expect(fn).not.toMatch(/personal_email/);
    expect(fn).not.toMatch(/personal_phone/);
    expect(fn).not.toMatch(/personal_address/);
  });
});
