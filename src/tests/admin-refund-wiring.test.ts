/**
 * Static wiring guard for the admin refund decision endpoints (Batch F2
 * atomicity).
 *
 * Asserts that BOTH admin-refund-approve and admin-refund-decline:
 *   1. Call the atomic wrapper RPC
 *      (admin_refund_{approve,decline}_with_governance), and
 *   2. No longer call the legacy split-commit pair
 *      (approve_refund / decline_refund + recordAdminHqDecision), and
 *   3. Still carry the AAL2 + platform_admin + reason ≥ 20 guards.
 *
 * If anyone re-introduces the decision-then-governance sequence (which is
 * exactly the gap Batch F2 closes) this test fails.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const APPROVE_PATH = resolve(
  __dirname,
  '../../supabase/functions/admin-refund-approve/index.ts',
);
const DECLINE_PATH = resolve(
  __dirname,
  '../../supabase/functions/admin-refund-decline/index.ts',
);

const approveSrc = readFileSync(APPROVE_PATH, 'utf8');
const declineSrc = readFileSync(DECLINE_PATH, 'utf8');

describe.each([
  ['admin-refund-approve', approveSrc, 'admin_refund_approve_with_governance', 'approve_refund'],
  ['admin-refund-decline', declineSrc, 'admin_refund_decline_with_governance', 'decline_refund'],
] as const)('%s F2 atomic wiring', (_name, src, atomicRpc, legacyRpc) => {
  it('calls the atomic wrapper RPC', () => {
    const re = new RegExp(`\\.rpc\\(\\s*[\\n\\s]*['"]${atomicRpc}['"]`);
    expect(re.test(src)).toBe(true);
  });

  it('does NOT call the legacy split RPC directly', () => {
    const re = new RegExp(`\\.rpc\\(\\s*[\\n\\s]*['"]${legacyRpc}['"]`);
    expect(re.test(src)).toBe(false);
  });

  it('does NOT import recordAdminHqDecision (atomic RPC writes governance)', () => {
    expect(src).not.toMatch(
      /^\s*import\s+\{[^}]*recordAdminHqDecision[^}]*\}\s+from/m,
    );
  });

  it('does NOT call recordAdminHqDecision after the mutation', () => {
    expect(src).not.toMatch(/\brecordAdminHqDecision\s*\(/);
  });

  it('surfaces governance_event_id from the atomic RPC response', () => {
    expect(src).toMatch(/governance_event_id/);
  });

  it('still enforces AAL2 + platform_admin + reason ≥ 20', () => {
    expect(src).toMatch(/assertAal2/);
    expect(src).toMatch(/NOT_PLATFORM_ADMIN/);
    expect(src).toMatch(/min\(\s*20\s*\)/);
  });
});
