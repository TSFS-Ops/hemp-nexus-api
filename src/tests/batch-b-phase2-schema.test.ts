/**
 * Batch B Phase 2 — schema-level migration tests.
 *
 * These tests pin the static contents of the two Phase 2 migration files
 * so that any future edit to the late-acceptance / renewal foundation is
 * a deliberate, reviewable change. Live-DB proofs of the same invariants
 * were captured at migration time and are documented in the Phase 2
 * report; the live invariants are:
 *
 *   • All 10 new columns present on public.poi_engagements.
 *   • Enum value `late_acceptance_pending_initiator_reconfirmation`
 *     present on public.engagement_status.
 *   • Old `unique_match_engagement` constraint removed.
 *   • Partial unique index `uq_poi_engagements_one_current_per_match`
 *     present (active = engagement_status NOT IN ('expired','declined')).
 *   • Partial unique index `uq_poi_engagements_renewed_from_once`
 *     present (prevents a parent being renewed twice).
 *   • Three new check constraints present:
 *       poi_engagements_counterparty_response_chk
 *       poi_engagements_late_acceptance_resolution_chk
 *       poi_engagements_late_acceptance_required_fields_chk
 *   • Existing rows (76 at migration time) all satisfy the new
 *     constraints; 0 matches had >1 active engagement.
 *
 * Rollback honesty: dropping `uq_poi_engagements_one_current_per_match`
 * and restoring `UNIQUE(match_id)` is only safe while no match has more
 * than one row. Once Phase 3 introduces renewed children, that
 * precondition no longer holds and rollback requires a data-merge step
 * that this migration intentionally does not provide.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

function readMigrationContaining(token: string): string {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
  for (const f of files) {
    const body = readFileSync(join(MIGRATIONS_DIR, f), "utf8");
    if (body.includes(token)) return body;
  }
  throw new Error(`No migration file contains token: ${token}`);
}

describe("Batch B Phase 2 — engagement_status enum", () => {
  it("adds the late_acceptance_pending_initiator_reconfirmation enum value", () => {
    const sql = readMigrationContaining("ADD VALUE IF NOT EXISTS 'late_acceptance_pending_initiator_reconfirmation'");
    expect(sql).toMatch(/ALTER TYPE\s+public\.engagement_status\s+ADD VALUE/i);
  });
});

describe("Batch B Phase 2 — poi_engagements schema migration", () => {
  const sql = readMigrationContaining("uq_poi_engagements_one_current_per_match");

  it("adds all ten late-acceptance / renewal columns", () => {
    for (const col of [
      "counterparty_response",
      "original_expired_at",
      "late_acceptance_recorded_at",
      "reconfirmation_window_expires_at",
      "late_acceptance_resolved_at",
      "late_acceptance_resolution",
      "reconfirmed_at",
      "reconfirmed_by_user_id",
      "renewed_from_engagement_id",
      "renewed_engagement_id",
    ]) {
      expect(sql).toContain(`ADD COLUMN IF NOT EXISTS ${col}`);
    }
  });

  it("drops the old UNIQUE(match_id) constraint", () => {
    expect(sql).toMatch(/DROP CONSTRAINT IF EXISTS unique_match_engagement/);
  });

  it("creates the partial unique index that allows historical rows to coexist", () => {
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_poi_engagements_one_current_per_match[\s\S]+WHERE engagement_status NOT IN \('expired','declined'\)/,
    );
  });

  it("creates the duplicate-renewal prevention index", () => {
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_poi_engagements_renewed_from_once[\s\S]+WHERE renewed_from_engagement_id IS NOT NULL/,
    );
  });

  it("adds the counterparty_response value check", () => {
    expect(sql).toContain("poi_engagements_counterparty_response_chk");
    expect(sql).toMatch(/counterparty_response IN \('accepted','declined','late_accepted'\)/);
  });

  it("adds the late_acceptance_resolution value check", () => {
    expect(sql).toContain("poi_engagements_late_acceptance_resolution_chk");
    for (const v of [
      "renewed_engagement_created",
      "initiator_declined_renewal",
      "reconfirmation_window_expired",
    ]) {
      expect(sql).toContain(v);
    }
  });

  it("requires the supporting timestamps when status is late_acceptance_pending_initiator_reconfirmation", () => {
    expect(sql).toContain("poi_engagements_late_acceptance_required_fields_chk");
    expect(sql).toMatch(/engagement_status <> 'late_acceptance_pending_initiator_reconfirmation'/);
    expect(sql).toMatch(/original_expired_at IS NOT NULL/);
    expect(sql).toMatch(/late_acceptance_recorded_at IS NOT NULL/);
    expect(sql).toMatch(/reconfirmation_window_expires_at IS NOT NULL/);
  });

  it("does not introduce a renewal cap (Phase 2 must not implement workflow logic)", () => {
    expect(sql).not.toMatch(/renewal_count|max_renewals|renewal_cap/i);
  });

  it("documents the rollback limitation honestly", () => {
    expect(sql).toMatch(/[Rr]ollback[\s\S]+only safe[\s\S]+no match has more than one row/);
  });
});
