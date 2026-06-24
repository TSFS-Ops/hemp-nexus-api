/**
 * B3 cutoff-inclusive acceptance-receipt residual auto-resolve.
 *
 * Source-pattern guard test. Pins the third auto-resolve pass added to
 * public.reconcile_acceptance_notifications() and confirms strict scope:
 * no email, no provider, no dispatch, no cron, no RLS, no grant.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const MIGRATION = resolve(
  "supabase/migrations/20260624075000_e03cef59-03aa-4265-8ee8-1b99f25f55f3.sql",
);
const sql = readFileSync(MIGRATION, "utf8");

describe("B3 — function replacement", () => {
  it("replaces reconcile_acceptance_notifications in place", () => {
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.reconcile_acceptance_notifications\(\)/,
    );
    expect(sql).toMatch(/SECURITY DEFINER/);
    expect(sql).toMatch(/SET search_path TO 'public'/);
  });

  it("preserves B1 + B2 passes", () => {
    expect(sql).toMatch(/'acceptance_receipt_delivered'/);
    expect(sql).toMatch(/'acceptance_receipt_pre_backfill_no_dispatch'/);
    expect(sql).toMatch(
      /v_dispatch_backfill_cutoff\s+timestamptz\s*:=\s*'2026-04-23 09:46:24\+00'/,
    );
  });
});

describe("B3 — inclusive cutoff + branch reasons", () => {
  it("declares the inclusive backfill cutoff literal", () => {
    expect(sql).toMatch(
      /v_inclusive_backfill_cutoff\s+timestamptz\s*:=\s*'2026-04-23 09:46:24\.999999\+00'::timestamptz/,
    );
    // Inclusive comparison used at least three times (one per branch).
    const matches = sql.match(/ar\.created_at\s*<=\s*v_inclusive_backfill_cutoff/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBeGreaterThanOrEqual(3);
  });

  it("emits all three branch reason strings", () => {
    expect(sql).toMatch(
      /'acceptance_receipt_pre_backfill_email_send_unverifiable_terminal'/,
    );
    expect(sql).toMatch(
      /'acceptance_receipt_pre_backfill_email_send_log_evidence'/,
    );
    expect(sql).toMatch(
      /'acceptance_receipt_pre_backfill_cutoff_boundary_no_recipient'/,
    );
  });

  it("branch 1 requires in-app delivered/opened AND terminal send_unverifiable email failure", () => {
    expect(sql).toMatch(/nd\.channel\s*=\s*'in_app'/);
    expect(sql).toMatch(/nd\.status IN \('delivered',\s*'opened'\)/);
    expect(sql).toMatch(/nd\.status\s*=\s*'failed'/);
    expect(sql).toMatch(/ILIKE\s*'%send_unverifiable%'/);
  });

  it("branch 2 keys on email_send_log within [-1d, +7d] and template acceptance-receipt", () => {
    expect(sql).toMatch(/template_name = 'acceptance-receipt'/);
    expect(sql).toMatch(
      /BETWEEN ar\.created_at - interval '1 day'\s+AND ar\.created_at \+ interval '7 days'/,
    );
  });

  it("branch 3 requires NULL recipient AND no dispatch AND no email log", () => {
    expect(sql).toMatch(/ar\.counterparty_email\s+IS NULL/);
    expect(sql).toMatch(/ar\.accepting_user_email\s+IS NULL/);
  });
});

describe("B3 — trigger-guard bypass and audit trail", () => {
  it("uses set_config bypass before each B3 update block (>= 5 total: detection-skip, B1, B2, plus 3 B3)", () => {
    const matches = sql.match(
      /PERFORM\s+set_config\(\s*'app\.allow_risk_item_update'\s*,\s*'on'\s*,\s*true\s*\)/g,
    );
    expect(matches).not.toBeNull();
    expect(matches!.length).toBeGreaterThanOrEqual(5);
  });

  it("every status='resolved' UPDATE is preceded by the GUC bypass", () => {
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

  it("writes admin_audit_logs rows for each B3 branch", () => {
    const auditMatches = sql.match(/INSERT\s+INTO\s+admin_audit_logs/g);
    expect(auditMatches).not.toBeNull();
    // B1 + B2 + B3a + B3b + B3c = 5
    expect(auditMatches!.length).toBeGreaterThanOrEqual(5);
    expect(sql).toMatch(/'admin_risk_item\.auto_resolved'/);
    expect(sql).toMatch(
      /'source'[^,]*,\s*'reconcile_acceptance_notifications'/,
    );
    expect(sql).toMatch(/'inclusive_backfill_cutoff'/);
  });
});

describe("B3 — return shape", () => {
  it("preserves base keys and adds B3 counters", () => {
    expect(sql).toMatch(/'checked_at'/);
    expect(sql).toMatch(/'alarms_raised'/);
    expect(sql).toMatch(/'auto_resolved'/);
    expect(sql).toMatch(/'pre_backfill_auto_resolved'/);
    expect(sql).toMatch(/'cutoff_boundary_auto_resolved'/);
    expect(sql).toMatch(/'pre_backfill_send_unverifiable_auto_resolved'/);
    expect(sql).toMatch(/'pre_backfill_email_log_auto_resolved'/);
    expect(sql).toMatch(/'pre_backfill_no_recipient_auto_resolved'/);
  });
});

describe("B3 — negative scope guards", () => {
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

  it("does NOT touch cron, RLS, grants, indexes, columns, or providers", () => {
    expect(sql).not.toMatch(/cron\.schedule/i);
    expect(sql).not.toMatch(/cron\.unschedule/i);
    expect(sql).not.toMatch(/cron\.alter_job/i);
    expect(sql).not.toMatch(/CREATE\s+POLICY/i);
    expect(sql).not.toMatch(/ALTER\s+POLICY/i);
    expect(sql).not.toMatch(/DROP\s+POLICY/i);
    expect(sql).not.toMatch(/\bGRANT\b/i);
    expect(sql).not.toMatch(/\bREVOKE\b/i);
    expect(sql).not.toMatch(/CREATE\s+(UNIQUE\s+)?INDEX/i);
    expect(sql).not.toMatch(
      /ALTER\s+TABLE\s+admin_risk_items\s+ADD\s+COLUMN/i,
    );
    expect(sql).not.toMatch(/send-transactional-email/);
    expect(sql).not.toMatch(/mailgun/i);
    expect(sql).not.toMatch(/resend/i);
  });

  it("only acts on acceptance-receipt 'not notified' titles", () => {
    expect(sql).toMatch(/title LIKE 'Acceptance receipt % not notified'/);
  });

  it("never calls resolve_admin_risk_item", () => {
    expect(sql).not.toMatch(/resolve_admin_risk_item\s*\(/);
  });
});
