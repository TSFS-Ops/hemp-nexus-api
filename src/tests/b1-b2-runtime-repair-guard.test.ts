/**
 * B1/B2 runtime repair — reconcile_acceptance_notifications must
 * resolve via the transaction-local app.allow_risk_item_update GUC
 * bypass (the same approved pattern used by resolve_admin_risk_item
 * and system_resolve_cron_risk_items), and must emit an
 * admin_audit_logs entry per auto-resolved risk item.
 *
 * Source-pattern guards. No DB, no email, no dispatch, no cron, no
 * RLS, no grant, no index, no provider — anywhere in the migration.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const MIGRATION = resolve(
  "supabase/migrations/20260624042959_7ed4b54e-aa6f-4b38-ad2a-69d62610004b.sql",
);
const sql = readFileSync(MIGRATION, "utf8");

describe("B1/B2 runtime repair — trigger-guard bypass + audit trail", () => {
  it("replaces reconcile_acceptance_notifications in place", () => {
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.reconcile_acceptance_notifications\(\)/,
    );
    expect(sql).toMatch(/SECURITY DEFINER/);
    expect(sql).toMatch(/SET search_path TO 'public'/);
  });

  it("uses the transaction-local GUC bypass before each status UPDATE block", () => {
    const matches = sql.match(
      /PERFORM\s+set_config\(\s*'app\.allow_risk_item_update'\s*,\s*'on'\s*,\s*true\s*\)/g,
    );
    expect(matches).not.toBeNull();
    expect(matches!.length).toBeGreaterThanOrEqual(2);
  });

  it("never calls resolve_admin_risk_item from the reconciler", () => {
    expect(sql).not.toMatch(/resolve_admin_risk_item\s*\(/);
  });

  it("does not perform a direct status UPDATE outside the GUC pattern", () => {
    // Every UPDATE admin_risk_items ... SET status='resolved' must be
    // preceded by a set_config bypass earlier in the function body.
    const updateRe =
      /UPDATE\s+admin_risk_items[\s\S]*?SET[\s\S]*?status\s*=\s*'resolved'/gi;
    let m: RegExpExecArray | null;
    while ((m = updateRe.exec(sql)) !== null) {
      const upto = sql.slice(0, m.index);
      expect(upto).toMatch(
        /PERFORM\s+set_config\(\s*'app\.allow_risk_item_update'\s*,\s*'on'\s*,\s*true\s*\)/,
      );
    }
  });
});

describe("B1/B2 audit trail", () => {
  it("inserts admin_audit_logs rows with the system action", () => {
    expect(sql).toMatch(/INSERT\s+INTO\s+admin_audit_logs/);
    expect(sql).toMatch(/'admin_risk_item\.auto_resolved'/);
    expect(sql).toMatch(/'admin_risk_item'/);
  });

  it("stamps both reason strings and a NULL admin_user_id for system resolves", () => {
    expect(sql).toMatch(/'acceptance_receipt_delivered'/);
    expect(sql).toMatch(/'acceptance_receipt_pre_backfill_no_dispatch'/);
    expect(sql).toMatch(
      /SELECT\s+NULL,\s*\n?\s*'admin_risk_item\.auto_resolved'/,
    );
  });

  it("carries source = reconcile_acceptance_notifications in audit details", () => {
    expect(sql).toMatch(/'source'[^,]*,\s*'reconcile_acceptance_notifications'/);
  });
});

describe("B1/B2 matching criteria preserved", () => {
  it("B1 delivered/opened-only criteria unchanged", () => {
    expect(sql).toMatch(
      /nd\.status IN \('delivered',\s*'opened'\)/,
    );
    expect(sql).not.toMatch(/nd\.status IN \([^)]*'failed'[^)]*\)/);
    expect(sql).not.toMatch(/nd\.status IN \([^)]*'pending'[^)]*\)/);
  });

  it("B1 metadata fields are preserved in jsonb", () => {
    expect(sql).toMatch(/'auto_resolved_reason',\s*'acceptance_receipt_delivered'/);
    expect(sql).toMatch(/'auto_resolved_by',\s*'reconcile_acceptance_notifications'/);
    expect(sql).toMatch(/'auto_resolved_at'/);
  });

  it("B2 pre-backfill cutoff constant unchanged", () => {
    expect(sql).toMatch(
      /v_dispatch_backfill_cutoff\s+timestamptz\s*:=\s*'2026-04-23 09:46:24\+00'::timestamptz/,
    );
  });

  it("B2 requires no notification_dispatches and no email_send_log evidence", () => {
    expect(sql).toMatch(
      /NOT EXISTS \(\s*SELECT 1 FROM notification_dispatches nd\s+WHERE nd\.reference_type = 'acceptance_receipt'/,
    );
    expect(sql).toMatch(
      /NOT EXISTS \(\s*SELECT 1 FROM email_send_log esl[\s\S]*template_name = 'acceptance-receipt'/,
    );
    expect(sql).toMatch(
      /BETWEEN ar\.created_at - interval '1 day'\s+AND ar\.created_at \+ interval '7 days'/,
    );
  });

  it("B2 metadata fields including pre_backfill_cutoff are preserved", () => {
    expect(sql).toMatch(
      /'auto_resolved_reason',\s*'acceptance_receipt_pre_backfill_no_dispatch'/,
    );
    expect(sql).toMatch(/'pre_backfill_cutoff'/);
  });

  it("only acts on acceptance-receipt 'not notified' titles", () => {
    expect(sql).toMatch(/title LIKE 'Acceptance receipt % not notified'/);
  });
});

describe("Return shape preserved", () => {
  it("returns checked_at, alarms_raised, auto_resolved, pre_backfill_auto_resolved", () => {
    expect(sql).toMatch(/'checked_at'/);
    expect(sql).toMatch(/'alarms_raised'/);
    expect(sql).toMatch(/'auto_resolved'/);
    expect(sql).toMatch(/'pre_backfill_auto_resolved'/);
  });
});

describe("Negative scope guards", () => {
  it("does NOT mutate notification_dispatches, acceptance_receipts, or email_send_log", () => {
    expect(sql).not.toMatch(/INSERT\s+INTO\s+notification_dispatches/i);
    expect(sql).not.toMatch(/UPDATE\s+notification_dispatches/i);
    expect(sql).not.toMatch(/DELETE\s+FROM\s+notification_dispatches/i);
    expect(sql).not.toMatch(/INSERT\s+INTO\s+acceptance_receipts/i);
    expect(sql).not.toMatch(/UPDATE\s+acceptance_receipts/i);
    expect(sql).not.toMatch(/DELETE\s+FROM\s+acceptance_receipts/i);
    expect(sql).not.toMatch(/INSERT\s+INTO\s+email_send_log/i);
    expect(sql).not.toMatch(/UPDATE\s+email_send_log/i);
    expect(sql).not.toMatch(/DELETE\s+FROM\s+email_send_log/i);
  });

  it("does NOT touch cron, RLS, grants, indexes, or providers", () => {
    expect(sql).not.toMatch(/cron\.schedule/i);
    expect(sql).not.toMatch(/cron\.unschedule/i);
    expect(sql).not.toMatch(/cron\.alter_job/i);
    expect(sql).not.toMatch(/CREATE\s+POLICY/i);
    expect(sql).not.toMatch(/ALTER\s+POLICY/i);
    expect(sql).not.toMatch(/DROP\s+POLICY/i);
    expect(sql).not.toMatch(/\bGRANT\b/i);
    expect(sql).not.toMatch(/\bREVOKE\b/i);
    expect(sql).not.toMatch(/CREATE\s+(UNIQUE\s+)?INDEX/i);
    expect(sql).not.toMatch(/ALTER\s+TABLE\s+admin_risk_items\s+ADD\s+COLUMN/i);
    expect(sql).not.toMatch(/send-transactional-email/);
    expect(sql).not.toMatch(/mailgun/i);
    expect(sql).not.toMatch(/resend/i);
  });
});
