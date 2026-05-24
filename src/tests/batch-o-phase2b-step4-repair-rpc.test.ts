/**
 * Batch O Phase 2b Step 4 — admin_repair_legacy_match RPC + edge function.
 *
 * Source-level guarantees (no live RPC execution — that needs fixtures
 * out of scope for this step). We assert the on-disk artefacts encode
 * the safety properties the spec demands:
 *
 *   • RPC is SECURITY DEFINER, service-role only, advisory-locked,
 *     notes-validated, inconsistency-gated, operation-gated, has a
 *     post-condition check, idempotent, and writes a single
 *     `match.legacy_state_repaired` audit row.
 *   • Repair operations are a fixed allow-list. `force_terminal_for_orphan_settled`
 *     is explicitly deferred.
 *   • Edge function requires Idempotency-Key, validates the body strictly,
 *     authenticates the caller as a platform admin, and never imports
 *     notification / POI / WaD / payment / credit / rating / compliance /
 *     public-status / lifecycle / SLA modules.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const migrationsDir = join(root, "supabase/migrations");
const edgePath = join(
  root,
  "supabase/functions/admin-match-legacy-repair/index.ts",
);

function repairMigrations() {
  return readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .map((name) => ({ name, sql: readFileSync(join(migrationsDir, name), "utf8") }))
    .filter((m) => /admin_repair_legacy_match/i.test(m.sql))
    .sort((a, b) => a.name.localeCompare(b.name));
}

describe("Batch O Phase 2b Step 4 — admin_repair_legacy_match RPC migration", () => {
  const migs = repairMigrations();
  const latest = migs[migs.length - 1];

  it("at least one migration creates the RPC", () => {
    expect(migs.length).toBeGreaterThan(0);
    expect(latest).toBeTruthy();
  });

  it("declares the function as SECURITY DEFINER with a fixed search_path", () => {
    expect(latest.sql).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.admin_repair_legacy_match/i,
    );
    expect(latest.sql).toMatch(/SECURITY\s+DEFINER/i);
    expect(latest.sql).toMatch(/SET\s+search_path\s*=\s*public/i);
  });

  it("revokes EXECUTE from PUBLIC/anon/authenticated and grants only to service_role", () => {
    expect(latest.sql).toMatch(
      /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.admin_repair_legacy_match[^;]+FROM\s+PUBLIC/i,
    );
    expect(latest.sql).toMatch(
      /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.admin_repair_legacy_match[^;]+FROM\s+anon/i,
    );
    expect(latest.sql).toMatch(
      /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.admin_repair_legacy_match[^;]+FROM\s+authenticated/i,
    );
    expect(latest.sql).toMatch(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.admin_repair_legacy_match[^;]+TO\s+service_role/i,
    );
  });

  it("requires admin context via is_admin(p_admin_user_id)", () => {
    expect(latest.sql).toMatch(/public\.is_admin\s*\(\s*p_admin_user_id\s*\)/i);
    expect(latest.sql).toMatch(/not_admin/i);
  });

  it("validates notes length (>=10 and <=2000)", () => {
    expect(latest.sql).toMatch(/notes_too_short/);
    expect(latest.sql).toMatch(/notes_too_long/);
    expect(latest.sql).toMatch(/char_length\s*\(\s*v_notes\s*\)\s*<\s*10/);
    expect(latest.sql).toMatch(/char_length\s*\(\s*v_notes\s*\)\s*>\s*2000/);
  });

  it("takes a per-match advisory transaction lock distinct from archive", () => {
    expect(latest.sql).toMatch(/pg_advisory_xact_lock\s*\(/i);
    expect(latest.sql).toMatch(/match_legacy_repair:/);
  });

  it("rejects unknown operation strings (operation_invalid)", () => {
    expect(latest.sql).toMatch(/operation_invalid/);
    // The RPC's allow-list contains exactly these four strings.
    expect(latest.sql).toMatch(/'clear_stale_settled_at'/);
    expect(latest.sql).toMatch(/'restore_poi_state_for_completed'/);
    expect(latest.sql).toMatch(/'clear_legacy_repair_marker'/);
    expect(latest.sql).toMatch(/'force_terminal_for_orphan_settled'/);
  });

  it("explicitly defers force_terminal_for_orphan_settled", () => {
    expect(latest.sql).toMatch(
      /v_operation\s*=\s*'force_terminal_for_orphan_settled'[\s\S]*?operation_deferred/,
    );
  });

  it("requires a currently-inconsistent match (not_inconsistent error path)", () => {
    expect(latest.sql).toMatch(/not_inconsistent/);
  });

  it("requires the operation to match a present reason (operation_not_applicable)", () => {
    expect(latest.sql).toMatch(/operation_not_applicable/);
  });

  it("post-checks inconsistency after applying the patch", () => {
    expect(latest.sql).toMatch(/still_inconsistent_after_repair/);
    // The post-check uses a re-read of the match row.
    expect(latest.sql).toMatch(/SELECT\s+\*\s+INTO\s+v_after\s+FROM\s+public\.matches/i);
  });

  it("clear_stale_settled_at patch only clears settled_at", () => {
    expect(latest.sql).toMatch(
      /v_operation\s*=\s*'clear_stale_settled_at'\s+THEN\s+UPDATE\s+public\.matches\s+SET\s+settled_at\s*=\s*NULL\s+WHERE\s+id\s*=\s*p_match_id\s*;/,
    );
  });

  it("restore_poi_state_for_completed patch only changes poi_state and only when state='completed'", () => {
    // Defensive write-time guard
    expect(latest.sql).toMatch(/IF\s+v_match\.state\s*<>\s*'completed'\s+THEN[\s\S]*?operation_not_applicable/);
    // The actual UPDATE is gated by `AND state = 'completed'`
    expect(latest.sql).toMatch(
      /UPDATE\s+public\.matches\s+SET\s+poi_state\s*=\s*'COMPLETED'\s+WHERE\s+id\s*=\s*p_match_id\s+AND\s+state\s*=\s*'completed'/i,
    );
  });

  it("clear_legacy_repair_marker patch only removes the two metadata keys", () => {
    expect(latest.sql).toMatch(
      /coalesce\(v_match\.metadata,\s*'\{\}'::jsonb\)\s*-\s*'legacy_repair_required'\s*-\s*'state_reconciliation_required'/,
    );
    // and writes only metadata
    expect(latest.sql).toMatch(
      /UPDATE\s+public\.matches\s+SET\s+metadata\s*=\s*v_new_metadata/i,
    );
  });

  it("emits exactly one match.legacy_state_repaired audit row with before/after", () => {
    const inserts =
      latest.sql.match(/INSERT\s+INTO\s+public\.audit_logs/gi) ?? [];
    expect(inserts.length).toBe(1);
    expect(latest.sql).toMatch(/'match\.legacy_state_repaired'/);
    expect(latest.sql).toMatch(/'before'/);
    expect(latest.sql).toMatch(/'after'/);
    expect(latest.sql).toMatch(/'operation'/);
  });

  it("idempotent short-circuit when the patch is already a no-op (no duplicate audit row)", () => {
    // The no-op branch returns BEFORE the INSERT INTO audit_logs.
    // Verified structurally: the v_no_op early-return references
    // 'idempotent', true and 'no_op', true.
    expect(latest.sql).toMatch(/IF\s+v_no_op\s+THEN[\s\S]*?'idempotent',\s*true[\s\S]*?'no_op',\s*true[\s\S]*?RETURN\s+jsonb_build_object/);
    // And the early return appears before the audit insert in the file.
    const noOpIdx = latest.sql.indexOf("v_no_op THEN");
    const auditIdx = latest.sql.search(/INSERT\s+INTO\s+public\.audit_logs/i);
    expect(noOpIdx).toBeGreaterThan(0);
    expect(auditIdx).toBeGreaterThan(noOpIdx);
  });

  it("does not delete the match", () => {
    expect(latest.sql).not.toMatch(/DELETE\s+FROM\s+public\.matches/i);
  });

  it("does not touch POI / WaD / payment / credit / token / rating tables", () => {
    const sql = latest.sql
      .replace(/--.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    // Batch K Fix 2 added a READ on public.wads to refuse
    // restore_poi_state_for_completed when no sealed WaD exists. That is
    // a safety guard, not a mutation. The forbidden contract here is
    // WRITES to these tables — never reads.
    const forbidden = [
      /\bpois\b/i,
      /poi_engagements/i,
      /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:public\.)?wads?\b/i,
      /\bpayments?\b/i,
      /paystack/i,
      /\bcredits\b/i,
      /token_ledger/i,
      /counterparty_rating/i,
    ];
    for (const re of forbidden) {
      expect(sql).not.toMatch(re);
    }
    // And, separately, no UPDATE/INSERT/DELETE may touch public.wads.
    expect(sql).not.toMatch(/UPDATE\s+(?:public\.)?wads\b/i);
    expect(sql).not.toMatch(/INSERT\s+INTO\s+(?:public\.)?wads\b/i);
    expect(sql).not.toMatch(/DELETE\s+FROM\s+(?:public\.)?wads\b/i);
  });


  it("does not create triggers or pg_notify fan-out", () => {
    expect(latest.sql).not.toMatch(/CREATE\s+TRIGGER/i);
    expect(latest.sql).not.toMatch(/pg_notify/i);
  });
});

describe("Batch O Phase 2b Step 4 — admin-match-legacy-repair edge function", () => {
  it("file exists", () => {
    expect(existsSync(edgePath)).toBe(true);
  });

  const src = readFileSync(edgePath, "utf8");

  it("requires Idempotency-Key via the shared assertIdempotencyKey helper", () => {
    expect(src).toMatch(/assertIdempotencyKey/);
  });

  it("uses a strict Zod body schema accepting only match_id + operation + notes", () => {
    expect(src).toMatch(/match_id:\s*z\.string\(\)\.uuid\(\)/);
    expect(src).toMatch(/operation:\s*z\.enum\(ALLOWED_OPERATIONS\)/);
    expect(src).toMatch(/notes:\s*z\.string\(\)\.trim\(\)\.min\(10\)\.max\(2000\)/);
    expect(src).toMatch(/\.strict\(\)/);
  });

  it("declares the exact same allow-list as the RPC (4 operations)", () => {
    expect(src).toMatch(/"clear_stale_settled_at"/);
    expect(src).toMatch(/"restore_poi_state_for_completed"/);
    expect(src).toMatch(/"clear_legacy_repair_marker"/);
    expect(src).toMatch(/"force_terminal_for_orphan_settled"/);
  });

  it("verifies the caller is an authenticated admin via the is_admin RPC", () => {
    expect(src).toMatch(/admin\.auth\.getUser\(token\)/);
    expect(src).toMatch(/rpc\(\s*["']is_admin["']/);
  });

  it("invokes the SECURITY DEFINER repair RPC with the validated parameters", () => {
    expect(src).toMatch(/rpc\(\s*["']admin_repair_legacy_match["']/);
    expect(src).toMatch(/p_match_id:\s*parsedBody\.match_id/);
    expect(src).toMatch(/p_admin_user_id:\s*caller\.id/);
    expect(src).toMatch(/p_operation:\s*parsedBody\.operation/);
    expect(src).toMatch(/p_notes:\s*parsedBody\.notes/);
  });

  it("uses the shared idempotency cache (lookup + store)", () => {
    expect(src).toMatch(/lookupIdempotentResponse/);
    expect(src).toMatch(/storeIdempotentResponse/);
  });

  it("maps controlled RPC errors to the right HTTP statuses", () => {
    // operation_deferred -> 409
    expect(src).toMatch(/OPERATION_DEFERRED[\s\S]*?409/);
    // operation_not_applicable -> 409
    expect(src).toMatch(/OPERATION_NOT_APPLICABLE[\s\S]*?409/);
    // still_inconsistent_after_repair -> 409
    expect(src).toMatch(/STILL_INCONSISTENT_AFTER_REPAIR[\s\S]*?409/);
    // not_inconsistent -> 409
    expect(src).toMatch(/NOT_INCONSISTENT[\s\S]*?409/);
    // match_not_found -> 404
    expect(src).toMatch(/MATCH_NOT_FOUND[\s\S]*?404/);
    // not_admin -> 403
    expect(src).toMatch(/FORBIDDEN[\s\S]*?403/);
  });

  it("does not accept arbitrary patch bodies (no .passthrough or .catchall)", () => {
    expect(src).not.toMatch(/\.passthrough\(/);
    expect(src).not.toMatch(/\.catchall\(/);
  });

  it("imports nothing from notification / POI / WaD / payment / credit / rating / compliance / public-status / lifecycle / SLA modules", () => {
    const forbiddenImports = [
      /notification-dispatch/i,
      /from\s+["'][^"']*\/email[^"']*["']/i,
      /from\s+["'][^"']*\/poi[^"']*["']/i,
      /from\s+["'][^"']*\/wad[^"']*["']/i,
      /from\s+["'][^"']*\/payment[^"']*["']/i,
      /from\s+["'][^"']*paystack[^"']*["']/i,
      /from\s+["'][^"']*\/credit[^"']*["']/i,
      /from\s+["'][^"']*\/token[^"']*["']/i,
      /from\s+["'][^"']*\/rating[^"']*["']/i,
      /from\s+["'][^"']*\/compliance[^"']*["']/i,
      /from\s+["'][^"']*\/public-status[^"']*["']/i,
      /from\s+["'][^"']*\/lifecycle[^"']*["']/i,
      /from\s+["'][^"']*\/sla[^"']*["']/i,
    ];
    for (const re of forbiddenImports) {
      expect(src).not.toMatch(re);
    }
  });

  it("does not write to public.matches directly from the edge function (RPC-only)", () => {
    expect(src).not.toMatch(/\.from\(\s*["']matches["']/);
    expect(src).not.toMatch(/\.from\(\s*["']audit_logs["']/);
  });
});
