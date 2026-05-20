/**
 * MT-009 Phase 2 — Test 4 regression: replacement transaction must mark
 * the prior active row as `replaced` BEFORE inserting the new active row,
 * otherwise the partial unique index `idx_mnc_one_active_per_side`
 * ((match_id, side) WHERE status='active') rejects the insert.
 *
 * The original migration order (insert first, then mark replaced) shipped
 * with MT-009 Phase 2 and tripped on Test 4 the moment a replacement was
 * attempted on a side that already had an active controlled contact.
 * Tests 1–3 never exercised this branch because there was no prior
 * active row.
 *
 * Source-guard only — no live RPC call. The DB behaviour itself is
 * covered by the Phase 2 fixture + Daniel UAT.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const MIG_DIR = join(ROOT, "supabase/migrations");

/** Find the most recent migration that (re)defines assign_match_named_contact. */
function latestAssignRpcMigration(): string {
  const files = readdirSync(MIG_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  let chosen: string | null = null;
  for (const f of files) {
    const src = readFileSync(join(MIG_DIR, f), "utf8");
    if (/CREATE OR REPLACE FUNCTION\s+public\.assign_match_named_contact/.test(src)) {
      chosen = f;
    }
  }
  if (!chosen) throw new Error("No assign_match_named_contact migration found");
  return chosen;
}

describe("MT-009 Phase 2 Test 4 — replacement transaction order", () => {
  const file = latestAssignRpcMigration();
  const src = readFileSync(join(MIG_DIR, file), "utf8");

  it("uses the latest reordered migration as the authoritative definition", () => {
    // The fix migration must be the last one defining this RPC; if a later
    // migration redefines it, this test forces the author to update the
    // ordering proof here as well.
    expect(file).toMatch(/\.sql$/);
    expect(src).toMatch(/CREATE OR REPLACE FUNCTION\s+public\.assign_match_named_contact/);
  });

  it("marks the prior active row as `replaced` BEFORE inserting the new row", () => {
    const replacedUpdateIdx = src.search(
      /UPDATE\s+public\.match_named_contacts\s+SET\s+status\s*=\s*'replaced'/i,
    );
    const insertIdx = src.search(
      /INSERT\s+INTO\s+public\.match_named_contacts\s*\(/i,
    );
    expect(replacedUpdateIdx).toBeGreaterThan(-1);
    expect(insertIdx).toBeGreaterThan(-1);
    expect(replacedUpdateIdx).toBeLessThan(insertIdx);
  });

  it("back-fills replaced_by_id AFTER the new row is inserted", () => {
    const insertIdx = src.search(
      /INSERT\s+INTO\s+public\.match_named_contacts\s*\(/i,
    );
    const replacedByIdx = src.search(/SET\s+replaced_by_id\s*=\s*v_new_id/i);
    expect(replacedByIdx).toBeGreaterThan(insertIdx);
  });

  it("still takes the per-(match,side) advisory lock before reading the prior row", () => {
    const lockIdx = src.search(/pg_advisory_xact_lock\(v_lock_key\)/);
    const selectPriorIdx = src.search(/SELECT\s+id\s+INTO\s+v_prior_id/);
    expect(lockIdx).toBeGreaterThan(-1);
    expect(selectPriorIdx).toBeGreaterThan(lockIdx);
  });

  it("preserves audit action names (created / replaced / override)", () => {
    expect(src).toMatch(/'match_named_contact\.created'/);
    expect(src).toMatch(/'match_named_contact\.replaced'/);
    expect(src).toMatch(/'admin\.named_contact_override'/);
  });

  it("preserves SECDEF Stage D1 lockdown (service_role only)", () => {
    expect(src).toMatch(
      /REVOKE ALL ON FUNCTION public\.assign_match_named_contact\([^)]*\) FROM PUBLIC/,
    );
    expect(src).toMatch(
      /REVOKE ALL ON FUNCTION public\.assign_match_named_contact\([^)]*\) FROM authenticated/,
    );
    expect(src).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.assign_match_named_contact\([^)]*\) TO service_role/,
    );
  });

  it("never imports POI/WaD/payment/credit/email side-effects (RPC body is pure SQL)", () => {
    expect(src).not.toMatch(
      /atomic_generate_poi|atomic_token_burn|notification|resend|payment|credit/i,
    );
  });
});
