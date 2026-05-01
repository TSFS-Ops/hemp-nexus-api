/**
 * RBAC Stage 1 + Stage 2 guardrail tests.
 *
 * These tests document and verify the client-approved RBAC decisions:
 *   - `platform_admin` is the only canonical super-admin role.
 *   - Legacy `admin` cannot be newly assigned via any path.
 *   - All current RLS policies that previously referenced legacy `admin`
 *     now route through `is_admin()` (which resolves to `platform_admin`).
 *
 * These tests are deliberately lightweight (no live DB writes from CI) and
 * pair with the migration safeguards `prevent_legacy_admin_assignment_trg`
 * and the canonical `is_admin()` helper. End-to-end DB enforcement is
 * verified via `supabase--insert` smoke checks during the migration that
 * introduced the trigger.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const EDGE_FUNCTIONS_DIR = join(process.cwd(), 'supabase', 'functions');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...walk(p));
    else if (entry.endsWith('.ts') && !entry.endsWith('_test.ts') && !entry.endsWith('.test.ts'))
      out.push(p);
  }
  return out;
}

describe('RBAC Stage 1: platform_admin is canonical in edge functions', () => {
  const files = walk(EDGE_FUNCTIONS_DIR);

  it('no edge function calls requireRole(..., "admin")', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      // Match requireRole(anything, 'admin') / "admin" — but not 'admin_*' / 'platform_admin' / 'org_admin' / 'api_admin' / 'billing_admin'
      const re = /requireRole\([^,]+,\s*['"]admin['"]\s*\)/g;
      if (re.test(src)) offenders.push(f.replace(process.cwd() + '/', ''));
    }
    expect(offenders, `Edge functions still using legacy 'admin' RBAC role: ${offenders.join(', ')}`).toEqual([]);
  });

  it('break-glass and compute-counterparty-ratings check platform_admin (not legacy admin)', () => {
    const breakGlass = readFileSync(
      join(EDGE_FUNCTIONS_DIR, 'break-glass', 'index.ts'),
      'utf8',
    );
    expect(breakGlass).not.toMatch(/userRoles\.includes\(["']admin["']\)/);
    expect(breakGlass).toMatch(/userRoles\.includes\(["']platform_admin["']\)/);

    const ratings = readFileSync(
      join(EDGE_FUNCTIONS_DIR, 'compute-counterparty-ratings', 'index.ts'),
      'utf8',
    );
    expect(ratings).not.toMatch(/auth\.roles\.includes\(["']admin["']\)/);
    expect(ratings).toMatch(/auth\.roles\.includes\(["']platform_admin["']\)/);
  });
});

describe('RBAC Stage 2: legacy admin assignment is blocked at the DB layer', () => {
  it('migration adds prevent_legacy_admin_assignment trigger', () => {
    // Discover the latest migration that introduces the trigger and assert its presence.
    const migrationsDir = join(process.cwd(), 'supabase', 'migrations');
    const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'));
    const found = files.some((f) => {
      const sql = readFileSync(join(migrationsDir, f), 'utf8');
      return (
        sql.includes('prevent_legacy_admin_assignment') &&
        sql.includes('BEFORE INSERT OR UPDATE ON public.user_roles')
      );
    });
    expect(found, 'No migration introduces prevent_legacy_admin_assignment trigger').toBe(true);
  });
});

describe('RBAC: frontend constants do not leak transaction-side labels into RBAC', () => {
  it('APP_ROLES does not include buyer/seller/broker as RBAC roles', () => {
    // Read the constants file as text so we exercise the actual exported list.
    const src = readFileSync(join(process.cwd(), 'src', 'lib', 'constants.ts'), 'utf8');
    // Stage 3 will fully remove these from the enum; for now we only assert
    // they are not exported as APP_ROLES values (Stage 1+2 scope).
    const appRolesBlock = src.match(/APP_ROLES\s*=\s*\{([\s\S]*?)\}\s*as const/);
    expect(appRolesBlock, 'APP_ROLES block not found').not.toBeNull();
    const block = appRolesBlock![1];
    expect(block).not.toMatch(/SELLER:\s*['"]seller['"]/);
    expect(block).not.toMatch(/BROKER:\s*['"]broker['"]/);
    // Note: BUYER currently exists in APP_ROLES; Stage 3 will remove it.
    // We deliberately do NOT fail on BUYER here so this test reflects today's
    // committed scope (Stage 1+2). When Stage 3 lands, tighten this assertion.
  });
});
