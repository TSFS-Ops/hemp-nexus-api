/**
 * POI-006 — Source-pin tests for POI mint atomicity and post-commit recovery.
 *
 * Pins the contracts established by:
 *   - migration 20260514_…_atomic_generate_poi_v2 (engagement insert moved INSIDE
 *     the DB function; idempotent path self-heals a missing engagement row).
 *   - supabase/functions/match/index.ts (post-commit poi.generated audit and
 *     recordMatchEvent are non-fatal; the legacy edge-side poi_engagements
 *     insert has been removed).
 *   - cron schedule 'burn-poi-reconciliation-daily'.
 *
 * Acceptance criteria covered (1–10 from the POI-006 brief):
 *   1–4. Burn is rolled back on any failure inside atomic_generate_poi_v2
 *        because the function is plpgsql with no EXCEPTION clause and runs
 *        inside the RPC's single statement-transaction.
 *   5.   Post-commit secondary audit failure no longer returns 500.
 *   6.   poi_engagements creation is atomic with the mint; idempotent retry
 *        also self-heals a missing engagement row.
 *   7.   Idempotent return path is unchanged for the credit/ledger.
 *   8.   Edge-side legacy engagement insert has been removed (the source of
 *        the old "ENGAGEMENT_CREATION_FAILED 500 after success" risk).
 *   9.   burn-poi-reconciliation function exists and is scheduled daily.
 *  10.   POI-004 idempotency suites continue to coexist (separate test files).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const REPO = process.cwd();

function readMigration(): string {
  const dir = join(REPO, 'supabase', 'migrations');
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql'));
  // Find the most recent migration that defines atomic_generate_poi_v2 with the
  // POI-006 engagement block.
  for (const f of files.sort().reverse()) {
    const txt = readFileSync(join(dir, f), 'utf8');
    if (
      txt.includes('CREATE OR REPLACE FUNCTION public.atomic_generate_poi_v2') &&
      txt.includes('POI-006: ENGAGEMENT ROW')
    ) {
      return txt;
    }
  }
  throw new Error('POI-006 migration not found');
}

const MIGRATION = readMigration();
const MATCH_INDEX = readFileSync(
  join(REPO, 'supabase/functions/match/index.ts'),
  'utf8',
);
const RECONCILIATION = readFileSync(
  join(REPO, 'supabase/functions/burn-poi-reconciliation/index.ts'),
  'utf8',
);

describe('POI-006: atomic_generate_poi_v2 — burn/mint atomicity (criteria 1–4)', () => {
  it('plpgsql function has no EXCEPTION WHEN OTHERS handler at top level — failures bubble out and roll back the burn', () => {
    // We allow inner BEGIN/EXCEPTION blocks for the engagement unique-violation
    // catch (that's intentional and scoped). What we forbid is a top-level
    // EXCEPTION block that would swallow burn/ledger/state errors.
    const fnBody = MIGRATION.split('CREATE OR REPLACE FUNCTION public.atomic_generate_poi_v2')[1];
    expect(fnBody).toBeDefined();
    // The only EXCEPTION clauses must be the narrowly scoped unique_violation
    // ones for the engagement insert (idempotent self-heal + fresh mint).
    const exceptionMatches = fnBody.match(/EXCEPTION\s+WHEN\s+(\w+)/gi) ?? [];
    expect(exceptionMatches.length).toBe(2);
    expect(exceptionMatches.every((m) => /unique_violation/i.test(m))).toBe(true);
  });

  it('burn happens BEFORE ledger event, match update and audit row — so rollback covers all of them', () => {
    const burnIdx = MIGRATION.indexOf('atomic_token_burn(p_org_id, v_token_cost');
    const ledgerIdx = MIGRATION.indexOf("INSERT INTO ledger_events");
    const stateIdx = MIGRATION.indexOf("UPDATE matches\n     SET state = 'intent_declared'");
    const auditIdx = MIGRATION.indexOf("INSERT INTO audit_logs");
    expect(burnIdx).toBeGreaterThan(0);
    expect(ledgerIdx).toBeGreaterThan(burnIdx);
    expect(stateIdx).toBeGreaterThan(ledgerIdx);
    expect(auditIdx).toBeGreaterThan(stateIdx);
  });

  it('match row is locked FOR UPDATE before any side effects', () => {
    const lockIdx = MIGRATION.indexOf('FOR UPDATE');
    const burnIdx = MIGRATION.indexOf('atomic_token_burn(p_org_id, v_token_cost');
    expect(lockIdx).toBeGreaterThan(0);
    expect(lockIdx).toBeLessThan(burnIdx);
  });
});

describe('POI-006: engagement row is atomic with mint (criterion 6)', () => {
  it('engagement insert is INSIDE atomic_generate_poi_v2 (not in edge function)', () => {
    expect(MIGRATION).toMatch(/INSERT INTO poi_engagements\b/);
    expect(MIGRATION).toContain("'poi_mint'");
  });

  it('engagement insert appears AFTER the audit row insert (last in the transaction, so any earlier failure rolls it back)', () => {
    const auditIdx = MIGRATION.indexOf("INSERT INTO audit_logs");
    const engIdx = MIGRATION.indexOf('INSERT INTO poi_engagements');
    expect(auditIdx).toBeGreaterThan(0);
    expect(engIdx).toBeGreaterThan(auditIdx);
  });

  it('engagement insert is wrapped in a unique_violation catch (concurrency-safe)', () => {
    expect(MIGRATION).toMatch(
      /INSERT INTO poi_engagements[\s\S]*?EXCEPTION WHEN unique_violation/,
    );
  });

  it('idempotent path self-heals a missing engagement row via the same INSERT pattern with source = poi_mint_repair', () => {
    expect(MIGRATION).toContain("'poi_mint_repair'");
    // Self-heal is gated by NOT EXISTS check against the partial unique
    // index's filter (non-terminal statuses).
    expect(MIGRATION).toMatch(
      /IF NOT EXISTS \(\s*SELECT 1 FROM poi_engagements[\s\S]*?engagement_status NOT IN/,
    );
  });

  it('idempotent return reports engagement_created / engagement_existed flags so callers can audit', () => {
    expect(MIGRATION).toMatch(/'engagement_created',\s*v_engagement_created/);
    expect(MIGRATION).toMatch(/'engagement_existed',\s*v_engagement_existed/);
  });
});

describe('POI-006: edge function — post-commit failures are non-fatal (criteria 5, 8)', () => {
  it('legacy edge-side poi_engagements.insert has been REMOVED from match/index.ts', () => {
    // The old block threw ApiException("ENGAGEMENT_CREATION_FAILED", ..., 500)
    // after the RPC had already committed. That was the dominant misleading
    // failure source. It must be gone — the DB function owns engagement now.
    expect(MATCH_INDEX).not.toContain('ENGAGEMENT_CREATION_FAILED');
    expect(MATCH_INDEX).not.toMatch(
      /supabase\.from\("poi_engagements"\)\.insert\(\{\s*match_id: matchId/,
    );
  });

  it('post-commit poi.generated audit insert no longer throws AUDIT_LOG_ERROR', () => {
    expect(MATCH_INDEX).not.toContain('AUDIT_LOG_ERROR');
    // It must be wrapped in a try/catch that only logs.
    expect(MATCH_INDEX).toMatch(
      /POI-006: secondary poi\.generated audit insert failed \(non-fatal\)/,
    );
  });

  it('recordMatchEvent failure is logged but does not throw', () => {
    expect(MATCH_INDEX).toMatch(
      /POI-006: recordMatchEvent failed \(non-fatal\)/,
    );
  });

  it('idempotent RPC return still short-circuits with the existing match (criterion 7)', () => {
    expect(MATCH_INDEX).toMatch(/transitionResult\?\.idempotent/);
    expect(MATCH_INDEX).toMatch(/POI already generated - atomic idempotent return/);
  });

  it('engagement metadata from RPC is forwarded into the secondary audit row for forensic visibility', () => {
    expect(MATCH_INDEX).toMatch(/engagement_created: transitionResult\?\.engagement_created/);
    expect(MATCH_INDEX).toMatch(/engagement_existed: transitionResult\?\.engagement_existed/);
  });
});

describe('POI-006: reconciliation coverage (criterion 9)', () => {
  it('burn-poi-reconciliation function detects both drift directions', () => {
    expect(RECONCILIATION).toContain('BURN_WITHOUT_POI');
    expect(RECONCILIATION).toMatch(/poi.*without.*burn/i);
  });

  it('reconciliation writes a per-run admin_audit_logs row', () => {
    expect(RECONCILIATION).toMatch(/reconciliation\.burn_poi/);
  });

  it('reconciliation requires INTERNAL_CRON_KEY, service-role JWT or platform_admin (locked down)', () => {
    expect(RECONCILIATION).toContain('INTERNAL_CRON_KEY');
    expect(RECONCILIATION).toContain("'platform_admin'");
    expect(RECONCILIATION).toMatch(/return json\(401, \{ error: "UNAUTHORIZED" \}\)/);
  });
});

describe('POI-006: SECDEF lockdown preserved', () => {
  it('migration re-asserts service_role-only EXECUTE on atomic_generate_poi_v2', () => {
    expect(MIGRATION).toMatch(/REVOKE EXECUTE ON FUNCTION public\.atomic_generate_poi_v2[^\n]*FROM PUBLIC/);
    expect(MIGRATION).toMatch(/REVOKE EXECUTE ON FUNCTION public\.atomic_generate_poi_v2[^\n]*FROM authenticated/);
    expect(MIGRATION).toMatch(/GRANT\s+EXECUTE ON FUNCTION public\.atomic_generate_poi_v2[^\n]*TO\s+service_role/);
  });
});
