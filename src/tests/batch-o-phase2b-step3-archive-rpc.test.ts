/**
 * Batch O Phase 2b Step 3 — admin_archive_legacy_match RPC + edge function.
 *
 * Source-level guarantees (no live RPC execution — that requires real
 * fixtures, which is Step 4 territory). We assert the on-disk artefacts
 * encode the safety properties the spec demands:
 *
 *   • RPC is SECURITY DEFINER, service-role only, advisory-locked,
 *     notes-validated, inconsistency-gated, idempotent, and writes a
 *     single `match.legacy_state_archived` audit row.
 *   • Edge function requires Idempotency-Key, validates the body strictly,
 *     authenticates the caller as a platform admin, and never imports
 *     notification / POI / WaD / payment / credit / rating / compliance /
 *     public-status / lifecycle / SLA modules.
 *   • The new `legacy_archived_admin_hold` lifecycle marker excludes a
 *     match from `isActiveMatch()` in BOTH client and edge mirrors.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  isActiveMatch,
  hasActiveChildMatches,
  inconsistencyReasons,
  type LifecycleMatch,
} from "@/lib/match-lifecycle";

const root = process.cwd();
const migrationsDir = join(root, "supabase/migrations");
const edgePath = join(
  root,
  "supabase/functions/admin-match-legacy-archive/index.ts",
);

function archiveMigrations() {
  return readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .map((name) => ({ name, sql: readFileSync(join(migrationsDir, name), "utf8") }))
    .filter((m) => /admin_archive_legacy_match/i.test(m.sql))
    .sort((a, b) => a.name.localeCompare(b.name));
}

describe("Batch O Phase 2b Step 3 — admin_archive_legacy_match RPC migration", () => {
  const migs = archiveMigrations();
  const latest = migs[migs.length - 1];

  it("at least one migration creates the RPC", () => {
    expect(migs.length).toBeGreaterThan(0);
    expect(latest).toBeTruthy();
  });

  it("declares the function as SECURITY DEFINER with a fixed search_path", () => {
    expect(latest.sql).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.admin_archive_legacy_match/i);
    expect(latest.sql).toMatch(/SECURITY\s+DEFINER/i);
    expect(latest.sql).toMatch(/SET\s+search_path\s*=\s*public/i);
  });

  it("revokes EXECUTE from PUBLIC/anon/authenticated and grants only to service_role", () => {
    expect(latest.sql).toMatch(/REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.admin_archive_legacy_match[^;]+FROM\s+PUBLIC/i);
    expect(latest.sql).toMatch(/REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.admin_archive_legacy_match[^;]+FROM\s+anon/i);
    expect(latest.sql).toMatch(/REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.admin_archive_legacy_match[^;]+FROM\s+authenticated/i);
    expect(latest.sql).toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.admin_archive_legacy_match[^;]+TO\s+service_role/i);
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

  it("takes a per-match advisory transaction lock", () => {
    expect(latest.sql).toMatch(/pg_advisory_xact_lock\s*\(/i);
    expect(latest.sql).toMatch(/match_legacy_archive:/);
  });

  it("requires a currently-inconsistent match (not_inconsistent error path)", () => {
    expect(latest.sql).toMatch(/not_inconsistent/);
    // conservative subset matches a couple of the TS reason rules
    expect(latest.sql).toMatch(/legacy_repair_required/);
    expect(latest.sql).toMatch(/state_reconciliation_required/);
    expect(latest.sql).toMatch(/buyer_committed_at\s+IS\s+NOT\s+NULL/i);
    expect(latest.sql).toMatch(/buyer_org_id\s*=\s*v_match\.seller_org_id|seller_org_id\s*=\s*v_match\.buyer_org_id|buyer_org_id\s*=\s*[^,;]*seller_org_id/i);
  });

  it("does not delete the match", () => {
    expect(latest.sql).not.toMatch(/DELETE\s+FROM\s+public\.matches/i);
  });

  it("does not touch POI / WaD / payment / credit / token / rating tables", () => {
    // Strip SQL comments so the safety description in the file header
    // (which lists what we are NOT touching) doesn't trip the guard.
    const sql = latest.sql
      .replace(/--.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    const forbidden = [
      /\bpois\b/i,
      /poi_engagements/i,
      /\bwads?\b/i,
      /\bpayments?\b/i,
      /paystack/i,
      /\bcredits\b/i,
      /token_ledger/i,
      /counterparty_rating/i,
    ];
    for (const re of forbidden) {
      expect(sql).not.toMatch(re);
    }
  });

  it("writes the lifecycle marker into matches.metadata", () => {
    expect(latest.sql).toMatch(/legacy_archived_admin_hold/);
    expect(latest.sql).toMatch(/UPDATE\s+public\.matches\s+SET\s+metadata\s*=/i);
  });

  it("emits exactly one match.legacy_state_archived audit row", () => {
    const inserts =
      latest.sql.match(/INSERT\s+INTO\s+public\.audit_logs/gi) ?? [];
    expect(inserts.length).toBe(1);
    expect(latest.sql).toMatch(/'match\.legacy_state_archived'/);
    expect(latest.sql).toMatch(/'before'/);
    expect(latest.sql).toMatch(/'after_metadata'/);
  });

  it("is idempotent on re-invocation (returns when already archived)", () => {
    expect(latest.sql).toMatch(/legacy_archived_admin_hold[\s\S]*'idempotent',\s*true/);
  });

  it("does not create triggers or pg_notify fan-out", () => {
    expect(latest.sql).not.toMatch(/CREATE\s+TRIGGER/i);
    expect(latest.sql).not.toMatch(/pg_notify/i);
  });
});

describe("Batch O Phase 2b Step 3 — admin-match-legacy-archive edge function", () => {
  it("file exists", () => {
    expect(existsSync(edgePath)).toBe(true);
  });

  const src = readFileSync(edgePath, "utf8");

  it("requires Idempotency-Key via the shared assertIdempotencyKey helper", () => {
    expect(src).toMatch(/assertIdempotencyKey/);
  });

  it("uses a strict Zod body schema accepting only match_id + notes", () => {
    expect(src).toMatch(/z\.object\(\s*\{[\s\S]*match_id:\s*z\.string\(\)\.uuid\(\)/);
    expect(src).toMatch(/notes:\s*z\.string\(\)\.trim\(\)\.min\(10\)\.max\(2000\)/);
    expect(src).toMatch(/\.strict\(\)/);
  });

  it("verifies the caller is an authenticated admin via the is_admin RPC", () => {
    expect(src).toMatch(/admin\.auth\.getUser\(token\)/);
    expect(src).toMatch(/rpc\(\s*["']is_admin["']/);
  });

  it("invokes the SECURITY DEFINER RPC with the validated parameters", () => {
    expect(src).toMatch(/rpc\(\s*["']admin_archive_legacy_match["']/);
    expect(src).toMatch(/p_match_id:\s*parsedBody\.match_id/);
    expect(src).toMatch(/p_admin_user_id:\s*caller\.id/);
    expect(src).toMatch(/p_notes:\s*parsedBody\.notes/);
  });

  it("uses the shared idempotency cache (lookup + store)", () => {
    expect(src).toMatch(/lookupIdempotentResponse/);
    expect(src).toMatch(/storeIdempotentResponse/);
  });

  it("maps not_inconsistent to a controlled 409 response", () => {
    expect(src).toMatch(/NOT_INCONSISTENT/);
    expect(src).toMatch(/409/);
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

  it("does not accept arbitrary patch bodies (no .passthrough or .catchall)", () => {
    expect(src).not.toMatch(/\.passthrough\(/);
    expect(src).not.toMatch(/\.catchall\(/);
  });
});

describe("Batch O Phase 2b Step 3 — legacy_archived_admin_hold marker excludes from isActiveMatch", () => {
  const baseActive: LifecycleMatch = {
    status: "open",
    state: "discovery",
    poi_state: "DRAFT",
  };

  it("a clean discovery match is active (sanity)", () => {
    expect(isActiveMatch(baseActive)).toBe(true);
  });

  it("setting legacy_archived_admin_hold removes it from active", () => {
    const held: LifecycleMatch = {
      ...baseActive,
      metadata: { legacy_archived_admin_hold: true },
    };
    expect(isActiveMatch(held)).toBe(false);
  });

  it("string 'true' and number 1 are also accepted (matches hasMarker contract)", () => {
    expect(
      isActiveMatch({ ...baseActive, metadata: { legacy_archived_admin_hold: "true" } }),
    ).toBe(false);
    expect(
      isActiveMatch({ ...baseActive, metadata: { legacy_archived_admin_hold: 1 } }),
    ).toBe(false);
  });

  it("hasActiveChildMatches skips child rows carrying the marker", () => {
    expect(
      hasActiveChildMatches([
        { status: "open", state: "discovery", poi_state: "DRAFT", metadata: { legacy_archived_admin_hold: true } },
      ]),
    ).toBe(false);
    expect(
      hasActiveChildMatches([
        { status: "open", state: "discovery", poi_state: "DRAFT" },
      ]),
    ).toBe(true);
  });

  it("the marker is NOT itself an inconsistency reason", () => {
    const reasons = inconsistencyReasons({
      ...baseActive,
      metadata: { legacy_archived_admin_hold: true },
    });
    expect(reasons).not.toContain("legacy_repair_required");
    // marker alone produces no reasons
    expect(reasons.length).toBe(0);
  });
});
