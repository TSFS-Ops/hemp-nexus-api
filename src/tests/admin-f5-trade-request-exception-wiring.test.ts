/**
 * Batch F5 — static wiring guard for trade-request exception admin
 * endpoints. Mirrors F4 guard.
 *
 * Asserts each endpoint:
 *   1. Calls its atomic *_with_governance wrapper RPC.
 *   2. No longer calls the legacy split-commit pair (direct mutation RPC
 *      and recordAdminHqDecision afterwards).
 *   3. Still imports assertAal2 and enforces platform_admin.
 *   4. Surfaces governance_event_id and deduplicated from the atomic
 *      response.
 *
 * If anyone re-introduces the decision-then-governance sequence (the gap
 * Batch F5 closes) this test fails.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const fnPath = (name: string) =>
  resolve(__dirname, `../../supabase/functions/${name}/index.ts`);

const CASES = [
  [
    'admin-trade-request-exception-hold-release',
    'admin_trade_request_exception_hold_release_with_governance',
    'admin_release_trade_request_exception_hold',
  ],
  [
    'admin-trade-request-archive-override',
    'admin_trade_request_archive_override_with_governance',
    'admin_archive_trade_request_override',
  ],
] as const;

describe.each(CASES)('%s F5 atomic wiring', (name, atomicRpc, legacyRpc) => {
  const src = readFileSync(fnPath(name), 'utf8');

  it('calls the atomic wrapper RPC', () => {
    const re = new RegExp(`\\.rpc\\(\\s*[\\n\\s]*['"]${atomicRpc}['"]`);
    expect(re.test(src)).toBe(true);
  });

  it(`does NOT call the legacy split RPC ${legacyRpc} directly`, () => {
    const re = new RegExp(`\\.rpc\\(\\s*[\\n\\s]*['"]${legacyRpc}['"]`);
    expect(re.test(src)).toBe(false);
  });

  it('does NOT import recordAdminHqDecision (atomic RPC writes governance)', () => {
    expect(src).not.toMatch(/^\s*import\s+\{[^}]*recordAdminHqDecision[^}]*\}\s+from/m);
  });

  it('does NOT call recordAdminHqDecision after the mutation', () => {
    expect(src).not.toMatch(/\brecordAdminHqDecision\s*\(/);
  });

  it('surfaces governance_event_id and deduplicated from the atomic RPC response', () => {
    expect(src).toMatch(/governance_event_id/);
    expect(src).toMatch(/deduplicated/);
  });

  it('still enforces AAL2 + platform_admin', () => {
    expect(src).toMatch(/assertAal2/);
    expect(src).toMatch(/NOT_PLATFORM_ADMIN/);
  });
});
