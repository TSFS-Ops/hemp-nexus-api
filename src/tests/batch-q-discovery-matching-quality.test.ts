/**
 * Batch Q — Discovery, duplicate counterparties and matching quality
 *
 * Static-text regression tests verifying the Batch Q hardening is present.
 * Matches the pattern of other batch-* tests in this repo (no live DB).
 *
 * Scope reminder (do not regress):
 *   - Same-org duplicate match still blocked by idx_matches_org_hash UNIQUE
 *     and the matches_role_invariant trigger (legacy protection).
 *   - Counterparty merge never silently rewrites historical matches.
 *   - Jurisdiction mismatch is advisory (audit + risk item), never blocking.
 *   - Side swap is NOT exposed as a correction RPC.
 *   - All admin correction endpoints require is_admin + AAL2 + reason.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = "supabase/migrations";
const BATCH_Q_MIGRATION = "20260516182709_fae0853c-24fd-4584-884f-32821d07f13a.sql";

function readMigration(name: string): string {
  return readFileSync(join(MIGRATIONS_DIR, name), "utf-8");
}

function readEdge(name: string): string {
  return readFileSync(join("supabase/functions", name, "index.ts"), "utf-8");
}

describe("Batch Q — schema canonicalisation", () => {
  const sql = readMigration(BATCH_Q_MIGRATION);

  it("1. adds counterparties.canonical_key as STORED generated column", () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS canonical_key text/);
    expect(sql).toMatch(/GENERATED ALWAYS AS[\s\S]*STORED/);
    expect(sql).toMatch(/lower\(btrim\(registration_number\)\)/);
    expect(sql).toMatch(/lower\(btrim\(jurisdiction\)\)/);
  });

  it("2. canonical_key index is non-unique (advisory only)", () => {
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS idx_counterparties_canonical_key/);
    expect(sql).not.toMatch(/CREATE UNIQUE INDEX[^;]*canonical_key/);
  });

  it("3. adds linked_org_id with ON DELETE SET NULL (no blind trust)", () => {
    expect(sql).toMatch(/linked_org_id uuid REFERENCES public\.organizations\(id\) ON DELETE SET NULL/);
  });

  it("4. adds merged_into_id WITHOUT touching historical matches", () => {
    expect(sql).toMatch(/merged_into_id uuid REFERENCES public\.counterparties\(id\)/);
    expect(sql).toMatch(/historical_match_relink/);
    expect(sql).toMatch(/Deliberately NO mutation of historical matches/);
  });
});

describe("Batch Q — admin RPCs require admin + reason + AAL2 + audit", () => {
  const sql = readMigration(BATCH_Q_MIGRATION);

  const rpcs = [
    "admin_link_counterparty_to_org",
    "admin_merge_counterparties",
    "admin_correct_match_jurisdiction",
    "admin_relink_match_counterparty",
    "admin_archive_duplicate_match",
  ];

  it.each(rpcs)("5. %s checks is_admin and requires reason >= 10 chars", (rpc) => {
    const body = sql.split(`FUNCTION public.${rpc}`)[1];
    expect(body).toBeDefined();
    expect(body).toMatch(/IF NOT public\.is_admin\(p_admin_user_id\) THEN[\s\S]*RAISE EXCEPTION 'not_admin'/);
    expect(body).toMatch(/length\(btrim\(p_reason\)\) < 10[\s\S]*reason_required/);
  });

  it.each(rpcs)("6. %s writes before/after entry to admin_audit_logs", (rpc) => {
    const body = sql.split(`FUNCTION public.${rpc}`)[1].split("$$;")[0];
    expect(body).toMatch(/INSERT INTO public\.admin_audit_logs/);
    expect(body).toMatch(/'reason'/);
  });

  it.each(rpcs)("7. %s is revoked from PUBLIC/authenticated/anon and granted only to service_role", (rpc) => {
    const after = sql.split(`FUNCTION public.${rpc}`).slice(1).join(`FUNCTION public.${rpc}`);
    // The REVOKE/GRANT block follows the function definition.
    expect(after).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${rpc}[^;]*FROM PUBLIC, authenticated, anon`));
    expect(after).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${rpc}[^;]*TO service_role`));
  });
});

describe("Batch Q — jurisdiction mismatch + cross-org duplicate detection", () => {
  const sql = readMigration(BATCH_Q_MIGRATION);

  it("8. detect_match_quality_warnings emits jurisdiction_mismatch warning", () => {
    expect(sql).toMatch(/detect_match_quality_warnings/);
    expect(sql).toMatch(/'jurisdiction_mismatch'/);
    expect(sql).toMatch(/'Jurisdiction mismatch — please review'/);
  });

  it("9. detection helper finds cross-org duplicate matches (not just same-org)", () => {
    expect(sql).toMatch(/'cross_org_duplicate_match'/);
    expect(sql).toMatch(/AND buyer_org_id\s*=\s*v_m\.buyer_org_id[\s\S]*AND seller_org_id\s*=\s*v_m\.seller_org_id/);
  });

  it("10. AFTER INSERT trigger on matches writes audit_logs + admin_risk_items (advisory, never blocks)", () => {
    expect(sql).toMatch(/CREATE TRIGGER match_quality_warning_after_insert[\s\S]*AFTER INSERT ON public\.matches/);
    expect(sql).toMatch(/match\.jurisdiction_mismatch_detected/);
    expect(sql).toMatch(/match\.cross_org_duplicate_detected/);
    expect(sql).toMatch(/INSERT INTO public\.admin_risk_items/);
    expect(sql).toMatch(/EXCEPTION WHEN OTHERS THEN[\s\S]*RETURN NEW/);
  });
});

describe("Batch Q — admin-counterparty-corrections edge function", () => {
  const fn = readEdge("admin-counterparty-corrections");

  it("11. requires Idempotency-Key, is_admin and AAL2", () => {
    expect(fn).toMatch(/assertIdempotencyKey\(req\)/);
    expect(fn).toMatch(/admin\.rpc\("is_admin"/);
    expect(fn).toMatch(/assertAal2\(authHeader/);
  });

  it("12. validates body with discriminated union (link_to_org | merge)", () => {
    expect(fn).toMatch(/z\.discriminatedUnion\("operation"/);
    expect(fn).toMatch(/z\.literal\("link_to_org"\)/);
    expect(fn).toMatch(/z\.literal\("merge"\)/);
    expect(fn).toMatch(/reason: z\.string\(\)\.trim\(\)\.min\(10\)\.max\(2000\)/);
  });

  it("13. delegates to the Batch F6 atomic governance wrapper (no split-commit)", () => {
    // Batch F6 rewired this endpoint so a single SECURITY DEFINER wrapper
    // performs the business mutation (admin_link_counterparty_to_org or
    // admin_merge_counterparties) and writes admin.hq_decision_recorded
    // in one transaction. The endpoint must call the wrapper directly and
    // must NOT call the per-operation RPCs from the edge function or
    // record the governance event in a second step.
    expect(fn).toMatch(/admin\.rpc\(\s*["']admin_counterparty_corrections_with_governance["']/);
    expect(fn).not.toMatch(/admin\.rpc\(\s*["']admin_link_counterparty_to_org["']/);
    expect(fn).not.toMatch(/admin\.rpc\(\s*["']admin_merge_counterparties["']/);
    expect(fn).not.toMatch(/recordAdminHqDecision/);
    // Surfaces governance_event_id back to the client.
    expect(fn).toMatch(/event_id/);
  });

});

describe("Batch Q — admin-match-corrections edge function", () => {
  const fn = readEdge("admin-match-corrections");

  it("14. exposes correct_jurisdiction / relink_counterparty / archive_duplicate", () => {
    expect(fn).toMatch(/z\.literal\("correct_jurisdiction"\)/);
    expect(fn).toMatch(/z\.literal\("relink_counterparty"\)/);
    expect(fn).toMatch(/z\.literal\("archive_duplicate"\)/);
  });

  it("15. does NOT expose a side-swap operation (role invariant remains authoritative)", () => {
    expect(fn).not.toMatch(/z\.literal\("swap_sides"\)/);
    expect(fn).not.toMatch(/admin_swap_match_sides/);
    expect(fn).toMatch(/Side-swap is deliberately NOT exposed/);
  });

  it("16. requires Idempotency-Key + is_admin + AAL2 + reason >= 10 chars", () => {
    expect(fn).toMatch(/assertIdempotencyKey\(req\)/);
    expect(fn).toMatch(/admin\.rpc\("is_admin"/);
    expect(fn).toMatch(/assertAal2\(authHeader/);
    expect(fn).toMatch(/reason: z\.string\(\)\.trim\(\)\.min\(10\)\.max\(2000\)/);
  });
});

describe("Batch Q — pinned invariants (do not regress)", () => {
  it("17. same-org duplicate match still blocked by UNIQUE (org_id, hash)", async () => {
    const allMigrations = readdirSync(MIGRATIONS_DIR).sort();
    const text = allMigrations.map((f) => readMigration(f)).join("\n");
    expect(text).toMatch(/UNIQUE[\s\S]*\(\s*org_id\s*,\s*hash\s*\)/i);
  });

  it("18. matches_role_invariant trigger still present somewhere", async () => {
    const allMigrations = readdirSync(MIGRATIONS_DIR).sort();
    const text = allMigrations.map((f) => readMigration(f)).join("\n");
    expect(text).toMatch(/matches_role_invariant/);
  });

  it("19. WaD hard-fail authority gate is not weakened by Batch Q migration", () => {
    const sql = readMigration(BATCH_Q_MIGRATION);
    // Batch Q must NOT touch wad_/authority_bind/seal/collapse logic.
    expect(sql).not.toMatch(/wad_/i);
    expect(sql).not.toMatch(/authority_bind/i);
    expect(sql).not.toMatch(/collapse/i);
  });
});
