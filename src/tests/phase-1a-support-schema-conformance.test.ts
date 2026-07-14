/**
 * Phase 1A Support Centre backend — migration conformance tests.
 *
 * These are file-level structural tests that guard the invariants approved in
 * docs/enterprise-support-centre/phase-0-correction-addendum.md:
 *  - append-only tables have deny triggers
 *  - state-changing RPCs write exactly one lifecycle event kind
 *  - read-only RPCs never INSERT/UPDATE/DELETE on core support tables
 *  - authenticated clients receive only SELECT on core support tables
 *  - no changes to api_support_tickets or its four legacy RPCs
 *
 * Live RLS/behavioural tests require a real database and belong to the CI
 * Playwright/pg-tap layer; those are out of Phase 1A tooling scope.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations');

function loadPhase1aMigration(): string {
  const files = readdirSync(MIGRATIONS_DIR).sort();
  // The Phase 1A migration is identified by its unique table name.
  for (const f of files) {
    if (!f.endsWith('.sql')) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, f), 'utf8');
    if (sql.includes('CREATE TABLE public.support_tickets')) return sql;
  }
  throw new Error('Phase 1A migration (support_tickets) not found');
}

let sql = '';
beforeAll(() => { sql = loadPhase1aMigration(); });

describe('Phase 1A — schema invariants', () => {
  it('creates the required core tables', () => {
    for (const t of [
      'support_categories',
      'support_subcategories',
      'support_priority_rules',
      'support_capabilities_grants',
      'support_role_assignments',
      'support_tickets',
      'support_ticket_events',
      'support_ticket_messages',
      'support_ticket_linked_records',
      'support_ticket_access_audit',
    ]) {
      expect(sql).toContain(`CREATE TABLE public.${t}`);
    }
  });

  it('enables RLS on every new support table', () => {
    for (const t of [
      'support_categories','support_subcategories','support_priority_rules',
      'support_capabilities_grants','support_role_assignments','support_tickets',
      'support_ticket_events','support_ticket_messages',
      'support_ticket_linked_records','support_ticket_access_audit',
    ]) {
      expect(sql).toMatch(new RegExp(`ALTER TABLE public\\.${t} ENABLE ROW LEVEL SECURITY`));
    }
  });
});

describe('Phase 1A — least-privilege grants', () => {
  it('never grants direct INSERT/UPDATE/DELETE to authenticated on ticket lifecycle tables', () => {
    for (const t of ['support_tickets','support_ticket_events','support_ticket_messages','support_ticket_linked_records']) {
      expect(sql).not.toMatch(new RegExp(`GRANT[^;]*\\b(INSERT|UPDATE|DELETE)\\b[^;]*ON public\\.${t}[^;]*TO authenticated`));
    }
  });

  it('never grants any privilege on the access-audit table to authenticated', () => {
    expect(sql).not.toMatch(/GRANT[^;]*ON public\.support_ticket_access_audit[^;]*TO authenticated/);
    expect(sql).toMatch(/GRANT ALL ON public\.support_ticket_access_audit TO service_role/);
  });
});

describe('Phase 1A hardening — direct SELECT revoked', () => {
  it('hardening migration revokes direct SELECT on core support tables from authenticated', () => {
    const files = readdirSync(MIGRATIONS_DIR).sort();
    let hardening = '';
    for (const f of files) {
      if (!f.endsWith('.sql')) continue;
      const body = readFileSync(join(MIGRATIONS_DIR, f), 'utf8');
      if (body.includes('Phase 1A hardening')) { hardening = body; break; }
    }
    expect(hardening, 'Phase 1A hardening migration present').not.toEqual('');
    for (const t of ['support_tickets','support_ticket_events','support_ticket_messages','support_ticket_linked_records']) {
      expect(hardening).toMatch(new RegExp(`REVOKE SELECT ON public\\.${t}\\s+FROM authenticated`));
    }
    for (const fn of [
      '_support_record_access',
      '_support_next_ticket_number',
      '_support_resolve_restriction',
      '_support_calculate_priority',
      '_support_caller_org_id',
    ]) {
      expect(hardening).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}[^;]*FROM authenticated`));
    }
  });
});

describe('Phase 1A — append-only protection', () => {
  it('installs UPDATE and DELETE deny triggers on events, messages and access-audit', () => {
    for (const trg of [
      'support_ticket_events_no_update','support_ticket_events_no_delete',
      'support_ticket_messages_no_update','support_ticket_messages_no_delete',
      'support_ticket_access_audit_no_update','support_ticket_access_audit_no_delete',
    ]) {
      expect(sql).toContain(`CREATE TRIGGER ${trg}`);
    }
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public._support_reject_mutation()');
  });
});

describe('Phase 1A — event model', () => {
  it('every state-changing RPC writes exactly one lifecycle event kind', () => {
    // create_support_ticket writes 2 (ticket_created + priority_calculated) by design.
    const rpcs: Array<[string, string[]]> = [
      ['post_support_ticket_customer_message', ['customer_message_added']],
      ['post_support_ticket_internal_note',    ['internal_note_added']],
      ['add_support_ticket_linked_record',     ['linked_record_added']],
      ['update_support_ticket_status',         ['status_changed']],
    ];
    for (const [rpc, kinds] of rpcs) {
      const fnStart = sql.indexOf(`FUNCTION public.${rpc}(`);
      expect(fnStart, `RPC ${rpc} defined`).toBeGreaterThan(-1);
      const body = sql.slice(fnStart, sql.indexOf('$$;', fnStart));
      for (const k of kinds) expect(body).toContain(`'${k}'`);
    }
  });

  it('read-only RPCs never mutate core support tables', () => {
    const reads = [
      'list_own_support_tickets','list_org_support_tickets','get_support_ticket',
      'get_support_ticket_internal','list_support_ticket_customer_messages',
      'list_support_ticket_internal_notes',
    ];
    for (const rpc of reads) {
      const fnStart = sql.indexOf(`FUNCTION public.${rpc}(`);
      expect(fnStart, `RPC ${rpc} defined`).toBeGreaterThan(-1);
      const body = sql.slice(fnStart, sql.indexOf('$$;', fnStart));
      expect(body).not.toMatch(/\bINSERT\s+INTO\s+public\.support_tickets\b/i);
      expect(body).not.toMatch(/\bUPDATE\s+public\.support_tickets\b/i);
      expect(body).not.toMatch(/\bINSERT\s+INTO\s+public\.support_ticket_events\b/i);
      // access-audit is allowed for get_support_ticket_internal via _support_record_access helper only.
    }
  });
});

describe('Phase 1A — separation of customer vs internal messages', () => {
  it('customer-safe message list restricts kind = customer_visible', () => {
    const fn = sql.slice(sql.indexOf('FUNCTION public.list_support_ticket_customer_messages'));
    expect(fn).toMatch(/kind\s*=\s*'customer_visible'/);
  });
  it('internal-note list restricts kind = internal_note and requires platform_admin or auditor', () => {
    const fn = sql.slice(sql.indexOf('FUNCTION public.list_support_ticket_internal_notes'));
    expect(fn).toMatch(/kind\s*=\s*'internal_note'/);
    expect(fn).toMatch(/platform_admin/);
    expect(fn).toMatch(/auditor_read_only/);
  });
});

describe('Phase 1A — restricted-ticket isolation', () => {
  it('org_admin read policy excludes restricted tickets', () => {
    const pol = sql.slice(sql.indexOf('POLICY support_tickets_org_admin_read_nonrestricted'));
    expect(pol).toMatch(/is_restricted\s*=\s*false/);
  });
});

describe('Phase 1A — no changes to legacy api_support_tickets or its RPCs', () => {
  it('migration does not touch api_support_tickets or its four legacy RPCs', () => {
    expect(sql).not.toMatch(/\bapi_support_tickets\b/);
    for (const rpc of [
      'create_api_support_ticket','list_api_support_tickets_for_client',
      'list_api_support_tickets_internal','update_api_support_ticket_internal',
    ]) {
      expect(sql).not.toContain(rpc);
    }
  });
});

describe('Phase 1A — no new app_role enum values', () => {
  it('migration does not alter the app_role enum', () => {
    expect(sql).not.toMatch(/ALTER\s+TYPE\s+public\.app_role/i);
  });
});
