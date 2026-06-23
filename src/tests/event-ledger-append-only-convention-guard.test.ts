/**
 * Event-ledger append-only convention guard (Option A containment).
 *
 * Tracks the open backend gap:
 *   `token_ledger`, `match_events`, and `poi_events` are append-only by
 *   convention only. Ordinary `authenticated` users are RLS-blocked from
 *   UPDATE/DELETE, but `service_role`/owner paths could still mutate
 *   because no DB-level immutability triggers exist yet.
 *
 * This guard is repo-scan only. It does NOT touch the database, add
 * triggers, alter RLS, alter grants, or change runtime behaviour.
 *
 * It fails if a new UPDATE/DELETE/TRUNCATE path appears against any of
 * the three tables outside the narrow, audited allowlist below.
 *
 * Allowlist (token_ledger only):
 *   - supabase/migrations/20260623124308_*  defines atomic_paid_credit_purchase
 *     and repair_skeletal_paid_credit, which promote legacy skeletal
 *     'credit' rows → 'credit_purchase'.
 *   - supabase/migrations/20260418155054_*  historical backfill UPDATEs.
 *   - supabase/migrations/20260503202233_*  historical cleanup DELETE.
 *   - this guard file itself.
 *   - the SQL proof + evidence README.
 *
 * `match_events` and `poi_events` MUST have zero allowed mutation paths.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const REPO_ROOT = process.cwd();

const SCAN_DIRS = [
  "supabase/functions",
  "supabase/migrations",
  "supabase/tests",
  "scripts",
  "src",
];

const SCAN_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".sql", ".mts", ".cts"]);

// Files that are allowed to contain a mutation pattern for token_ledger.
// Normalised to forward-slash paths relative to repo root.
const COMMON_ALLOWLIST: ReadonlyArray<string | RegExp> = [
  "src/tests/event-ledger-append-only-convention-guard.test.ts",
  "supabase/tests/event_ledger_append_only_convention_proof.sql",
  "evidence/event-ledger-append-only-convention/README.md",
  // Rollback-wrapped freeze proof for poi_events append-only trigger.
  // It seeds and attempts UPDATE/DELETE/TRUNCATE to prove the trigger
  // raises POI_EVENTS_APPEND_ONLY. Not a runtime mutation caller.
  "supabase/tests/poi_events_append_only_freeze_proof.sql",
  // Rollback-wrapped freeze proof for match_events append-only trigger.
  // It seeds and attempts UPDATE/DELETE/TRUNCATE to prove the trigger
  // raises MATCH_EVENTS_APPEND_ONLY. Not a runtime mutation caller.
  "supabase/tests/match_events_append_only_freeze_proof.sql",
];

const TOKEN_LEDGER_ALLOWLIST: ReadonlyArray<string | RegExp> = [
  ...COMMON_ALLOWLIST,
  // RPCs: atomic_paid_credit_purchase + repair_skeletal_paid_credit
  // (promote legacy skeletal 'credit' rows → 'credit_purchase').
  /^supabase\/migrations\/20260623124308_.*\.sql$/,
  // Historical, already-executed migrations.
  /^supabase\/migrations\/20260418155054_.*\.sql$/,
  /^supabase\/migrations\/20260503202233_.*\.sql$/,
  // Edge-function: credit_refund promotion mirror of the credit_purchase
  // pattern — promotes the auto-written 'credit' row produced by
  // atomic_token_credit to the canonical 'credit_refund' settlement row.
  // Guarded by UNIQUE(request_id) so exactly one settlement row exists
  // per refund reference. See token-purchase/index.ts ~L1946.
  "supabase/functions/token-purchase/index.ts",
  // Test file describing the credit_purchase UPDATE invariant.
  "supabase/functions/_shared/payment-atomicity_test.ts",
];

const MATCH_EVENTS_ALLOWLIST: ReadonlyArray<string | RegExp> = [...COMMON_ALLOWLIST];

const POI_EVENTS_ALLOWLIST: ReadonlyArray<string | RegExp> = [...COMMON_ALLOWLIST];

function buildPatterns(table: string): RegExp[] {
  // Negative lookahead `(?!\.from\()` prevents matching across an
  // intervening `.from(otherTable)` in a long chained file.
  const chainBody = `(?:(?!\\.from\\()[\\s\\S]){0,400}?`;
  return [
    new RegExp(`\\.from\\(\\s*["'\`]${table}["'\`]\\s*\\)${chainBody}\\.update\\(`, "i"),
    new RegExp(`\\.from\\(\\s*["'\`]${table}["'\`]\\s*\\)${chainBody}\\.delete\\(`, "i"),
    new RegExp(`\\.from\\(\\s*["'\`]${table}["'\`]\\s*\\)${chainBody}\\.upsert\\(`, "i"),
    new RegExp(`\\bUPDATE\\s+(?:public\\.)?${table}\\b`, "i"),
    new RegExp(`\\bDELETE\\s+FROM\\s+(?:public\\.)?${table}\\b`, "i"),
    new RegExp(`\\bTRUNCATE\\s+(?:TABLE\\s+)?(?:public\\.)?${table}\\b`, "i"),
  ];
}

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(dir, name);
    let s;
    try {
      s = statSync(full);
    } catch {
      continue;
    }
    if (s.isDirectory()) {
      if (name === "node_modules" || name === ".git" || name === "dist") continue;
      walk(full, out);
    } else if (SCAN_EXTS.has(name.slice(name.lastIndexOf(".")))) {
      out.push(full);
    }
  }
  return out;
}

function rel(p: string): string {
  return relative(REPO_ROOT, p).split(sep).join("/");
}

function isAllowed(relPath: string, allowlist: ReadonlyArray<string | RegExp>): boolean {
  return allowlist.some((entry) =>
    typeof entry === "string" ? entry === relPath : entry.test(relPath),
  );
}

function collectViolations(table: string, allowlist: ReadonlyArray<string | RegExp>) {
  const patterns = buildPatterns(table);
  const violations: { file: string; match: string }[] = [];
  const files = SCAN_DIRS.flatMap((d) => walk(join(REPO_ROOT, d)));
  for (const file of files) {
    const r = rel(file);
    if (isAllowed(r, allowlist)) continue;
    let content: string;
    try {
      content = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const re of patterns) {
      const m = content.match(re);
      if (m) {
        violations.push({ file: r, match: m[0].slice(0, 120) });
        break;
      }
    }
  }
  return violations;
}

describe("event-ledger append-only convention guard (Option A)", () => {
  it("token_ledger: no mutation paths outside skeletal paid-credit promotion/repair + historical migrations", () => {
    const v = collectViolations("token_ledger", TOKEN_LEDGER_ALLOWLIST);
    expect(
      v,
      `Unexpected token_ledger mutation site(s):\n${v.map((x) => ` - ${x.file}: ${x.match}`).join("\n")}\n` +
        `If this is a genuinely required new path, update TOKEN_LEDGER_ALLOWLIST AND add an audit trail entry ` +
        `in evidence/event-ledger-append-only-convention/README.md.`,
    ).toEqual([]);
  });

  it("match_events: zero allowed mutation paths", () => {
    const v = collectViolations("match_events", MATCH_EVENTS_ALLOWLIST);
    expect(
      v,
      `match_events must remain strictly append-only. Found:\n${v.map((x) => ` - ${x.file}: ${x.match}`).join("\n")}`,
    ).toEqual([]);
  });

  it("poi_events: zero allowed mutation paths", () => {
    const v = collectViolations("poi_events", POI_EVENTS_ALLOWLIST);
    expect(
      v,
      `poi_events must remain strictly append-only. Found:\n${v.map((x) => ` - ${x.file}: ${x.match}`).join("\n")}`,
    ).toEqual([]);
  });

  it("no edge function performs direct UPDATE/DELETE/TRUNCATE on the three ledger/event tables outside the audited allowlist", () => {
    const allowByTable: Record<string, ReadonlyArray<string | RegExp>> = {
      token_ledger: TOKEN_LEDGER_ALLOWLIST,
      match_events: MATCH_EVENTS_ALLOWLIST,
      poi_events: POI_EVENTS_ALLOWLIST,
    };
    const offenders: string[] = [];
    const fnFiles = walk(join(REPO_ROOT, "supabase/functions"));
    for (const file of fnFiles) {
      const r = rel(file);
      const content = (() => {
        try {
          return readFileSync(file, "utf8");
        } catch {
          return "";
        }
      })();
      for (const table of ["token_ledger", "match_events", "poi_events"]) {
        if (isAllowed(r, allowByTable[table])) continue;
        for (const re of buildPatterns(table)) {
          if (re.test(content)) {
            offenders.push(`${r} (${table})`);
            break;
          }
        }
      }
    }
    expect(
      offenders,
      `Edge functions must not directly mutate ledger/event tables outside the audited allowlist.\n` +
        offenders.map((o) => ` - ${o}`).join("\n"),
    ).toEqual([]);
  });

  it("guard companion artefacts exist (SQL proof + evidence README)", () => {
    const proof = readFileSync(
      join(REPO_ROOT, "supabase/tests/event_ledger_append_only_convention_proof.sql"),
      "utf8",
    );
    expect(proof).toMatch(/token_ledger/);
    expect(proof).toMatch(/match_events/);
    expect(proof).toMatch(/poi_events/);

    const readme = readFileSync(
      join(REPO_ROOT, "evidence/event-ledger-append-only-convention/README.md"),
      "utf8",
    );
    expect(readme).toMatch(/poi_events/i);
  });

  it("poi_events append-only freeze proof exists and asserts trigger behaviour", () => {
    const proof = readFileSync(
      join(REPO_ROOT, "supabase/tests/poi_events_append_only_freeze_proof.sql"),
      "utf8",
    );
    expect(proof).toMatch(/POI_EVENTS_APPEND_ONLY/);
    expect(proof).toMatch(/poi_events_no_mutate_trg/);
    expect(proof).toMatch(/poi_events_no_truncate_trg/);
    // Must be rollback-wrapped — no production rows touched.
    expect(proof).toMatch(/^\s*BEGIN\s*;/m);
    expect(proof).toMatch(/^\s*ROLLBACK\s*;/m);
  });

  it("match_events append-only freeze proof exists and asserts trigger behaviour", () => {
    const proof = readFileSync(
      join(REPO_ROOT, "supabase/tests/match_events_append_only_freeze_proof.sql"),
      "utf8",
    );
    expect(proof).toMatch(/MATCH_EVENTS_APPEND_ONLY/);
    expect(proof).toMatch(/match_events_no_mutate_trg/);
    expect(proof).toMatch(/match_events_no_truncate_trg/);
    expect(proof).toMatch(/^\s*BEGIN\s*;/m);
    expect(proof).toMatch(/^\s*ROLLBACK\s*;/m);
  });

  it("MATCH_EVENTS_ALLOWLIST contains no runtime UPDATE/DELETE/TRUNCATE callers", () => {
    const stringEntries = MATCH_EVENTS_ALLOWLIST.filter(
      (e): e is string => typeof e === "string",
    );
    for (const entry of stringEntries) {
      expect(
        entry.startsWith("src/tests/") ||
          entry.startsWith("supabase/tests/") ||
          entry.startsWith("evidence/"),
        `MATCH_EVENTS_ALLOWLIST may only contain guard/proof/README artefacts. Offender: ${entry}`,
      ).toBe(true);
    }
    const regexEntries = MATCH_EVENTS_ALLOWLIST.filter((e) => e instanceof RegExp);
    expect(
      regexEntries,
      "MATCH_EVENTS_ALLOWLIST must not contain regex entries — that would whitelist a runtime mutation caller.",
    ).toEqual([]);
  });

  it("POI_EVENTS_ALLOWLIST contains no runtime UPDATE/DELETE/TRUNCATE callers", () => {
    // Allowed entries must be limited to guard/proof/README artefacts.
    // No edge function, RPC migration, or scripts entry is permitted.
    const stringEntries = POI_EVENTS_ALLOWLIST.filter(
      (e): e is string => typeof e === "string",
    );
    for (const entry of stringEntries) {
      expect(
        entry.startsWith("src/tests/") ||
          entry.startsWith("supabase/tests/") ||
          entry.startsWith("evidence/"),
        `POI_EVENTS_ALLOWLIST may only contain guard/proof/README artefacts. Offender: ${entry}`,
      ).toBe(true);
    }
    const regexEntries = POI_EVENTS_ALLOWLIST.filter((e) => e instanceof RegExp);
    expect(
      regexEntries,
      "POI_EVENTS_ALLOWLIST must not contain regex entries — that would whitelist a runtime mutation caller.",
    ).toEqual([]);
  });

  it("match_events append-only migration creates triggers only and does not mutate rows", () => {
    const migrationsDir = join(REPO_ROOT, "supabase/migrations");
    const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql"));
    const matchingFiles = files.filter((f) => {
      const sql = readFileSync(join(migrationsDir, f), "utf8");
      return /assert_match_events_append_only/.test(sql);
    });
    expect(
      matchingFiles.length,
      "expected at least one migration defining assert_match_events_append_only",
    ).toBeGreaterThanOrEqual(1);
    for (const f of matchingFiles) {
      const sql = readFileSync(join(migrationsDir, f), "utf8");
      expect(sql).toMatch(/match_events_no_mutate_trg/);
      expect(sql).toMatch(/match_events_no_truncate_trg/);
      expect(sql).not.toMatch(/\bUPDATE\s+(public\.)?match_events\b/i);
      expect(sql).not.toMatch(/\bDELETE\s+FROM\s+(public\.)?match_events\b/i);
      expect(sql).not.toMatch(/\bTRUNCATE\s+(TABLE\s+)?(public\.)?match_events\b/i);
    }
  });
});
