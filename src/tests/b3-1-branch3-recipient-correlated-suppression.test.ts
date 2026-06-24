/**
 * B3.1 — Branch 3 micro-repair: narrow email_send_log suppression
 * to recipient-correlated logs only. Unrelated acceptance-receipt
 * email logs must not block NULL-recipient/no-dispatch cutoff-boundary
 * artefacts.
 *
 * Source-pattern guards. No DB, no email, no provider, no cron, no
 * RLS, no grant, no index, no column changes.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const MIGRATION = resolve(
  "supabase/migrations/20260624075820_e5ab32ea-1ba3-4762-b3b2-9d78c8dd777f.sql",
);
const sql = readFileSync(MIGRATION, "utf8");

describe("B3.1 — function replacement", () => {
  it("replaces reconcile_acceptance_notifications in place", () => {
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.reconcile_acceptance_notifications\(\)/,
    );
    expect(sql).toMatch(/SECURITY DEFINER/);
    expect(sql).toMatch(/SET search_path TO 'public'/);
  });

  it("preserves B1, B2, B3 Branch 1, B3 Branch 2 reasons", () => {
    expect(sql).toMatch(/'acceptance_receipt_delivered'/);
    expect(sql).toMatch(/'acceptance_receipt_pre_backfill_no_dispatch'/);
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

  it("preserves cutoff literals", () => {
    expect(sql).toMatch(
      /v_dispatch_backfill_cutoff\s+timestamptz\s*:=\s*'2026-04-23 09:46:24\+00'/,
    );
    expect(sql).toMatch(
      /v_inclusive_backfill_cutoff\s+timestamptz\s*:=\s*'2026-04-23 09:46:24\.999999\+00'::timestamptz/,
    );
  });
});

describe("B3.1 — Branch 3 ESL suppression is recipient-correlated", () => {
  it("Branch 3 base criteria still require NULL recipient on the receipt", () => {
    expect(sql).toMatch(/ar\.counterparty_email\s+IS NULL/);
    expect(sql).toMatch(/ar\.accepting_user_email\s+IS NULL/);
  });

  it("Branch 3 ESL suppression no longer uses a bare unrelated-template predicate", () => {
    // Locate the Branch 3 CTE region between the marker and the
    // updated_b3c CTE name; assert the inner email_send_log NOT EXISTS
    // contains the recipient-correlation predicates.
    const b3cStart = sql.indexOf("to_resolve_b3c");
    const b3cEnd = sql.indexOf("updated_b3c");
    expect(b3cStart).toBeGreaterThan(0);
    expect(b3cEnd).toBeGreaterThan(b3cStart);
    const branch3 = sql.slice(b3cStart, b3cEnd);

    // Must include recipient correlation against counterparty_email,
    // accepting_user_email, and dispatch recipient_address.
    expect(branch3).toMatch(
      /ar\.counterparty_email\s+IS NOT NULL AND esl\.recipient_email = ar\.counterparty_email/,
    );
    expect(branch3).toMatch(
      /ar\.accepting_user_email\s+IS NOT NULL AND esl\.recipient_email = ar\.accepting_user_email/,
    );
    expect(branch3).toMatch(/nd2\.recipient_address IS NOT NULL/);
    expect(branch3).toMatch(/esl\.recipient_email = nd2\.recipient_address/);

    // Must still require no dispatch row.
    expect(branch3).toMatch(/NOT EXISTS \(\s*SELECT 1 FROM notification_dispatches nd\s+WHERE nd\.reference_type = 'acceptance_receipt'/);
  });

  it("Branch 3 still excludes post-cutoff rows via inclusive comparison", () => {
    const b3cStart = sql.indexOf("to_resolve_b3c");
    const b3cEnd = sql.indexOf("updated_b3c");
    const branch3 = sql.slice(b3cStart, b3cEnd);
    expect(branch3).toMatch(
      /ar\.created_at\s*<=\s*v_inclusive_backfill_cutoff/,
    );
  });
});

describe("B3.1 — trigger-guard bypass and audit trail preserved", () => {
  it("uses set_config bypass at least once per resolve block (>= 5)", () => {
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

  it("writes admin_audit_logs for each branch", () => {
    const auditMatches = sql.match(/INSERT\s+INTO\s+admin_audit_logs/g);
    expect(auditMatches).not.toBeNull();
    expect(auditMatches!.length).toBeGreaterThanOrEqual(5);
    expect(sql).toMatch(/'admin_risk_item\.auto_resolved'/);
    expect(sql).toMatch(/'source'[^,]*,\s*'reconcile_acceptance_notifications'/);
    expect(sql).toMatch(/'inclusive_backfill_cutoff'/);
  });
});

describe("B3.1 — return shape preserved", () => {
  it("preserves base + B3 keys", () => {
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

describe("B3.1 — negative scope guards", () => {
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
