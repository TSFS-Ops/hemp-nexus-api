/**
 * Structured audit-row assertions — `notification_preference.changed`
 *
 * Two writers produce this audit row:
 *
 *   1. The edge function `update-notification-preferences` (enriched row:
 *      `source`, `touched_sensitive`, `via`, `target_user_id`).
 *   2. The DB trigger `audit_notification_preferences_change` on every
 *      UPDATE/INSERT of `notification_preferences` (canonical row:
 *      `before`, `after`, `source`, `target_user_id`, `op`).
 *
 * These tests pin down the exact shape and values of both rows for the
 * three canonical paths:
 *
 *   - self update            → source='self',  no admin AAL2
 *   - admin-on-behalf update → source='admin', via=update-notification-preferences
 *   - sensitive-key update   → touched_sensitive=true, AAL2 enforced
 *
 * If any of these fields drift, the notification-events query API,
 * AdminNotificationPreferencesPanel filters, and compliance exports
 * silently break — so we assert structurally, not just on presence.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

const read = (p: string) => readFileSync(p, 'utf8');

const EDGE_SRC = read('supabase/functions/update-notification-preferences/index.ts');

const MIGRATION_BODY = (() => {
  const files = readdirSync('supabase/migrations').filter((f) => f.startsWith('20260516161'));
  return files.map((f) => read(`supabase/migrations/${f}`)).join('\n');
})();

// ---------------------------------------------------------------------------
// 1. Static structural assertions on the edge function's audit insert.
// ---------------------------------------------------------------------------
describe('audit row — edge function update-notification-preferences', () => {
  // Isolate the audit_logs insert block so we assert only against IT, not
  // against unrelated occurrences (e.g. logging in error paths).
  const insertBlock = (() => {
    const start = EDGE_SRC.indexOf('audit_logs');
    expect(start, 'audit_logs insert must exist in edge function').toBeGreaterThan(0);
    // Grab from the .insert( through the closing );
    const tail = EDGE_SRC.slice(start);
    const end = tail.indexOf('});');
    expect(end, 'audit_logs insert block must be a closed object').toBeGreaterThan(0);
    return tail.slice(0, end + 3);
  })();

  it('writes action="notification_preference.changed"', () => {
    expect(insertBlock).toMatch(/action:\s*["']notification_preference\.changed["']/);
  });

  it('sets entity_type="notification_preference" and entity_id=targetUserId', () => {
    expect(insertBlock).toMatch(/entity_type:\s*["']notification_preference["']/);
    expect(insertBlock).toMatch(/entity_id:\s*targetUserId/);
  });

  it('records org_id from the target user profile (with sentinel fallback)', () => {
    // Belt and braces: pulls profiles.org_id then falls back to all-zero UUID
    // so the row is never NULL (audit_logs.org_id is NOT NULL).
    expect(EDGE_SRC).toMatch(/from\(["']profiles["']\)\.select\(["']org_id["']\)/);
    expect(insertBlock).toMatch(/org_id:[^,]*00000000-0000-0000-0000-000000000000/);
  });

  it('records actor_user_id from the authenticated caller, not the target', () => {
    expect(insertBlock).toMatch(/actor_user_id:\s*actorId/);
    // Negative: must NOT silently substitute the target as the actor.
    expect(insertBlock).not.toMatch(/actor_user_id:\s*targetUserId/);
  });

  it('metadata carries before/after, target_user_id, source, touched_sensitive, via', () => {
    expect(insertBlock).toMatch(/before,/);
    expect(insertBlock).toMatch(/after,/);
    expect(insertBlock).toMatch(/target_user_id:\s*targetUserId/);
    expect(insertBlock).toMatch(
      /source:\s*isAdminUpdate\s*\?\s*["']admin["']\s*:\s*["']self["']/,
    );
    expect(insertBlock).toMatch(/touched_sensitive:\s*touchesSensitive/);
    expect(insertBlock).toMatch(/via:\s*["']update-notification-preferences["']/);
  });

  it('admin-on-behalf path is gated by platform_admin role AND AAL2', () => {
    expect(EDGE_SRC).toMatch(/\.eq\("role",\s*"platform_admin"\)/);
    expect(EDGE_SRC).toMatch(
      /assertAal2[\s\S]{0,200}action:\s*["']notification_preference\.admin_change["']/,
    );
  });

  it('sensitive-key path requires AAL2 and tags action=sensitive_change', () => {
    expect(EDGE_SRC).toMatch(/SENSITIVE_KEYS = new Set/);
    expect(EDGE_SRC).toMatch(/compliance_status/);
    expect(EDGE_SRC).toMatch(/billing_alerts/);
    expect(EDGE_SRC).toMatch(/billing_receipts/);
    expect(EDGE_SRC).toMatch(
      /assertAal2[\s\S]{0,200}action:\s*["']notification_preference\.sensitive_change["']/,
    );
  });
});

// ---------------------------------------------------------------------------
// 2. Static structural assertions on the DB trigger's audit insert.
// ---------------------------------------------------------------------------
describe('audit row — DB trigger audit_notification_preferences_change', () => {
  it('inserts into audit_logs with the canonical column ordering', () => {
    expect(MIGRATION_BODY).toMatch(
      /INSERT INTO public\.audit_logs\s*\(org_id,\s*actor_user_id,\s*action,\s*entity_type,\s*entity_id,\s*metadata\)/,
    );
  });

  it('writes action=notification_preference.changed and entity_type=notification_preference', () => {
    expect(MIGRATION_BODY).toMatch(/'notification_preference\.changed'/);
    expect(MIGRATION_BODY).toMatch(/'notification_preference',/);
  });

  it('entity_id is the target user id (NEW.user_id), not the actor', () => {
    expect(MIGRATION_BODY).toMatch(/NEW\.user_id,\s*\n\s*jsonb_build_object/);
  });

  it('source resolves to self when actor IS NULL or actor=target, else admin', () => {
    expect(MIGRATION_BODY).toMatch(
      /'source',\s*CASE WHEN v_actor IS NULL OR v_actor = NEW\.user_id THEN 'self' ELSE 'admin' END/,
    );
  });

  it('metadata carries before, after, source, target_user_id, op', () => {
    expect(MIGRATION_BODY).toMatch(/'before',\s*v_before/);
    expect(MIGRATION_BODY).toMatch(/'after',\s*v_after/);
    expect(MIGRATION_BODY).toMatch(/'target_user_id',\s*NEW\.user_id/);
    expect(MIGRATION_BODY).toMatch(/'op',\s*TG_OP/);
  });

  it('no-op updates (before = after) do NOT emit an audit row', () => {
    expect(MIGRATION_BODY).toMatch(/IF v_before = v_after THEN\s*\n\s*RETURN NEW;/);
  });

  it('org_id falls back to the all-zero sentinel when the target has no profile', () => {
    expect(MIGRATION_BODY).toMatch(
      /COALESCE\(v_org,\s*'00000000-0000-0000-0000-000000000000'::uuid\)/,
    );
  });
});

// ---------------------------------------------------------------------------
// 3. Logic simulation — reproduces the edge function's audit insert and
//    asserts the exact metadata payload for the three canonical paths.
// ---------------------------------------------------------------------------

type AuditRow = {
  org_id: string;
  actor_user_id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  metadata: Record<string, unknown>;
};

const SENTINEL_ORG = '00000000-0000-0000-0000-000000000000';
const SENSITIVE_KEYS = new Set(['compliance_status', 'billing_alerts', 'billing_receipts']);

/**
 * Re-implementation of the edge function's audit-write step (lines 124-141
 * of update-notification-preferences/index.ts). Pure function so we can
 * pin down the row shape exactly.
 */
function buildAuditRow(args: {
  actorId: string;
  targetUserId: string;
  before: Record<string, boolean>;
  patch: Record<string, boolean>;
  targetOrgId: string | null;
}): AuditRow {
  const after = { ...args.before, ...args.patch };
  const isAdminUpdate = args.targetUserId !== args.actorId;
  const touchesSensitive = Object.keys(args.patch).some((k) => SENSITIVE_KEYS.has(k));
  return {
    org_id: args.targetOrgId ?? SENTINEL_ORG,
    actor_user_id: args.actorId,
    action: 'notification_preference.changed',
    entity_type: 'notification_preference',
    entity_id: args.targetUserId,
    metadata: {
      before: args.before,
      after,
      target_user_id: args.targetUserId,
      source: isAdminUpdate ? 'admin' : 'self',
      touched_sensitive: touchesSensitive,
      via: 'update-notification-preferences',
    },
  };
}

const USER_A = '11111111-1111-1111-1111-111111111111';
const USER_B = '22222222-2222-2222-2222-222222222222';
const ORG_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

describe('audit row shape — self update', () => {
  const row = buildAuditRow({
    actorId: USER_A,
    targetUserId: USER_A,
    before: { engagement_updates: true, billing_alerts: true },
    patch: { engagement_updates: false },
    targetOrgId: ORG_A,
  });

  it('uses the target user as entity_id and the actor as actor_user_id (same id)', () => {
    expect(row.entity_id).toBe(USER_A);
    expect(row.actor_user_id).toBe(USER_A);
  });

  it('action and entity_type are pinned exactly', () => {
    expect(row.action).toBe('notification_preference.changed');
    expect(row.entity_type).toBe('notification_preference');
  });

  it('metadata.source is "self" and touched_sensitive is false', () => {
    expect(row.metadata.source).toBe('self');
    expect(row.metadata.touched_sensitive).toBe(false);
  });

  it('metadata.before is the prior preferences map, metadata.after merges the patch', () => {
    expect(row.metadata.before).toEqual({ engagement_updates: true, billing_alerts: true });
    expect(row.metadata.after).toEqual({ engagement_updates: false, billing_alerts: true });
  });

  it('metadata.target_user_id matches entity_id, and via is tagged', () => {
    expect(row.metadata.target_user_id).toBe(USER_A);
    expect(row.metadata.via).toBe('update-notification-preferences');
  });

  it('org_id resolves to the target user org (not the sentinel)', () => {
    expect(row.org_id).toBe(ORG_A);
  });
});

describe('audit row shape — admin-on-behalf update', () => {
  const row = buildAuditRow({
    actorId: USER_A, // platform_admin
    targetUserId: USER_B, // someone else
    before: { weekly_digest: true },
    patch: { weekly_digest: false },
    targetOrgId: ORG_B, // org of TARGET, not of admin
  });

  it('actor_user_id is the admin caller, entity_id is the target user', () => {
    expect(row.actor_user_id).toBe(USER_A);
    expect(row.entity_id).toBe(USER_B);
    expect(row.actor_user_id).not.toBe(row.entity_id);
  });

  it('metadata.source is "admin"', () => {
    expect(row.metadata.source).toBe('admin');
  });

  it('org_id reflects the TARGET user org (so org-scoped queries find the row)', () => {
    expect(row.org_id).toBe(ORG_B);
    expect(row.org_id).not.toBe(SENTINEL_ORG);
  });

  it('metadata.target_user_id explicitly mirrors entity_id', () => {
    expect(row.metadata.target_user_id).toBe(USER_B);
  });

  it('touched_sensitive is false when patch contains no sensitive keys', () => {
    expect(row.metadata.touched_sensitive).toBe(false);
  });
});

describe('audit row shape — sensitive-key updates', () => {
  it('touched_sensitive=true when patch includes compliance_status', () => {
    const row = buildAuditRow({
      actorId: USER_A,
      targetUserId: USER_A,
      before: { compliance_status: true },
      patch: { compliance_status: false },
      targetOrgId: ORG_A,
    });
    expect(row.metadata.touched_sensitive).toBe(true);
    expect(row.metadata.source).toBe('self');
  });

  it('touched_sensitive=true for billing_alerts and billing_receipts', () => {
    for (const k of ['billing_alerts', 'billing_receipts']) {
      const row = buildAuditRow({
        actorId: USER_A,
        targetUserId: USER_A,
        before: {},
        patch: { [k]: false },
        targetOrgId: ORG_A,
      });
      expect(row.metadata.touched_sensitive, `${k} must be sensitive`).toBe(true);
    }
  });

  it('admin + sensitive change carries source="admin" AND touched_sensitive=true', () => {
    const row = buildAuditRow({
      actorId: USER_A,
      targetUserId: USER_B,
      before: { billing_alerts: true },
      patch: { billing_alerts: false },
      targetOrgId: ORG_B,
    });
    expect(row.metadata.source).toBe('admin');
    expect(row.metadata.touched_sensitive).toBe(true);
  });
});

describe('audit row shape — defensive edges', () => {
  it('org_id falls back to the all-zero sentinel when the target has no profile', () => {
    const row = buildAuditRow({
      actorId: USER_A,
      targetUserId: USER_A,
      before: {},
      patch: { weekly_digest: true },
      targetOrgId: null,
    });
    expect(row.org_id).toBe(SENTINEL_ORG);
  });

  it('action and entity_type are stable across self and admin rows', () => {
    const self = buildAuditRow({
      actorId: USER_A, targetUserId: USER_A, before: {}, patch: { a: true }, targetOrgId: ORG_A,
    });
    const admin = buildAuditRow({
      actorId: USER_A, targetUserId: USER_B, before: {}, patch: { a: true }, targetOrgId: ORG_B,
    });
    expect(self.action).toBe(admin.action);
    expect(self.entity_type).toBe(admin.entity_type);
  });
});
