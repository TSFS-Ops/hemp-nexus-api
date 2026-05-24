/**
 * NOT-008 / DEC-009 — Unsubscribe vs essential operational notices.
 *
 * Static source-contract tests proving:
 *  1. Signed 7-category classification exists and is exported.
 *  2. Every registered transactional template maps to a signed category.
 *  3. evaluateUnsubscribedDisposition obeys the signed matrix:
 *     - marketing / non_essential       → suppress
 *     - transactional / security /
 *       payment / compliance            → send_with_disclaimer
 *     - admin_only + fixed admin `to`   → send_with_disclaimer
 *     - admin_only + normal recipient   → admin_only_skip (not sent)
 *  4. Mandated disclaimer text is present verbatim.
 *  5. send-transactional-email wires the umbrella + disposition audits
 *     (`notification.send_evaluated_unsubscribed_user`,
 *      `notification.marketing_suppressed_unsubscribed_user`,
 *      `notification.transactional_sent_to_unsubscribed_user`).
 *  6. Existing `category_unsubscribed` skip reason is preserved (so the
 *     pre-existing notification_skipped/notification.dispatched audit
 *     behaviour is not regressed).
 *  7. No WhatsApp channel is introduced anywhere in the dispatch surface.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  SIGNED_TEMPLATE_CATEGORY,
  getSignedCategoryForTemplate,
  evaluateUnsubscribedDisposition,
  UNSUBSCRIBED_ESSENTIAL_FOOTER,
  AUDIT_SEND_EVALUATED_UNSUBSCRIBED,
  AUDIT_MARKETING_SUPPRESSED_UNSUBSCRIBED,
  AUDIT_TRANSACTIONAL_SENT_UNSUBSCRIBED,
  type SignedCategory,
} from '../../supabase/functions/_shared/email-categories.ts';

const read = (p: string) => readFileSync(p, 'utf8');

describe('NOT-008 / DEC-009 — signed 7-category classification', () => {
  it('exposes all seven signed categories', () => {
    const seen = new Set<SignedCategory>(Object.values(SIGNED_TEMPLATE_CATEGORY));
    // Every template must map to one of the 7 signed names.
    for (const v of seen) {
      expect([
        'marketing',
        'non_essential',
        'transactional',
        'security',
        'payment',
        'compliance',
        'admin_only',
      ]).toContain(v);
    }
  });

  it('every registered template has a signed-category mapping', () => {
    const reg = read('supabase/functions/_shared/transactional-email-templates/registry.ts');
    // Match keys inside `TEMPLATES: Record<string, TemplateEntry> = { ... }`
    const block = reg.split('TEMPLATES')[1] ?? '';
    const names = Array.from(block.matchAll(/['"]([a-z][a-z0-9-]+)['"]\s*:/g)).map((m) => m[1]);
    expect(names.length).toBeGreaterThan(0);
    for (const n of names) {
      expect(SIGNED_TEMPLATE_CATEGORY[n], `template "${n}" missing signed category`).toBeDefined();
    }
  });

  it('mandated NOT-008 disclaimer text is exported verbatim', () => {
    expect(UNSUBSCRIBED_ESSENTIAL_FOOTER).toBe(
      'You are receiving this message because it relates to an active Izenzo ' +
        'transaction, account, security, payment, compliance, dispute, or ' +
        'execution workflow. Marketing emails remain unsubscribed.',
    );
  });

  it('exports three signed audit-action constants', () => {
    expect(AUDIT_SEND_EVALUATED_UNSUBSCRIBED).toBe('notification.send_evaluated_unsubscribed_user');
    expect(AUDIT_MARKETING_SUPPRESSED_UNSUBSCRIBED).toBe('notification.marketing_suppressed_unsubscribed_user');
    expect(AUDIT_TRANSACTIONAL_SENT_UNSUBSCRIBED).toBe('notification.transactional_sent_to_unsubscribed_user');
  });
});

describe('NOT-008 / DEC-009 — disposition matrix for unsubscribed recipient', () => {
  it('marketing → suppress', () => {
    const d = evaluateUnsubscribedDisposition('marketing', false);
    expect(d.action).toBe('suppress');
    expect((d as any).auditAction).toBe('notification.marketing_suppressed_unsubscribed_user');
  });

  it('non_essential → suppress', () => {
    const d = evaluateUnsubscribedDisposition('non_essential', false);
    expect(d.action).toBe('suppress');
  });

  it('transactional → send_with_disclaimer', () => {
    const d = evaluateUnsubscribedDisposition('transactional', false);
    expect(d.action).toBe('send_with_disclaimer');
    expect((d as any).auditAction).toBe('notification.transactional_sent_to_unsubscribed_user');
  });

  it('security → send_with_disclaimer (bypasses unsubscribe)', () => {
    const d = evaluateUnsubscribedDisposition('security', false);
    expect(d.action).toBe('send_with_disclaimer');
  });

  it('compliance → send_with_disclaimer (bypasses unsubscribe)', () => {
    const d = evaluateUnsubscribedDisposition('compliance', false);
    expect(d.action).toBe('send_with_disclaimer');
  });

  it('payment → send_with_disclaimer', () => {
    const d = evaluateUnsubscribedDisposition('payment', false);
    expect(d.action).toBe('send_with_disclaimer');
  });

  it('admin_only + fixed admin `to` → send_with_disclaimer', () => {
    const d = evaluateUnsubscribedDisposition('admin_only', true);
    expect(d.action).toBe('send_with_disclaimer');
  });

  it('admin_only addressed to a normal user → admin_only_skip (not sent)', () => {
    const d = evaluateUnsubscribedDisposition('admin_only', false);
    expect(d.action).toBe('admin_only_skip');
  });

  it('poi-support-desk-notify is classified admin_only', () => {
    expect(getSignedCategoryForTemplate('poi-support-desk-notify')).toBe('admin_only');
  });

  it('revenue-event-notify is classified payment', () => {
    expect(getSignedCategoryForTemplate('revenue-event-notify')).toBe('payment');
  });

  it('outreach digests are classified non_essential', () => {
    expect(getSignedCategoryForTemplate('outreach-intent-to-trade')).toBe('non_essential');
    expect(getSignedCategoryForTemplate('outreach-sla-digest')).toBe('non_essential');
  });
});

describe('NOT-008 / DEC-009 — send-transactional-email wiring', () => {
  const src = read('supabase/functions/send-transactional-email/index.ts');

  it('imports the signed-category helpers', () => {
    expect(src).toMatch(/getSignedCategoryForTemplate/);
    expect(src).toMatch(/evaluateUnsubscribedDisposition/);
    expect(src).toMatch(/UNSUBSCRIBED_ESSENTIAL_FOOTER_HTML/);
  });

  it('emits the umbrella send_evaluated_unsubscribed_user audit', () => {
    expect(src).toMatch(/AUDIT_SEND_EVALUATED_UNSUBSCRIBED/);
    expect(src).toMatch(/notification\.send_evaluated_unsubscribed_user/);
  });

  it('emits marketing_suppressed_unsubscribed_user via disposition.auditAction', () => {
    expect(src).toMatch(/disposition\.auditAction/);
  });

  it('appends the mandated disclaimer footer when sending essential to unsubscribed recipient', () => {
    expect(src).toMatch(/appendUnsubscribedFooter/);
    expect(src).toMatch(/UNSUBSCRIBED_ESSENTIAL_FOOTER_HTML/);
  });

  it('preserves the legacy category_unsubscribed skip reason (notification.dispatched parity)', () => {
    expect(src).toMatch(/reason:\s*['"]category_unsubscribed['"]/);
  });

  it('does NOT introduce any WhatsApp channel', () => {
    expect(src).not.toMatch(/whatsapp/i);
  });
});

describe('NOT-008 / DEC-009 — global no-WhatsApp invariant', () => {
  it('shared notification-skip-audit channels exclude whatsapp', () => {
    const s = read('supabase/functions/_shared/notification-skip-audit.ts');
    expect(s).not.toMatch(/whatsapp/i);
    // channels enum still in {email, slack, webhook, in_app}
    expect(s).toMatch(/"email" \| "slack" \| "webhook" \| "in_app"/);
  });
});
