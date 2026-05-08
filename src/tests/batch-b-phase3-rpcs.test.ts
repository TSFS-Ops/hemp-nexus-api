/**
 * Batch B Phase 3 — RPC SQL pin tests.
 *
 * These tests pin the salient clauses of the Phase 3 migration so any
 * future edit to the late-acceptance / renewal RPCs is a deliberate,
 * reviewable change. Live-DB existence + grant probes were captured at
 * migration time and are documented in the Phase 3 report:
 *   • atomic_record_late_acceptance, atomic_reconfirm_late_acceptance,
 *     and atomic_decline_late_acceptance all exist; PUBLIC/anon/
 *     authenticated have no EXECUTE; service_role has EXECUTE.
 *   • atomic_engagement_transition was rewritten with the two new hard
 *     rejections (`expired_engagement_use_late_acceptance_rpc` and
 *     `late_acceptance_state_requires_dedicated_rpc`).
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

function findMigrationContaining(token: string): string {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  // pick the latest file containing the token (so a future amendment is what we test).
  const matches = files.filter((f) => readFileSync(join(MIGRATIONS_DIR, f), "utf8").includes(token));
  if (matches.length === 0) throw new Error(`No migration contains token: ${token}`);
  return readFileSync(join(MIGRATIONS_DIR, matches[matches.length - 1]), "utf8");
}

describe("Batch B Phase 3 — atomic_record_late_acceptance", () => {
  const sql = findMigrationContaining("atomic_record_late_acceptance");

  it("creates the function", () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.atomic_record_late_acceptance/);
  });

  it("locks the engagement before any read/write", () => {
    expect(sql).toMatch(/pg_advisory_xact_lock[\s\S]*?SELECT \* INTO v_engagement[\s\S]*?FOR UPDATE/);
  });

  it("requires the engagement to be expired before recording the late acceptance", () => {
    expect(sql).toMatch(/v_engagement\.engagement_status::text <> 'expired'/);
    expect(sql).toMatch(/now\(\) <= v_engagement\.expires_at/);
  });

  it("sets the agreed late-acceptance fields atomically", () => {
    expect(sql).toMatch(/engagement_status\s*=\s*'late_acceptance_pending_initiator_reconfirmation'::engagement_status/);
    expect(sql).toMatch(/counterparty_response\s*=\s*'accepted_after_expiry'/);
    expect(sql).toMatch(/original_expired_at\s*=\s*COALESCE\(original_expired_at, expires_at\)/);
    expect(sql).toMatch(/late_acceptance_recorded_at\s*=\s*now\(\)/);
    expect(sql).toMatch(/reconfirmation_window_expires_at\s*=\s*v_window_end/);
    expect(sql).toMatch(/v_window_end := now\(\) \+ interval '7 days'/);
  });

  it("emits the agreed audit action", () => {
    expect(sql).toContain("'pending_engagement.accepted_after_expiry'");
  });

  it("is idempotent when already in the late-acceptance state", () => {
    expect(sql).toMatch(/v_engagement\.engagement_status::text = 'late_acceptance_pending_initiator_reconfirmation'[\s\S]+'idempotent', true/);
  });

  it("is service_role only", () => {
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.atomic_record_late_acceptance[^;]+FROM PUBLIC, anon, authenticated/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.atomic_record_late_acceptance[^;]+TO service_role/);
  });
});

describe("Batch B Phase 3 — atomic_reconfirm_late_acceptance", () => {
  const sql = findMigrationContaining("atomic_reconfirm_late_acceptance");

  it("creates the function", () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.atomic_reconfirm_late_acceptance/);
  });

  it("locks the parent engagement before reading or writing", () => {
    expect(sql).toMatch(/pg_advisory_xact_lock[\s\S]*?SELECT \* INTO v_parent[\s\S]*?FOR UPDATE/);
  });

  it("requires the parent to be in the reconfirmation state and within the window", () => {
    expect(sql).toMatch(/v_parent\.engagement_status::text <> 'late_acceptance_pending_initiator_reconfirmation'/);
    expect(sql).toMatch(/now\(\) > v_parent\.reconfirmation_window_expires_at/);
  });

  it("creates the renewed child as notification_sent (not accepted) with renewed_from link", () => {
    expect(sql).toMatch(/INSERT INTO poi_engagements[\s\S]+'notification_sent'::engagement_status[\s\S]+v_parent\.id/);
    expect(sql).toMatch(/renewed_from_engagement_id/);
  });

  it("does NOT copy expires_at on the child (fresh expiry via column default)", () => {
    // The INSERT column list must omit expires_at so the column default
    // (now() + 30 days) applies. A regression that copies expires_at
    // would carry forward the parent's stale expiry.
    const insertBlock = sql.match(/INSERT INTO poi_engagements \(([^)]+)\)\s+VALUES/);
    expect(insertBlock).toBeTruthy();
    const cols = insertBlock![1];
    expect(cols).not.toMatch(/\bexpires_at\b/);
  });

  it("returns the parent to expired and records resolution metadata", () => {
    expect(sql).toMatch(/engagement_status\s*=\s*'expired'::engagement_status/);
    expect(sql).toMatch(/late_acceptance_resolution\s*=\s*'renewed_engagement_created'/);
    expect(sql).toMatch(/late_acceptance_resolved_at\s*=\s*now\(\)/);
    expect(sql).toMatch(/reconfirmed_at\s*=\s*now\(\)/);
    expect(sql).toMatch(/reconfirmed_by_user_id\s*=\s*p_actor_user_id/);
    expect(sql).toMatch(/renewed_engagement_id\s*=\s*v_child_id/);
  });

  it("preserves counterparty_response and late_acceptance_recorded_at on the parent (no overwrite)", () => {
    // Scope to the reconfirm function body so we don't accidentally
    // match the UPDATE inside atomic_record_late_acceptance (which
    // legitimately writes counterparty_response).
    const fnBody = sql.match(/CREATE OR REPLACE FUNCTION public\.atomic_reconfirm_late_acceptance[\s\S]+?\$function\$;/);
    expect(fnBody).toBeTruthy();
    const updateBlock = fnBody![0].match(/UPDATE poi_engagements\s+SET[\s\S]+?WHERE id = p_parent_engagement_id;/);
    expect(updateBlock).toBeTruthy();
    expect(updateBlock![0]).not.toMatch(/counterparty_response\s*=/);
    expect(updateBlock![0]).not.toMatch(/late_acceptance_recorded_at\s*=/);
  });

  it("is idempotent when a renewed child already exists", () => {
    expect(sql).toMatch(/v_parent\.renewed_engagement_id IS NOT NULL[\s\S]+'idempotent', true/);
  });

  it("emits the agreed audit action", () => {
    expect(sql).toContain("'pending_engagement.reconfirmed'");
  });

  it("is service_role only", () => {
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.atomic_reconfirm_late_acceptance[^;]+FROM PUBLIC, anon, authenticated/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.atomic_reconfirm_late_acceptance[^;]+TO service_role/);
  });
});

describe("Batch B Phase 3 — atomic_decline_late_acceptance", () => {
  const sql = findMigrationContaining("atomic_decline_late_acceptance");

  it("creates the function", () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.atomic_decline_late_acceptance/);
  });

  it("returns parent to expired and marks initiator_declined_renewal", () => {
    expect(sql).toMatch(/engagement_status\s*=\s*'expired'::engagement_status/);
    expect(sql).toMatch(/late_acceptance_resolution\s*=\s*'initiator_declined_renewal'/);
    expect(sql).toMatch(/late_acceptance_resolved_at\s*=\s*now\(\)/);
  });

  it("emits the agreed audit action", () => {
    expect(sql).toContain("'pending_engagement.initiator_declined_after_late_acceptance'");
  });

  it("is idempotent when already declined", () => {
    expect(sql).toMatch(/v_parent\.late_acceptance_resolution = 'initiator_declined_renewal'[\s\S]+'idempotent', true/);
  });

  it("is service_role only", () => {
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.atomic_decline_late_acceptance[^;]+FROM PUBLIC, anon, authenticated/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.atomic_decline_late_acceptance[^;]+TO service_role/);
  });
});

describe("Batch B Phase 3 — atomic_engagement_transition hard rejections", () => {
  const sql = findMigrationContaining("expired_engagement_use_late_acceptance_rpc");

  it("rejects expired → accepted with the explicit error code", () => {
    expect(sql).toMatch(/v_prev_status = 'expired' AND p_new_status = 'accepted'[\s\S]+'expired_engagement_use_late_acceptance_rpc'/);
  });

  it("rejects any direct write into or out of late_acceptance_pending_initiator_reconfirmation", () => {
    expect(sql).toMatch(/v_prev_status = 'late_acceptance_pending_initiator_reconfirmation'\s+OR p_new_status = 'late_acceptance_pending_initiator_reconfirmation'[\s\S]+'late_acceptance_state_requires_dedicated_rpc'/);
  });
});
