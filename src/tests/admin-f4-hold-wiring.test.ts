/**
 * Batch F4 — static wiring guard for billing / compliance / residency
 * hold admin endpoints.
 *
 * Asserts each endpoint:
 *   1. Calls its atomic *_with_governance wrapper RPC.
 *   2. No longer calls the legacy split-commit pair (direct mutation RPC
 *      and recordAdminHqDecision afterwards).
 *   3. Still imports assertAal2 and enforces platform_admin.
 *   4. Surfaces governance_event_id from the atomic response.
 *
 * If anyone re-introduces the decision-then-governance sequence (the gap
 * Batch F4 closes) this test fails.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const fnPath = (name: string) =>
  resolve(__dirname, `../../supabase/functions/${name}/index.ts`);

const CASES = [
  ['admin-billing-hold-apply',        'admin_billing_hold_apply_with_governance',        'apply_billing_hold'],
  ['admin-billing-hold-release',      'admin_billing_hold_release_with_governance',      'release_billing_hold'],
  ['admin-compliance-hold-release',   'admin_compliance_hold_release_with_governance',   null],
  ['admin-compliance-hold-close',     'admin_compliance_hold_close_with_governance',     null],
  ['admin-residency-review-approve',  'admin_residency_review_approve_with_governance',  'approve_residency_review'],
  ['admin-residency-review-decline',  'admin_residency_review_decline_with_governance',  'decline_residency_review'],
] as const;

describe.each(CASES)('%s F4 atomic wiring', (name, atomicRpc, legacyRpc) => {
  const src = readFileSync(fnPath(name), 'utf8');

  it('calls the atomic wrapper RPC', () => {
    const re = new RegExp(`\\.rpc\\(\\s*[\\n\\s]*['"]${atomicRpc}['"]`);
    expect(re.test(src)).toBe(true);
  });

  if (legacyRpc) {
    it(`does NOT call the legacy split RPC ${legacyRpc} directly`, () => {
      const re = new RegExp(`\\.rpc\\(\\s*[\\n\\s]*['"]${legacyRpc}['"]`);
      expect(re.test(src)).toBe(false);
    });
  }

  it('does NOT import recordAdminHqDecision (atomic RPC writes governance)', () => {
    expect(src).not.toMatch(/^\s*import\s+\{[^}]*recordAdminHqDecision[^}]*\}\s+from/m);
  });

  it('does NOT call recordAdminHqDecision after the mutation', () => {
    expect(src).not.toMatch(/\brecordAdminHqDecision\s*\(/);
  });

  it('surfaces governance_event_id from the atomic RPC response', () => {
    expect(src).toMatch(/governance_event_id/);
  });

  it('still enforces AAL2 + platform_admin', () => {
    expect(src).toMatch(/assertAal2/);
    expect(src).toMatch(/NOT_PLATFORM_ADMIN/);
  });
});
