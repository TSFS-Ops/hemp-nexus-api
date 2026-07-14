/**
 * Phase 1A — customer-safe projection regression guard.
 *
 * Purpose: prove that the corrective migration
 *   supabase/migrations/20260714210000_... (customer-safe projections)
 * has NOT been reverted or re-widened to `SETOF public.support_tickets`
 * / `SETOF public.support_ticket_messages`.
 *
 * This is a file-level static test — it inspects the migration SQL rather
 * than the live database, so it runs unconditionally in the default vitest
 * suite. If a future migration re-widens a customer-facing RPC, this fails
 * before Phase 1B code can build on the leaking shape.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations');

function loadAllSupportMigrations(): string {
  return readdirSync(MIGRATIONS_DIR)
    .sort()
    .filter((f) => f.endsWith('.sql'))
    .map((f) => readFileSync(join(MIGRATIONS_DIR, f), 'utf8'))
    .join('\n\n-- FILE BOUNDARY --\n\n');
}

let combined = '';
beforeAll(() => { combined = loadAllSupportMigrations(); });

/** Extract the LAST definition (winning definition) of a function by name. */
function lastDefinitionOf(fnName: string): string | null {
  const re = new RegExp(
    `CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${fnName}\\s*\\([^)]*\\)[\\s\\S]*?(?=CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION|--\\s*FILE\\s+BOUNDARY|$)`,
    'gi',
  );
  const matches = combined.match(re);
  return matches && matches.length ? matches[matches.length - 1] : null;
}

describe('Phase 1A — customer-safe projection regression', () => {
  const CUSTOMER_FACING = [
    'list_own_support_tickets',
    'list_org_support_tickets',
    'list_support_ticket_customer_messages',
    'list_support_ticket_internal_notes',
    'get_support_ticket_internal',
  ];

  for (const fn of CUSTOMER_FACING) {
    it(`${fn} — last definition returns an explicit TABLE(...) projection, not SETOF`, () => {
      const def = lastDefinitionOf(fn);
      expect(def, `no definition of ${fn} found in migrations`).toBeTruthy();
      expect(def!, `${fn} must not RETURN SETOF support_tickets/messages/linked_records`).not.toMatch(
        /RETURNS\s+SETOF\s+public\.(support_tickets|support_ticket_messages|support_ticket_linked_records)/i,
      );
      expect(def!, `${fn} must RETURN TABLE (...) with explicit columns`).toMatch(
        /RETURNS\s+TABLE\s*\(/i,
      );
    });
  }

  it('customer message projection does not expose author_user_id column', () => {
    const def = lastDefinitionOf('list_support_ticket_customer_messages');
    expect(def).toBeTruthy();
    // Header must declare author_is_self boolean, not author_user_id.
    const header = def!.split('$$')[0];
    expect(header).toMatch(/author_is_self\s+boolean/i);
    expect(header).not.toMatch(/author_user_id\s+uuid/i);
  });

  it('customer ticket projections do not expose internal audit columns', () => {
    for (const fn of ['list_own_support_tickets', 'list_org_support_tickets']) {
      const def = lastDefinitionOf(fn)!;
      const header = def.split('$$')[0];
      for (const forbidden of [
        'on_behalf_of_user_id',
        'on_behalf_of_reason',
        'priority_source',
        'priority_rules_version',
        'restriction_class',
        'safe_context',
        'contact_email',
        'contact_name',
        'created_by',
        'funder_org_id',
        'source',
      ]) {
        expect(header, `${fn} header must not list ${forbidden}`).not.toMatch(
          new RegExp(`\\b${forbidden}\\b`, 'i'),
        );
      }
    }
  });

  it('_support_rpc_result_signature helper exists (developer regression tool) and is not granted to authenticated', () => {
    expect(combined).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\._support_rpc_result_signature/i);
    expect(combined).toMatch(/REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\._support_rpc_result_signature\(text\)\s+FROM\s+PUBLIC/i);
    // Must NOT contain a grant to authenticated for this helper.
    expect(combined).not.toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\._support_rpc_result_signature\([^)]*\)\s+TO\s+authenticated/i);
  });

  it('add_support_ticket_linked_record last definition disables every non-inert kind', () => {
    // Phase 1A CI hardening: only record_kind = 'other' may be inserted.
    // The last definition of the RPC must contain a guard that raises
    // 42501 for any other kind, or a Phase 1B change has re-opened the
    // weak linked-record path before per-kind ACLs are in place.
    const def = lastDefinitionOf('add_support_ticket_linked_record');
    expect(def, 'add_support_ticket_linked_record not found').toBeTruthy();
    expect(def!).toMatch(/_record_kind\s*<>\s*'other'::public\.support_linked_record_kind/i);
    expect(def!).toMatch(/ERRCODE\s*=\s*'42501'/i);
    expect(def!).toMatch(/not permitted in Phase 1A/i);
  });
});
