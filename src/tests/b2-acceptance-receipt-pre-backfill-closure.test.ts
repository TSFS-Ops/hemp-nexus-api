/**
 * B2 — Pre-backfill acceptance-receipt risk-item closure guard.
 *
 * Source-pattern test pinning that the B2 migration extends
 * public.reconcile_acceptance_notifications() with a second
 * auto-resolve pass that closes ONLY stale historical
 * "Acceptance receipt <id> not notified" risk items whose
 * referenced acceptance receipt:
 *   - pre-dates the dispatch-tracking backfill cutoff
 *   - has NO notification_dispatches row at all
 *   - has NO matching acceptance-receipt email_send_log entry
 *     near the receipt date
 *
 * Negative guards: no email send, no provider call, no dispatch
 * insert/update/delete, no acceptance_receipts mutation, no
 * email_send_log mutation, no cron / RLS / grant change. Failed,
 * pending, and delivered/opened cases MUST NOT be touched by this
 * branch (delivered/opened stays on the B1 path).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const MIGRATION = resolve(
  "supabase/migrations/20260623234215_f5494ff9-fc6c-4e92-a504-43bf9c3eccba.sql",
);

const sql = readFileSync(MIGRATION, "utf8");

describe("B2 reconcile_acceptance_notifications pre-backfill auto-resolve", () => {
  it("replaces reconcile_acceptance_notifications in place", () => {
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.reconcile_acceptance_notifications\(\)/,
    );
    expect(sql).toMatch(/SECURITY DEFINER/);
    expect(sql).toMatch(/SET search_path TO 'public'/);
  });

  it("declares the pre-backfill cutoff as a constant timestamptz", () => {
    expect(sql).toMatch(
      /v_dispatch_backfill_cutoff\s+timestamptz\s*:=\s*'2026-04-23 09:46:24\+00'::timestamptz/,
    );
  });

  it("preserves the B1 delivered/opened auto-resolve pass", () => {
    expect(sql).toMatch(/'acceptance_receipt_delivered'/);
    expect(sql).toMatch(/nd\.status IN \('delivered',\s*'opened'\)/);
  });

  it("adds a second auto-resolve pass keyed on pre-backfill receipts", () => {
    expect(sql).toMatch(/to_resolve_pre AS \(/);
    expect(sql).toMatch(/ar\.created_at\s*<\s*v_dispatch_backfill_cutoff/);
  });

  it("only resolves when NO notification_dispatches row exists for the receipt", () => {
    expect(sql).toMatch(
      /NOT EXISTS \(\s*SELECT 1 FROM notification_dispatches nd\s+WHERE nd\.reference_type = 'acceptance_receipt'\s+AND nd\.reference_id\s*=\s*ar\.id\s*\)/,
    );
  });

  it("only resolves when NO matching acceptance-receipt email_send_log row exists in the window", () => {
    expect(sql).toMatch(
      /NOT EXISTS \(\s*SELECT 1 FROM email_send_log esl[\s\S]+?template_name = 'acceptance-receipt'[\s\S]+?created_at BETWEEN ar\.created_at - interval '1 day'[\s\S]+?ar\.created_at \+ interval '7 days'/,
    );
    expect(sql).toMatch(/esl\.recipient_email = ar\.counterparty_email/);
    expect(sql).toMatch(/esl\.recipient_email = ar\.accepting_user_email/);
  });

  it("scopes the pass to open acceptance-receipt not-notified risk items", () => {
    expect(sql).toMatch(/ari\.status = 'open'/);
    expect(sql).toMatch(/ari\.kind = 'acceptance_receipt_not_notified'/);
    expect(sql).toMatch(
      /ari\.title LIKE 'Acceptance receipt % not notified'/,
    );
  });

  it("stamps the pre-backfill audit-trail metadata", () => {
    expect(sql).toMatch(
      /'auto_resolved_reason',\s*'acceptance_receipt_pre_backfill_no_dispatch'/,
    );
    expect(sql).toMatch(
      /'auto_resolved_by',\s*'reconcile_acceptance_notifications'/,
    );
    expect(sql).toMatch(/'auto_resolved_at'/);
    expect(sql).toMatch(/'pre_backfill_cutoff',\s*to_jsonb\(v_dispatch_backfill_cutoff\)/);
  });

  it("returns a pre_backfill_auto_resolved counter alongside existing keys", () => {
    expect(sql).toMatch(/'pre_backfill_auto_resolved'/);
    expect(sql).toMatch(/'alarms_raised'/);
    expect(sql).toMatch(/'auto_resolved'/);
    expect(sql).toMatch(/'checked_at'/);
  });

  it("does NOT treat failed, pending, or sent dispatches as resolution evidence in the pre-backfill branch", () => {
    // The pre-backfill branch must NOT join on a dispatch existence with
    // status='failed' / 'pending' as evidence — it requires ZERO dispatch rows.
    expect(sql).not.toMatch(/to_resolve_pre[\s\S]*?status\s*=\s*'failed'/);
    expect(sql).not.toMatch(/to_resolve_pre[\s\S]*?status\s*=\s*'pending'/);
  });

  it("does NOT send emails, retry dispatches, or mutate dispatch/receipt/log rows", () => {
    expect(sql).not.toMatch(/INSERT\s+INTO\s+notification_dispatches/i);
    expect(sql).not.toMatch(/UPDATE\s+notification_dispatches/i);
    expect(sql).not.toMatch(/DELETE\s+FROM\s+notification_dispatches/i);
    expect(sql).not.toMatch(/INSERT\s+INTO\s+acceptance_receipts/i);
    expect(sql).not.toMatch(/UPDATE\s+acceptance_receipts/i);
    expect(sql).not.toMatch(/DELETE\s+FROM\s+acceptance_receipts/i);
    expect(sql).not.toMatch(/INSERT\s+INTO\s+email_send_log/i);
    expect(sql).not.toMatch(/UPDATE\s+email_send_log/i);
    expect(sql).not.toMatch(/DELETE\s+FROM\s+email_send_log/i);
    expect(sql).not.toMatch(/send-transactional-email/);
    expect(sql).not.toMatch(/mailgun/i);
    expect(sql).not.toMatch(/net\.http_post/i);
  });

  it("does NOT change cron schedules, jobs, RLS, or grants", () => {
    expect(sql).not.toMatch(/cron\.schedule/i);
    expect(sql).not.toMatch(/cron\.unschedule/i);
    expect(sql).not.toMatch(/cron\.alter_job/i);
    expect(sql).not.toMatch(/ENABLE ROW LEVEL SECURITY/i);
    expect(sql).not.toMatch(/DISABLE ROW LEVEL SECURITY/i);
    expect(sql).not.toMatch(/CREATE\s+POLICY/i);
    expect(sql).not.toMatch(/DROP\s+POLICY/i);
    expect(sql).not.toMatch(/^\s*GRANT\s+/im);
    expect(sql).not.toMatch(/^\s*REVOKE\s+/im);
  });

  it("does NOT add new tables, columns, or indexes in this batch", () => {
    expect(sql).not.toMatch(/CREATE\s+TABLE/i);
    expect(sql).not.toMatch(/ALTER\s+TABLE/i);
    expect(sql).not.toMatch(/CREATE\s+(UNIQUE\s+)?INDEX/i);
  });
});
