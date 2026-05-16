/**
 * Batch M — Notifications, preferences and unsubscribe/suppression consistency
 *
 * Static checks: every transactional template has an explicit category;
 * preference enforcement helper, admin recipients resolver and the
 * update-notification-preferences edge function exist; client tab routes
 * through the audited path. Runtime DB checks are deferred to the
 * integration env (DB migration applied, trigger active).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (p: string) => readFileSync(p, 'utf8');

describe('Batch M — categories + registry parity', () => {
  it('every registered template has an explicit category', () => {
    const reg = read('supabase/functions/_shared/transactional-email-templates/registry.ts');
    const cats = read('supabase/functions/_shared/email-categories.ts');
    const templateNames = Array.from(reg.matchAll(/['"]([a-z0-9-]+)['"]:\s*[a-zA-Z]/g))
      .map((m) => m[1])
      .filter((n) => !['component', 'subject', 'to', 'displayName', 'previewData'].includes(n));
    expect(templateNames.length).toBeGreaterThan(0);
    for (const name of templateNames) {
      expect(cats, `template "${name}" missing from TEMPLATE_CATEGORY`).toContain(`"${name}":`);
    }
  });

  it('exposes safety helpers for suppression and preference enforcement', () => {
    const cats = read('supabase/functions/_shared/email-categories.ts');
    expect(cats).toMatch(/isBlockedByUnsubscribe/);
    expect(cats).toMatch(/isBlockedByPreference/);
    expect(cats).toMatch(/getCategoryForTemplate/);
    expect(cats).toMatch(/getPreferenceKeyForTemplate/);
  });
});

describe('Batch M — preference enforcement helper', () => {
  const src = read('supabase/functions/_shared/notification-preferences.ts');
  it('security and compliance bypass preferences', () => {
    expect(src).toMatch(/category === "security" \|\| category === "compliance"/);
    expect(src).toMatch(/category_bypass/);
  });
  it('records notification_skipped with reason preference_disabled', () => {
    expect(src).toMatch(/reason: "preference_disabled"/);
  });
  it('fails open on lookup error (never blocks delivery on outage)', () => {
    expect(src).toMatch(/lookup_error_fail_open/);
  });
});

describe('Batch M — send-transactional-email wiring', () => {
  const src = read('supabase/functions/send-transactional-email/index.ts');
  it('imports the category + preference helpers', () => {
    expect(src).toMatch(/getCategoryForTemplate/);
    expect(src).toMatch(/isBlockedByUnsubscribe/);
    expect(src).toMatch(/checkAndAuditPreference/);
  });
  it('gates suppression on category (security/compliance bypass)', () => {
    expect(src).toMatch(/Suppression bypassed for safety-critical category/);
  });
  it('returns reason=preference_disabled when blocked by preference', () => {
    expect(src).toMatch(/reason: 'preference_disabled'/);
  });
});

describe('Batch M — admin role-based routing', () => {
  const src = read('supabase/functions/_shared/admin-recipients.ts');
  const dispatch = read('supabase/functions/notification-dispatch/index.ts');
  it('platform_admin is the universal fallback', () => {
    expect(src).toMatch(/const FALLBACK: AdminRole = "platform_admin"/);
  });
  it('routes compliance/billing/legal events to their roles', () => {
    expect(src).toMatch(/compliance_analyst/);
    expect(src).toMatch(/billing_admin/);
    expect(src).toMatch(/legal_reviewer/);
  });
  it('never returns org_member', () => {
    expect(src).not.toMatch(/org_member/);
  });
  it('dispatch replaces hardcoded admin@izenzo.co.za with resolver', () => {
    expect(dispatch).toMatch(/resolveAdminRecipients\(supabase, event_type\)/);
    expect(dispatch).toMatch(/admin_routing_failed/);
    expect(dispatch).toMatch(/recipient_role: recip\.role/);
    expect(dispatch).toMatch(/routing_policy_key: routing\.policy\.policyKey/);
  });
});

describe('Batch M — preference-change audit + AAL2', () => {
  const fn = read('supabase/functions/update-notification-preferences/index.ts');
  const tab = read('src/components/desk/settings/NotificationRulesTab.tsx');
  it('edge function exists and asserts AAL2 for sensitive keys', () => {
    expect(fn).toMatch(/SENSITIVE_KEYS/);
    expect(fn).toMatch(/notification_preference\.sensitive_change/);
    expect(fn).toMatch(/assertAal2/);
  });
  it('writes notification_preference.changed audit row', () => {
    expect(fn).toMatch(/'notification_preference\.changed'/);
    expect(fn).toMatch(/source: isAdminUpdate \? "admin" : "self"/);
  });
  it('client tab routes through the edge function (not direct upsert)', () => {
    expect(tab).toMatch(/supabase\.functions\.invoke\("update-notification-preferences"/);
    expect(tab).not.toMatch(/\.from\("notification_preferences"\)\s*\.upsert/);
  });
});

describe('Batch M — DB migration (entity link + resolver + audit trigger)', () => {
  // Migration filename embeds a hash, so glob via fs
  const files = require('node:fs').readdirSync('supabase/migrations') as string[];
  const recent = files.filter((f) => f.startsWith('20260516161'));
  const body = recent.map((f) => read(`supabase/migrations/${f}`)).join('\n');
  it('adds entity_type/entity_id/resolved_at to notifications', () => {
    expect(body).toMatch(/notifications[\s\S]*entity_type/);
    expect(body).toMatch(/entity_id uuid/);
    expect(body).toMatch(/resolved_at/);
  });
  it('adds recipient_role + routing_policy_key to notification_dispatches', () => {
    expect(body).toMatch(/notification_dispatches[\s\S]*recipient_role/);
    expect(body).toMatch(/routing_policy_key/);
  });
  it('defines resolve_notifications_for(entity_type, entity_id)', () => {
    expect(body).toMatch(/FUNCTION public\.resolve_notifications_for/);
    expect(body).toMatch(/SECURITY DEFINER/);
  });
  it('installs preference-change audit trigger', () => {
    expect(body).toMatch(/audit_notification_preferences_change/);
    expect(body).toMatch(/trg_notification_preferences_audit/);
    expect(body).toMatch(/'notification_preference\.changed'/);
  });
});
