/**
 * Static wiring guard for the three admin payment-dispute endpoints
 * (Batch F3 atomicity).
 *
 * For each of admin-payment-dispute-record / -resolve-won / -resolve-lost
 * asserts that the edge function:
 *   1. Calls the atomic wrapper RPC (admin_payment_dispute_*_with_governance).
 *   2. No longer calls the legacy split-commit RPC directly
 *      (record_payment_dispute / resolve_payment_dispute_won / _lost).
 *   3. No longer imports or calls recordAdminHqDecision.
 *   4. Still carries AAL2 + platform_admin + reason ≥ 20 guards.
 *   5. Surfaces governance_event_id in the response.
 *
 * If anyone reintroduces the decision-then-governance sequence (the gap
 * Batch F3 closes) this test fails.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const cases = [
  {
    name: 'admin-payment-dispute-record',
    atomic: 'admin_payment_dispute_record_with_governance',
    legacy: 'record_payment_dispute',
  },
  {
    name: 'admin-payment-dispute-resolve-won',
    atomic: 'admin_payment_dispute_resolve_won_with_governance',
    legacy: 'resolve_payment_dispute_won',
  },
  {
    name: 'admin-payment-dispute-resolve-lost',
    atomic: 'admin_payment_dispute_resolve_lost_with_governance',
    legacy: 'resolve_payment_dispute_lost',
  },
] as const;

describe.each(cases)('$name F3 atomic wiring', ({ name, atomic, legacy }) => {
  const src = readFileSync(
    resolve(__dirname, `../../supabase/functions/${name}/index.ts`),
    'utf8',
  );

  it('calls the atomic wrapper RPC', () => {
    const re = new RegExp(`\\.rpc\\(\\s*[\\n\\s]*['"]${atomic}['"]`);
    expect(re.test(src)).toBe(true);
  });

  it('does NOT call the legacy split RPC directly', () => {
    const re = new RegExp(`\\.rpc\\(\\s*[\\n\\s]*['"]${legacy}['"]`);
    expect(re.test(src)).toBe(false);
  });

  it('does NOT import recordAdminHqDecision', () => {
    expect(src).not.toMatch(/^\s*import\s+\{[^}]*recordAdminHqDecision[^}]*\}\s+from/m);
  });

  it('does NOT call recordAdminHqDecision', () => {
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
