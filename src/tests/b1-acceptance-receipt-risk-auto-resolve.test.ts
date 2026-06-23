/**
 * B1 — Acceptance-receipt risk auto-resolve migration guard.
 *
 * Source-pattern test pinning that the B1 migration updates
 * public.reconcile_acceptance_notifications() to:
 *   - stamp dedup_key + kind on newly created risk items
 *   - run an auto-resolve pass that only closes open
 *     "Acceptance receipt <id> not notified" rows whose receipt
 *     now has a delivered/opened notification_dispatches row
 *
 * Negative guards: no email send, no dispatch retry, no schedule
 * change, no mutation of notification_dispatches / acceptance_receipts
 * / email_send_log, and pending/failed dispatches MUST NOT trigger
 * auto-resolve.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const MIGRATION = resolve(
  "supabase/migrations/20260623220754_602f1df9-e6bd-4feb-b3b6-a7a3413466aa.sql",
);

const sql = readFileSync(MIGRATION, "utf8");

describe("B1 reconcile_acceptance_notifications auto-resolve", () => {
  it("replaces reconcile_acceptance_notifications in place", () => {
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.reconcile_acceptance_notifications\(\)/,
    );
  });

  it("stamps dedup_key and kind on newly created risk items", () => {
    expect(sql).toMatch(/'acceptance_receipt_not_notified:'\s*\|\|/);
    expect(sql).toMatch(/kind,\s*dedup_key/);
    expect(sql).toMatch(/'acceptance_receipt_not_notified'/);
  });

  it("runs an auto-resolve pass joined to acceptance_receipts by title", () => {
    expect(sql).toMatch(/UPDATE admin_risk_items[\s\S]+SET status = 'resolved'/);
    expect(sql).toMatch(/resolved_at\s*=\s*now\(\)/);
    expect(sql).toMatch(
      /title = format\('Acceptance receipt %s not notified', ar\.id\)/,
    );
  });

  it("only auto-resolves when a delivered or opened email dispatch exists", () => {
    expect(sql).toMatch(
      /nd\.status IN \('delivered',\s*'opened'\)[\s\S]*?\)\s*\),?\s*updated AS/,
    );
  });

  it("does NOT treat pending or failed dispatches as auto-resolve evidence", () => {
    expect(sql).not.toMatch(/status IN \([^)]*'failed'[^)]*\)/);
    expect(sql).not.toMatch(/status IN \([^)]*'pending'[^)]*\)/);
  });

  it("merges auto_resolved_reason metadata", () => {
    expect(sql).toMatch(/auto_resolved_reason/);
    expect(sql).toMatch(/acceptance_receipt_delivered/);
    expect(sql).toMatch(/auto_resolved_by/);
    expect(sql).toMatch(/reconcile_acceptance_notifications/);
  });

  it("does NOT send emails, retry dispatches, or mutate dispatch/receipt/log rows", () => {
    expect(sql).not.toMatch(/INSERT\s+INTO\s+notification_dispatches/i);
    expect(sql).not.toMatch(/UPDATE\s+notification_dispatches/i);
    expect(sql).not.toMatch(/DELETE\s+FROM\s+notification_dispatches/i);
    expect(sql).not.toMatch(/INSERT\s+INTO\s+acceptance_receipts/i);
    expect(sql).not.toMatch(/UPDATE\s+acceptance_receipts/i);
    expect(sql).not.toMatch(/DELETE\s+FROM\s+acceptance_receipts/i);
    expect(sql).not.toMatch(/email_send_log/i);
    expect(sql).not.toMatch(/send-transactional-email/);
    expect(sql).not.toMatch(/mailgun/i);
  });

  it("does NOT change cron schedules or jobs", () => {
    expect(sql).not.toMatch(/cron\.schedule/i);
    expect(sql).not.toMatch(/cron\.unschedule/i);
    expect(sql).not.toMatch(/cron\.alter_job/i);
  });

  it("does NOT add a new index in this batch", () => {
    expect(sql).not.toMatch(/CREATE\s+(UNIQUE\s+)?INDEX/i);
  });
});
