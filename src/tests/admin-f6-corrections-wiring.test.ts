/**
 * Batch F6 — static wiring guard for counterparty + match correction
 * admin endpoints. Mirrors F4/F5 guards.
 *
 * Asserts each endpoint:
 *   1. Calls its atomic *_with_governance wrapper RPC.
 *   2. No longer calls any of the legacy split-commit RPCs directly.
 *   3. Still imports assertAal2 and enforces platform_admin (FORBIDDEN).
 *   4. Surfaces governance_event_id and deduplicated.
 *   5. No longer imports or calls recordAdminHqDecision.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const fnPath = (name: string) =>
  resolve(__dirname, `../../supabase/functions/${name}/index.ts`);

const CASES: ReadonlyArray<readonly [string, string, readonly string[]]> = [
  [
    'admin-counterparty-corrections',
    'admin_counterparty_corrections_with_governance',
    ['admin_link_counterparty_to_org', 'admin_merge_counterparties'],
  ],
  [
    'admin-match-corrections',
    'admin_match_corrections_with_governance',
    [
      'admin_correct_match_jurisdiction',
      'admin_relink_match_counterparty',
      'admin_archive_duplicate_match',
    ],
  ],
];

describe.each(CASES)('%s F6 atomic wiring', (name, atomicRpc, legacyRpcs) => {
  const src = readFileSync(fnPath(name), 'utf8');

  it('calls the atomic wrapper RPC', () => {
    const re = new RegExp(`\\.rpc\\(\\s*[\\n\\s]*['"]${atomicRpc}['"]`);
    expect(re.test(src)).toBe(true);
  });

  it.each(legacyRpcs)('does NOT call legacy split RPC %s directly', (legacyRpc) => {
    const re = new RegExp(`\\.rpc\\(\\s*[\\n\\s]*['"]${legacyRpc}['"]`);
    expect(re.test(src)).toBe(false);
  });

  it('does NOT import recordAdminHqDecision', () => {
    expect(src).not.toMatch(/^\s*import\s+\{[^}]*recordAdminHqDecision[^}]*\}\s+from/m);
  });

  it('does NOT call recordAdminHqDecision', () => {
    expect(src).not.toMatch(/\brecordAdminHqDecision\s*\(/);
  });

  it('surfaces governance_event_id and deduplicated', () => {
    expect(src).toMatch(/governance_event_id/);
    expect(src).toMatch(/deduplicated/);
  });

  it('still enforces AAL2 + platform_admin guard', () => {
    expect(src).toMatch(/assertAal2/);
    expect(src).toMatch(/FORBIDDEN/);
  });
});
