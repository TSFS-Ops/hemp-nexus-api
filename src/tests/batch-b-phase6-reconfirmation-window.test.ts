/**
 * Batch B Phase 6 — Reconfirmation-window expiry tests.
 *
 * Pin tests for:
 *  • the SQL contract of `atomic_expire_late_acceptance_reconfirmation_window`
 *    (idempotency, audit row shape, preservation of forensic timestamps,
 *    no POI/WaD/credit/payment side effects);
 *  • the lifecycle-scheduler block that selects candidates and invokes the
 *    RPC per-row, including dry-run behaviour and absence of notification
 *    dispatch.
 *
 * Phase 5 wording guard is exercised separately via
 *   `node scripts/check-engagement-wording.mjs`
 * and is not duplicated here.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");
const SCHEDULER_PATH = join(
  process.cwd(),
  "supabase",
  "functions",
  "lifecycle-scheduler",
  "index.ts",
);

function loadLatestMigrationContaining(token: string): string {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const matches = files.filter((f) =>
    readFileSync(join(MIGRATIONS_DIR, f), "utf8").includes(token),
  );
  if (matches.length === 0) throw new Error(`No migration contains: ${token}`);
  return readFileSync(join(MIGRATIONS_DIR, matches[matches.length - 1]), "utf8");
}

describe("Batch B Phase 6 — atomic_expire_late_acceptance_reconfirmation_window", () => {
  const sql = loadLatestMigrationContaining(
    "atomic_expire_late_acceptance_reconfirmation_window",
  );

  it("creates the SECURITY DEFINER function with stable search_path", () => {
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.atomic_expire_late_acceptance_reconfirmation_window\(\s*p_engagement_id uuid\s*\)/,
    );
    expect(sql).toMatch(/SECURITY DEFINER/);
    expect(sql).toMatch(/SET search_path = public, extensions/);
  });

  it("locks the engagement row before reads/writes", () => {
    expect(sql).toMatch(
      /pg_advisory_xact_lock[\s\S]*?SELECT \* INTO v_engagement[\s\S]*?FOR UPDATE/,
    );
  });

  it("is idempotent when late_acceptance_resolution is already set", () => {
    expect(sql).toMatch(
      /IF v_engagement\.late_acceptance_resolution IS NOT NULL THEN[\s\S]*?'idempotent', true[\s\S]*?'reason', 'already_resolved'/,
    );
  });

  it("is idempotent when status is no longer the late-acceptance hold", () => {
    expect(sql).toMatch(
      /IF v_prev_status <> 'late_acceptance_pending_initiator_reconfirmation' THEN[\s\S]*?'idempotent', true[\s\S]*?'reason', 'status_not_late_acceptance'/,
    );
  });

  it("refuses to sweep rows whose reconfirmation window has not yet elapsed", () => {
    expect(sql).toMatch(
      /now\(\) <= v_engagement\.reconfirmation_window_expires_at[\s\S]*?'window_not_expired'/,
    );
  });

  it("reverts to expired and stamps the resolution + resolved_at, preserving forensic fields", () => {
    expect(sql).toMatch(
      /UPDATE poi_engagements[\s\S]*?engagement_status\s*=\s*'expired'::engagement_status[\s\S]*?late_acceptance_resolution\s*=\s*'reconfirmation_window_expired'[\s\S]*?late_acceptance_resolved_at\s*=\s*now\(\)/,
    );
    // counterparty_response, original_expired_at, late_acceptance_recorded_at
    // must NOT appear in the UPDATE SET list (preservation contract).
    const updateBlock = sql.match(
      /UPDATE poi_engagements[\s\S]*?WHERE id = p_engagement_id;/,
    );
    expect(updateBlock).not.toBeNull();
    expect(updateBlock![0]).not.toMatch(/counterparty_response\s*=/);
    expect(updateBlock![0]).not.toMatch(/original_expired_at\s*=/);
    expect(updateBlock![0]).not.toMatch(/late_acceptance_recorded_at\s*=/);
  });

  it("emits exactly one audit row with the canonical action and full metadata", () => {
    // Single INSERT INTO audit_logs in the function body.
    const auditInserts = sql.match(/INSERT INTO audit_logs/g) ?? [];
    expect(auditInserts.length).toBe(1);
    expect(sql).toMatch(/'late_acceptance\.reconfirmation_window_expired'/);
    expect(sql).toMatch(/'entity_type'|'poi_engagement'/); // entity_type passed positionally
    for (const key of [
      "match_id",
      "counterparty_response",
      "late_acceptance_recorded_at",
      "reconfirmation_window_expires_at",
      "original_expired_at",
      "late_acceptance_resolution",
      "previous_status",
      "new_status",
    ]) {
      expect(sql.includes(`'${key}'`)).toBe(true);
    }
  });

  it("does NOT touch POI / WaD / credits / payments", () => {
    // The function body should not reference any of these tables/RPCs.
    const body = sql.match(
      /CREATE OR REPLACE FUNCTION public\.atomic_expire_late_acceptance_reconfirmation_window[\s\S]*?\$function\$;/,
    );
    expect(body).not.toBeNull();
    const text = body![0];
    expect(text).not.toMatch(/atomic_generate_poi/);
    expect(text).not.toMatch(/atomic_token_burn/);
    expect(text).not.toMatch(/wads/i);
    expect(text).not.toMatch(/token_ledger/);
    expect(text).not.toMatch(/payments?/i);
    expect(text).not.toMatch(/INSERT INTO matches/i);
  });

  it("is service_role only", () => {
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.atomic_expire_late_acceptance_reconfirmation_window\(uuid\)\s*\n?\s*FROM PUBLIC, anon, authenticated;/,
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.atomic_expire_late_acceptance_reconfirmation_window\(uuid\)\s*\n?\s*TO service_role;/,
    );
  });

  it("never uses the forbidden 'auto-decline' wording", () => {
    expect(sql.toLowerCase()).not.toMatch(/auto[-\s]?decline/);
  });
});

describe("Batch B Phase 6 — lifecycle-scheduler sweep block", () => {
  const code = readFileSync(SCHEDULER_PATH, "utf8");

  it("queries late-acceptance candidates with all three required filters", () => {
    expect(code).toMatch(
      /\.eq\("engagement_status",\s*"late_acceptance_pending_initiator_reconfirmation"\)/,
    );
    expect(code).toMatch(/\.is\("late_acceptance_resolution",\s*null\)/);
    expect(code).toMatch(/\.lt\("reconfirmation_window_expires_at",\s*nowIso\)/);
  });

  it("invokes the atomic RPC per row", () => {
    expect(code).toMatch(
      /\.rpc\(\s*"atomic_expire_late_acceptance_reconfirmation_window",\s*\{\s*p_engagement_id:\s*row\.id\s*\}\s*\)/,
    );
  });

  it("counts swept vs idempotent vs error outcomes from the RPC result", () => {
    expect(code).toMatch(/lateAcceptanceSweptCount/);
    expect(code).toMatch(/lateAcceptanceIdempotentCount/);
    expect(code).toMatch(/lateAcceptanceErrorCount/);
    expect(code).toMatch(/result\?\.idempotent/);
  });

  it("dry-run only counts; never invokes the RPC", () => {
    // Pin: the dry-run branch increments swept count and `continue`s before
    // any rpc call. The rpc invocation must live below the dry-run guard.
    expect(code).toMatch(
      /if \(dryRun\) \{[\s\S]*?lateAcceptanceSweptCount\+\+;[\s\S]*?continue;[\s\S]*?\}[\s\S]*?\.rpc\(\s*"atomic_expire_late_acceptance_reconfirmation_window"/,
    );
  });

  it("emits NO notifications and records that explicitly in results", () => {
    expect(code).toMatch(/notifications_dispatched:\s*0/);
    // No notification-dispatch invocation inside the late-acceptance block.
    const block = code.match(
      /6\. LATE-ACCEPTANCE RECONFIRMATION-WINDOW EXPIRY[\s\S]*?Webhook replay-guard pruning/,
    );
    expect(block).not.toBeNull();
    expect(block![0]).not.toMatch(/notification-dispatch/);
    expect(block![0].toLowerCase()).not.toMatch(/auto[-\s]?decline/);
  });

  it("returns a results.late_acceptance_window_expiry summary", () => {
    expect(code).toMatch(/results\.late_acceptance_window_expiry\s*=\s*\{/);
    expect(code).toMatch(/candidates_found:/);
    expect(code).toMatch(/swept:/);
    expect(code).toMatch(/idempotent_skips:/);
    expect(code).toMatch(/errors:/);
  });
});
