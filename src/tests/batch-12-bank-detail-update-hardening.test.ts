// Batch 12 hardening — registry_bank_detail_submissions UPDATE policy.
//
// Verifies the SSOT migration that:
//   - Removes the unsafe `WITH CHECK (true)` from the update policy.
//   - Adds a mirrored ownership/admin WITH CHECK.
//   - Installs the trg_rbd_guard_update trigger that blocks non-admin
//     callers from changing protected ownership/reference/audit fields
//     and locks the row once it leaves draft.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MIG_DIR = "supabase/migrations";
function allMigrationsText() {
  return readdirSync(MIG_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(join(MIG_DIR, f), "utf8"))
    .join("\n");
}

describe("batch 12 — registry_bank_detail_submissions update hardening", () => {
  const sql = allMigrationsText();

  it("drops the unsafe WITH CHECK (true) update policy", () => {
    expect(sql).toMatch(/DROP POLICY IF EXISTS "rbd update own or admin" ON public\.registry_bank_detail_submissions/);
  });

  it("recreates the policy with mirrored ownership/admin WITH CHECK", () => {
    // Locate the CREATE POLICY block for the update policy and ensure
    // WITH CHECK contains submitter_user_id = auth.uid() and the admin
    // roles, and does NOT use a bare `WITH CHECK (true)`.
    const matches = sql.match(
      /CREATE POLICY "rbd update own or admin"[\s\S]*?;/g,
    );
    expect(matches, "policy must exist").toBeTruthy();
    const block = matches![matches!.length - 1];
    expect(block).toMatch(/WITH CHECK\s*\([\s\S]*submitter_user_id\s*=\s*auth\.uid\(\)/);
    expect(block).toMatch(/platform_admin/);
    expect(block).toMatch(/compliance_owner/);
    expect(block).not.toMatch(/WITH CHECK\s*\(\s*true\s*\)/i);
  });

  it("installs the immutable-field + lifecycle-lock trigger", () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.registry_bank_detail_guard_update/);
    expect(sql).toMatch(/CREATE TRIGGER trg_rbd_guard_update/);
    for (const field of [
      "submitter_user_id",
      "claim_id",
      "authority_request_id",
      "company_reference",
      "company_name",
      "country_code",
      "currency_code",
      "created_at",
    ]) {
      expect(sql).toMatch(
        new RegExp(`${field} is immutable`),
      );
    }
    expect(sql).toMatch(/row is locked/);
    expect(sql).toMatch(/admin-only/);
  });
});
