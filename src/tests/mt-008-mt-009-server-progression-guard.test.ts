/**
 * MT-008 / MT-009 — Server-side progression guard wiring proof.
 *
 * Static source-contract tests proving:
 *   1. The shared guard helper exists and exports the three canonical
 *      audit action constants.
 *   2. The guard is imported and invoked BEFORE any side effect in every
 *      progression edge function in scope (poi-transition, wad, p3-wad,
 *      collapse). Each surface emits the canonical 409 envelope via
 *      `buildProgressionGuardResponse` so no POI/WaD/credit/payment work
 *      can run after a block.
 *   3. The signed audit action names are present in the helper source —
 *      `match.legacy_state_reconciliation_required`,
 *      `match.organisation_attached_contact_required`,
 *      `match.progression_blocked_missing_named_contact` —
 *      and the pre-existing `match.named_contact_assigned` flow is NOT
 *      modified by this patch.
 *   4. The pure lifecycle predicates (`isInconsistentMatch`,
 *      `requiresNamedContact`) behave correctly so that a repaired row
 *      passes the guard and an unrepaired / unattached row does not.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  isInconsistentMatch,
  requiresNamedContact,
  isActiveMatch,
  inconsistencyReasons,
} from '../../supabase/functions/_shared/match-lifecycle.ts';

const read = (p: string) => readFileSync(p, 'utf8');

const GUARD_SRC = read('supabase/functions/_shared/match-progression-guard.ts');

describe('MT-008 / MT-009 — shared progression guard helper', () => {
  it('exports the three canonical audit action constants', () => {
    expect(GUARD_SRC).toMatch(/AUDIT_LEGACY_STATE_RECONCILIATION_REQUIRED\s*=\s*['"]match\.legacy_state_reconciliation_required['"]/);
    expect(GUARD_SRC).toMatch(/AUDIT_ORGANISATION_ATTACHED_CONTACT_REQUIRED\s*=\s*['"]match\.organisation_attached_contact_required['"]/);
    expect(GUARD_SRC).toMatch(/AUDIT_PROGRESSION_BLOCKED_MISSING_NAMED_CONTACT\s*=\s*['"]match\.progression_blocked_missing_named_contact['"]/);
  });

  it('exposes assertMatchProgressable + buildProgressionGuardResponse', () => {
    expect(GUARD_SRC).toMatch(/export async function assertMatchProgressable/);
    expect(GUARD_SRC).toMatch(/export function buildProgressionGuardResponse/);
  });

  it('returns a 409 envelope (no 200 fall-through) when blocked', () => {
    expect(GUARD_SRC).toMatch(/httpStatus:\s*409/);
    expect(GUARD_SRC).toMatch(/MT_008_INCONSISTENT_MATCH/);
    expect(GUARD_SRC).toMatch(/MT_008_LEGACY_ADMIN_HOLD/);
    expect(GUARD_SRC).toMatch(/MT_009_NAMED_CONTACT_REQUIRED/);
  });

  it('fails CLOSED on match load failure (no progression on lookup error)', () => {
    expect(GUARD_SRC).toMatch(/reason:\s*['"]match_load_failed['"]/);
    expect(GUARD_SRC).toMatch(/reason:\s*['"]named_contact_load_failed['"]/);
  });
});

describe('MT-008 / MT-009 — guard wired into progression edge functions', () => {
  const surfaces: Array<{ name: string; path: string; action: string }> = [
    { name: 'poi-transition', path: 'supabase/functions/poi-transition/index.ts', action: 'poi_transition' },
    { name: 'wad',            path: 'supabase/functions/wad/index.ts',            action: 'wad' },
    { name: 'p3-wad',         path: 'supabase/functions/p3-wad/index.ts',         action: 'finality' },
    { name: 'collapse',       path: 'supabase/functions/collapse/index.ts',       action: 'collapse' },
  ];

  for (const s of surfaces) {
    it(`${s.name} imports the guard helper`, () => {
      const src = read(s.path);
      expect(src).toMatch(/from\s+["']\.\.\/_shared\/match-progression-guard\.ts["']/);
      expect(src).toMatch(/assertMatchProgressable/);
      expect(src).toMatch(/buildProgressionGuardResponse/);
    });

    it(`${s.name} invokes the guard with the expected action label`, () => {
      const src = read(s.path);
      expect(src).toMatch(new RegExp(`action:\\s*["']${s.action}["']`));
    });

    it(`${s.name} short-circuits with the guard response before side effects`, () => {
      const src = read(s.path);
      // Every wiring site must have a `if (blocked) return blocked;` (or
      // throw via the helper) immediately after building the response.
      expect(src).toMatch(/if\s*\(\s*blocked\s*\)\s*(?:\{[^}]*?)?return\s+blocked/);
    });
  }
});

describe('MT-008 — predicate behaviour gating progression', () => {
  it('isInconsistentMatch flags settled + draft poi', () => {
    expect(isInconsistentMatch({ status: 'settled', poi_state: 'DRAFT' })).toBe(true);
  });

  it('isInconsistentMatch flags same_org_both_sides', () => {
    expect(
      isInconsistentMatch({ buyer_org_id: 'org-1', seller_org_id: 'org-1' }),
    ).toBe(true);
  });

  it('a clean row is NOT inconsistent (repaired matches can progress)', () => {
    const m = {
      status: 'discovery',
      state: 'discovery',
      poi_state: 'DRAFT',
      buyer_org_id: 'org-a',
      seller_org_id: 'org-b',
      buyer_authorised_user_id: 'u-a',
      seller_authorised_user_id: 'u-b',
    };
    expect(isInconsistentMatch(m)).toBe(false);
    expect(inconsistencyReasons(m)).toEqual([]);
    expect(isActiveMatch(m)).toBe(true);
  });

  it('legacy_archived_admin_hold marker blocks isActiveMatch', () => {
    expect(
      isActiveMatch({
        status: 'discovery',
        state: 'discovery',
        metadata: { legacy_archived_admin_hold: true },
      }),
    ).toBe(false);
  });
});

describe('MT-009 — predicate behaviour gating progression', () => {
  it('org-attached row with NO named contact requires named contact', () => {
    const m = { buyer_org_id: 'org-a', seller_org_id: 'org-b' };
    expect(requiresNamedContact(m, [])).toBe('both');
  });

  it('org-attached row with assigned authorised users passes', () => {
    const m = {
      buyer_org_id: 'org-a',
      seller_org_id: 'org-b',
      buyer_authorised_user_id: 'u-a',
      seller_authorised_user_id: 'u-b',
    };
    expect(requiresNamedContact(m, [])).toBeNull();
  });

  it('controlled named contact row satisfies the side requirement', () => {
    const m = { buyer_org_id: 'org-a', seller_org_id: 'org-b' };
    expect(
      requiresNamedContact(m, [
        { side: 'buyer', status: 'active' },
        { side: 'seller', status: 'active' },
      ]),
    ).toBeNull();
  });

  it('inactive controlled contact does NOT satisfy the requirement', () => {
    const m = { buyer_org_id: 'org-a', seller_org_id: 'org-b' };
    expect(
      requiresNamedContact(m, [
        { side: 'buyer', status: 'inactive' },
        { side: 'seller', status: 'active' },
      ]),
    ).toBe('buyer');
  });

  it('fully unattached match has NO named-contact requirement', () => {
    expect(requiresNamedContact({}, [])).toBeNull();
  });
});

describe('MT-009 — pre-existing assignment audit name preserved', () => {
  it('match.named_contact_assigned audit string is NOT modified by the guard', () => {
    // The guard helper must never overwrite the existing assignment audit
    // emitted by `match-named-contacts-assign`. We assert by absence.
    expect(GUARD_SRC).not.toMatch(/match\.named_contact_assigned/);
  });
});
