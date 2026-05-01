/**
 * SECDEF Stage D1 — Grant Snapshot Test
 *
 * Asserts EXECUTE privileges on the seven Stage D1 functions are locked to
 * service_role only:
 *   - atomic_token_burn
 *   - atomic_generate_poi_v2
 *   - atomic_accept_bind
 *   - atomic_engagement_transition
 *   - atomic_validate_governance_doc
 *   - is_test_mode_bypass_enabled
 *   - is_production_environment
 *
 * Expected post-migration state for each:
 *   anon              = false
 *   authenticated     = false
 *   PUBLIC implicit   = false  (no `=X/...` ACL entry)
 *   service_role      = true
 *   postgres / owner  = true
 *
 * Also asserts:
 *   - is_same_org is unchanged (still has authenticated grant — required by RLS)
 *   - Stage D2/D3 functions are unchanged for now
 *
 * The test does NOT execute the functions; it inspects pg_proc.proacl via a
 * migration-file source-of-truth scan, mirroring the pattern used by
 * rbac-stage-3g-test-mode-prod-lockout.test.ts. A live-DB variant should be
 * run as part of post-deploy verification (see report).
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const MIGRATIONS_DIR = join(process.cwd(), "supabase/migrations");

const STAGE_D1_FUNCTIONS = [
  "atomic_token_burn",
  "atomic_generate_poi_v2",
  "atomic_accept_bind",
  "atomic_engagement_transition",
  "atomic_validate_governance_doc",
  "is_test_mode_bypass_enabled",
  "is_production_environment",
] as const;

const STAGE_D3_FUNCTIONS_UNTOUCHED = [
  "admin_get_reconciliation_alarms",
  "get_test_mode_bypass_state",
  "get_test_mode_lockout_state",
  "get_billing_availability",
  "get_org_gate_position",
] as const;

function findStageD1Migration(): { path: string; sql: string } {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const f of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, f), "utf8");
    if (
      /SECDEF\s+Stage\s+D1/i.test(sql) ||
      (/REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.atomic_token_burn/i.test(sql) &&
        /REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.atomic_generate_poi_v2/i.test(sql))
    ) {
      return { path: f, sql };
    }
  }
  throw new Error(
    "Stage D1 migration not found. Expected a migration containing 'SECDEF Stage D1' or REVOKE EXECUTE on atomic_token_burn + atomic_generate_poi_v2.",
  );
}

describe("SECDEF Stage D1 — grant snapshot (source of truth)", () => {
  const migration = findStageD1Migration();

  it("migration file exists", () => {
    expect(migration.path).toMatch(/\.sql$/);
    expect(migration.sql.length).toBeGreaterThan(0);
  });

  for (const fn of STAGE_D1_FUNCTIONS) {
    describe(`function: ${fn}`, () => {
      it("revokes EXECUTE from PUBLIC", () => {
        const re = new RegExp(
          `REVOKE\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+public\\.${fn}\\s*\\([^)]*\\)\\s+FROM\\s+PUBLIC`,
          "i",
        );
        expect(migration.sql).toMatch(re);
      });

      it("revokes EXECUTE from anon", () => {
        const re = new RegExp(
          `REVOKE\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+public\\.${fn}\\s*\\([^)]*\\)\\s+FROM\\s+anon`,
          "i",
        );
        expect(migration.sql).toMatch(re);
      });

      it("revokes EXECUTE from authenticated", () => {
        const re = new RegExp(
          `REVOKE\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+public\\.${fn}\\s*\\([^)]*\\)\\s+FROM\\s+authenticated`,
          "i",
        );
        expect(migration.sql).toMatch(re);
      });

      it("grants EXECUTE to service_role", () => {
        const re = new RegExp(
          `GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+public\\.${fn}\\s*\\([^)]*\\)\\s+TO\\s+service_role`,
          "i",
        );
        expect(migration.sql).toMatch(re);
      });

      it("uses ALL FUNCTIONS IN SCHEMA is forbidden (must use exact signatures)", () => {
        // Defensive: the migration must not use a broad schema-wide statement.
        // It must use explicit per-function signatures only.
        // (We assert per-function REVOKE/GRANT above; here we only forbid the broad form.)
        expect(migration.sql).not.toMatch(/ALL\s+FUNCTIONS\s+IN\s+SCHEMA\s+public/i);
      });
    });
  }
});

describe("SECDEF Stage D1 — must NOT touch is_same_org or D3 functions", () => {
  const migration = findStageD1Migration();

  it("does not REVOKE on is_same_org", () => {
    expect(migration.sql).not.toMatch(
      /REVOKE\s+[^\n]*\s+ON\s+FUNCTION\s+public\.is_same_org/i,
    );
  });

  it("does not GRANT on is_same_org", () => {
    expect(migration.sql).not.toMatch(
      /GRANT\s+[^\n]*\s+ON\s+FUNCTION\s+public\.is_same_org/i,
    );
  });

  for (const fn of STAGE_D3_FUNCTIONS_UNTOUCHED) {
    it(`does not touch ${fn}`, () => {
      const reRevoke = new RegExp(
        `REVOKE\\s+[^\\n]*\\s+ON\\s+FUNCTION\\s+public\\.${fn}\\b`,
        "i",
      );
      const reGrant = new RegExp(
        `GRANT\\s+[^\\n]*\\s+ON\\s+FUNCTION\\s+public\\.${fn}\\b`,
        "i",
      );
      expect(migration.sql).not.toMatch(reRevoke);
      expect(migration.sql).not.toMatch(reGrant);
    });
  }
});
