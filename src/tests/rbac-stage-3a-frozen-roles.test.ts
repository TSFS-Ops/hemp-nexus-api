/**
 * RBAC Stage 3A — Frozen Role Assignment Block.
 *
 * Verifies via migration-source inspection (CI-safe, no live DB writes) that:
 *   - The latest frozen-role trigger covers all 6 frozen roles:
 *       admin, api_admin, billing_admin, buyer, seller, broker
 *   - The trigger is BEFORE INSERT OR UPDATE on public.user_roles
 *   - The change_org_member_role RPC still allows only org_member / org_admin
 *   - director, compliance_analyst, legal_reviewer, auditor are NOT in the
 *     frozen list (per Stage 3 plan: kept as controlled roles, not parked)
 *
 * End-to-end DB enforcement is verified at runtime in
 * src/tests/uat/journey-2b-rbac-runtime.test.ts.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations');

function findFrozenRoleMigration(): string {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .reverse();
  for (const f of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, f), 'utf8');
    if (
      sql.includes('prevent_frozen_role_assignment') &&
      sql.includes('BEFORE INSERT OR UPDATE ON public.user_roles')
    ) {
      return sql;
    }
  }
  throw new Error('No migration introduces prevent_frozen_role_assignment trigger');
}

describe('RBAC Stage 3A: frozen-role assignment block', () => {
  const sql = findFrozenRoleMigration();

  const FROZEN_ROLES = ['admin', 'api_admin', 'billing_admin', 'buyer', 'seller', 'broker'];
  for (const role of FROZEN_ROLES) {
    it(`migration freezes role: ${role}`, () => {
      // The frozen list is declared as a SQL string array literal.
      expect(sql).toMatch(new RegExp(`'${role}'`));
    });
  }

  it('trigger fires BEFORE INSERT OR UPDATE on user_roles', () => {
    expect(sql).toMatch(/CREATE TRIGGER\s+prevent_frozen_role_assignment_trg/);
    expect(sql).toMatch(/BEFORE INSERT OR UPDATE ON public\.user_roles/);
  });

  it('trigger preserves no-op updates on existing frozen-role rows', () => {
    // Block-on-update is gated by OLD.role IS DISTINCT FROM NEW.role so the
    // surviving api_admin row can be re-saved without false positives.
    expect(sql).toMatch(/OLD\.role IS DISTINCT FROM NEW\.role/);
  });

  it('migration drops the legacy admin-only trigger and function', () => {
    expect(sql).toMatch(/DROP TRIGGER IF EXISTS prevent_legacy_admin_assignment_trg/);
    expect(sql).toMatch(/DROP FUNCTION IF EXISTS public\.prevent_legacy_admin_assignment/);
  });

  // Roles that must NOT be frozen (per Stage 3 plan).
  const KEPT_ROLES = ['director', 'compliance_analyst', 'legal_reviewer', 'auditor', 'platform_admin', 'org_admin', 'org_member'];
  for (const role of KEPT_ROLES) {
    it(`role is not frozen by Stage 3A: ${role}`, () => {
      // Frozen list is declared inside an ARRAY[...] literal. Make sure the
      // role doesn't appear inside the frozen-roles ARRAY block.
      const frozenBlockMatch = sql.match(/v_frozen_roles\s+text\[\]\s*:=\s*ARRAY\[([\s\S]*?)\];/);
      expect(frozenBlockMatch, 'frozen-roles array literal not found').toBeTruthy();
      const block = frozenBlockMatch![1];
      expect(block).not.toMatch(new RegExp(`'${role}'`));
    });
  }
});

describe('RBAC Stage 3A: change_org_member_role allowlist unchanged', () => {
  it('RPC still restricts allowed roles to org_member + org_admin', () => {
    // Find the most recent migration that defines change_org_member_role and
    // confirm the allowlist is unchanged.
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort()
      .reverse();
    let found = false;
    for (const f of files) {
      const sql = readFileSync(join(MIGRATIONS_DIR, f), 'utf8');
      if (sql.includes('FUNCTION public.change_org_member_role')) {
        // The allowlist should still be ['org_member', 'org_admin'].
        expect(sql).toMatch(/v_allowed_roles\s+text\[\]\s*:=\s*ARRAY\[\s*'org_member'\s*,\s*'org_admin'\s*\]/);
        found = true;
        break;
      }
    }
    expect(found, 'change_org_member_role definition not found').toBe(true);
  });
});
