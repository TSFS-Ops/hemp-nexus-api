import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATION = "20260624064317_42e9aa12-8084-4a18-a375-68bc341af075.sql";
const sql = readFileSync(
  join(process.cwd(), "supabase", "migrations", MIGRATION),
  "utf8",
);

describe("C5c — heartbeat status literal repair", () => {
  it("replaces the C5b wrapper function", () => {
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.run_reconcile_acceptance_notifications_with_heartbeat\(\)/,
    );
    expect(sql).toMatch(/RETURNS jsonb/);
    expect(sql).toMatch(/SECURITY DEFINER/);
    expect(sql).toMatch(/SET search_path TO 'public'/);
  });

  it("success path stamps last_status='success' (canonical), not 'ok'", () => {
    expect(sql).toMatch(/last_status\s*=\s*'success'/);
    expect(sql).toMatch(/'success',\s*NULL,\s*NULL,\s*NULL,\s*120/);
    expect(sql).not.toMatch(/'ok'/);
    expect(sql).not.toMatch(/last_status\s*=\s*'ok'/);
  });

  it("failure path stamps last_status='failed' with SQLERRM and no RAISE", () => {
    expect(sql).toMatch(/EXCEPTION WHEN OTHERS THEN/);
    expect(sql).toMatch(/last_status\s*=\s*'failed'/);
    expect(sql).toMatch(/SQLERRM/);
    const exceptionBlock = sql.slice(sql.indexOf("EXCEPTION WHEN OTHERS"));
    expect(exceptionBlock).not.toMatch(/\bRAISE\b/);
    expect(exceptionBlock).toMatch(/RETURN jsonb_build_object\('status',\s*'failed'/);
  });

  it("preserves expected_interval_seconds = 120", () => {
    expect(sql).toMatch(/120/);
  });

  it("calls reconcile_acceptance_notifications() exactly once", () => {
    const matches = sql.match(/public\.reconcile_acceptance_notifications\(\)/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it("does NOT alter cron_heartbeats constraints or table", () => {
    expect(sql).not.toMatch(/ALTER TABLE\s+public\.cron_heartbeats/i);
    expect(sql).not.toMatch(/cron_heartbeats_last_status_check/i);
    expect(sql).not.toMatch(/DROP CONSTRAINT/i);
    expect(sql).not.toMatch(/ADD CONSTRAINT/i);
    expect(sql).not.toMatch(/CHECK\s*\(/i);
  });

  it("does NOT change cron schedule/jobs", () => {
    expect(sql).not.toMatch(/cron\.schedule\s*\(/);
    expect(sql).not.toMatch(/cron\.unschedule/);
    expect(sql).not.toMatch(/cron\.alter_job/);
  });

  it("does NOT mutate dispatch/receipt/email tables or change B1/B2 criteria", () => {
    expect(sql).not.toMatch(/notification_dispatches/i);
    expect(sql).not.toMatch(/acceptance_receipts/i);
    expect(sql).not.toMatch(/email_send_log/i);
    expect(sql).not.toMatch(/admin_risk_items/i);
    expect(sql).not.toMatch(/reconcile_acceptance_notifications\s+RETURNS/i);
  });

  it("does NOT call providers or retry dispatches", () => {
    expect(sql).not.toMatch(/mailgun/i);
    expect(sql).not.toMatch(/resend/i);
    expect(sql).not.toMatch(/sendgrid/i);
    expect(sql).not.toMatch(/net\.http_post/i);
  });

  it("does NOT touch RLS or grants", () => {
    expect(sql).not.toMatch(/ENABLE ROW LEVEL SECURITY/i);
    expect(sql).not.toMatch(/CREATE POLICY/i);
    expect(sql).not.toMatch(/^\s*GRANT\b/im);
  });
});
