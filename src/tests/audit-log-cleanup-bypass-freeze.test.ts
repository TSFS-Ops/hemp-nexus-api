/**
 * Audit-log session-variable bypass — FREEZE guard (Option A).
 *
 * The trigger function `public.assert_audit_immutable()` allows UPDATE/DELETE
 * on `public.audit_logs` and `public.admin_audit_logs` when the session GUC
 *   `app.allow_audit_cleanup = 'on'`
 * is set. Inspection found no repo caller activates it. This guard freezes
 * that contract: any new caller anywhere in the repo (edge function, cron,
 * RPC migration, script, admin/client UI) must trip CI so the bypass cannot
 * silently re-enter the codebase without a deliberate Option-B hardening
 * decision (narrow audited SECURITY DEFINER cleanup RPC + TRUNCATE + event-
 * trigger protection).
 *
 * Scope: presentation/contract guard only. Does NOT touch database, RLS,
 * grants, triggers, the GUC, payments, refunds, POI, WaD, registry,
 * lifecycle, cron, or reconciliation.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, extname, relative } from "node:path";

const ROOT = process.cwd();

const SCAN_DIRS = [
  join(ROOT, "src"),
  join(ROOT, "supabase", "functions"),
  join(ROOT, "supabase", "migrations"),
  join(ROOT, "supabase", "tests"),
  join(ROOT, "scripts"),
];

const ALLOWED_EXT = new Set([
  ".ts", ".tsx", ".js", ".mjs", ".cjs", ".sql", ".md",
]);

/**
 * Files that are PERMITTED to mention `app.allow_audit_cleanup`. Anything
 * else is a freeze violation.
 *
 *  - The original migration that defines the trigger and reads the GUC.
 *  - The policy/capability doc that names the GUC as an outstanding risk.
 *  - This guard file itself.
 *  - The SQL proof file that documents (but does not exercise) the bypass.
 *  - The freeze evidence README.
 */
const ALLOWLIST = new Set<string>([
  "supabase/migrations/20260516173105_defd936d-71d5-4c0a-a6a5-ff0583ca66eb.sql",
  "src/lib/policy/audit-ledger-capability.ts",
  "src/tests/audit-log-cleanup-bypass-freeze.test.ts",
  "supabase/tests/audit_log_immutability_freeze_proof.sql",
  "evidence/audit-log-immutability-bypass-freeze/README.md",
]);

const BYPASS_NEEDLE = "allow_audit_cleanup";

function walk(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) walk(full, acc);
    else if (ALLOWED_EXT.has(extname(full))) acc.push(full);
  }
  return acc;
}

describe("Audit-log cleanup bypass freeze guard", () => {
  it("only the allowlisted files mention app.allow_audit_cleanup", () => {
    const violations: string[] = [];
    const files = SCAN_DIRS.flatMap((d) => walk(d));
    // Also explicitly include the evidence README if present.
    const evidenceReadme = join(
      ROOT,
      "evidence",
      "audit-log-immutability-bypass-freeze",
      "README.md",
    );
    if (existsSync(evidenceReadme)) files.push(evidenceReadme);

    for (const file of files) {
      const rel = relative(ROOT, file).replaceAll("\\", "/");
      const body = readFileSync(file, "utf8");
      if (!body.includes(BYPASS_NEEDLE)) continue;
      if (ALLOWLIST.has(rel)) continue;
      violations.push(rel);
    }

    expect(
      violations,
      [
        "New caller(s) of app.allow_audit_cleanup detected outside the freeze allowlist.",
        "The raw GUC bypass is overbroad and unaudited. Do NOT add new callers.",
        "End-state (Option B) is a narrow audited SECURITY DEFINER cleanup RPC.",
        "Offending files:\n  - " + violations.join("\n  - "),
      ].join("\n"),
    ).toEqual([]);
  });

  it("trigger contract is intact in migration text", () => {
    const migPath = join(
      ROOT,
      "supabase",
      "migrations",
      "20260516173105_defd936d-71d5-4c0a-a6a5-ff0583ca66eb.sql",
    );
    const sql = readFileSync(migPath, "utf8");

    // Function exists.
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.assert_audit_immutable\(\)/,
    );
    // Both triggers exist on the two audit tables.
    expect(sql).toMatch(/CREATE TRIGGER audit_logs_no_mutate_trg/);
    expect(sql).toMatch(/CREATE TRIGGER admin_audit_logs_no_mutate_trg/);
    // Triggers fire on UPDATE and DELETE.
    const trgBlocks = sql.match(
      /BEFORE UPDATE OR DELETE ON public\.(audit_logs|admin_audit_logs)/g,
    ) ?? [];
    expect(trgBlocks.length).toBe(2);
    // Error contract.
    expect(sql).toMatch(/AUDIT_IMMUTABLE/);
    // The GUC is read only inside the trigger function definition.
    const gucMatches = sql.match(/allow_audit_cleanup/g) ?? [];
    // 1× comment + 1× current_setting + 1× function comment = 3 occurrences
    // in the migration text. Hard-floor at 1, soft-ceiling at 5 to allow
    // future doc comment touch-ups without breaking the freeze.
    expect(gucMatches.length).toBeGreaterThanOrEqual(1);
    expect(gucMatches.length).toBeLessThanOrEqual(5);
  });

  it("policy doc continues to flag the GUC bypass as outstanding", () => {
    const policy = readFileSync(
      join(ROOT, "src", "lib", "policy", "audit-ledger-capability.ts"),
      "utf8",
    );
    expect(policy).toMatch(/allow_audit_cleanup/);
    expect(policy).toMatch(/IMMUTABILITY_BACKEND_ENFORCED\s*=\s*false/);
  });

  it("SQL freeze proof file is present", () => {
    const proof = join(
      ROOT,
      "supabase",
      "tests",
      "audit_log_immutability_freeze_proof.sql",
    );
    expect(existsSync(proof)).toBe(true);
    const body = readFileSync(proof, "utf8");
    // Proof must NOT set the bypass — it proves the default-blocked contract.
    expect(body).not.toMatch(/SET\s+(LOCAL\s+)?app\.allow_audit_cleanup\s*=\s*'on'/i);
    // Proof must reference both trigger names and the error contract.
    expect(body).toMatch(/audit_logs_no_mutate_trg/);
    expect(body).toMatch(/admin_audit_logs_no_mutate_trg/);
    expect(body).toMatch(/AUDIT_IMMUTABLE/);
    // Proof must roll back, never commit.
    expect(body).toMatch(/ROLLBACK/i);
    expect(body).not.toMatch(/^\s*COMMIT\s*;/im);
  });
});
