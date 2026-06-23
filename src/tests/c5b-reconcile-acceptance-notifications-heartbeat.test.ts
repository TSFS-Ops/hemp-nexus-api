import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATION = "20260623232434_925be919-aa3c-4853-9005-76d35e63d979.sql";
const sql = readFileSync(
  join(process.cwd(), "supabase", "migrations", MIGRATION),
  "utf8",
);

describe("C5b — reconcile-acceptance-notifications heartbeat coverage", () => {
  it("pre-seeds cron_heartbeats with 120s expected interval", () => {
    expect(sql).toMatch(/INSERT INTO public\.cron_heartbeats/);
    expect(sql).toMatch(/'reconcile-acceptance-notifications'\s*,\s*120/);
    expect(sql).toMatch(/ON CONFLICT \(job_name\) DO UPDATE/);
  });

  it("creates the dedicated wrapper function", () => {
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.run_reconcile_acceptance_notifications_with_heartbeat\(\)/,
    );
    expect(sql).toMatch(/RETURNS jsonb/);
    expect(sql).toMatch(/LANGUAGE plpgsql/);
    expect(sql).toMatch(/SECURITY DEFINER/);
    expect(sql).toMatch(/SET search_path = public/);
  });

  it("calls public.reconcile_acceptance_notifications() exactly once", () => {
    const matches = sql.match(/public\.reconcile_acceptance_notifications\(\)/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it("stamps success heartbeat with last_status='ok'", () => {
    expect(sql).toMatch(/'ok'/);
    expect(sql).toMatch(/last_status = 'ok'/);
  });

  it("stamps failure heartbeat with last_status='failed' and last_error=SQLERRM", () => {
    expect(sql).toMatch(/EXCEPTION WHEN OTHERS THEN/);
    expect(sql).toMatch(/'failed'/);
    expect(sql).toMatch(/SQLERRM/);
    expect(sql).toMatch(/last_status = 'failed'/);
  });

  it("does not RAISE in the exception block (swallow-and-stamp)", () => {
    // Locate EXCEPTION block and ensure no RAISE inside
    const idx = sql.indexOf("EXCEPTION WHEN OTHERS");
    expect(idx).toBeGreaterThan(-1);
    const exceptionBlock = sql.slice(idx);
    expect(exceptionBlock).not.toMatch(/\bRAISE\b/);
    expect(exceptionBlock).toMatch(/RETURN jsonb_build_object\('status',\s*'failed'/);
  });

  it("uses cron.alter_job(job_id := 21, ...) for the swap", () => {
    expect(sql).toMatch(/cron\.alter_job\(/);
    expect(sql).toMatch(/job_id := 21/);
    expect(sql).toMatch(
      /command := 'SELECT public\.run_reconcile_acceptance_notifications_with_heartbeat\(\);'/,
    );
  });

  it("does NOT use cron.schedule / cron.unschedule / net.http_post / cron_invoke", () => {
    expect(sql).not.toMatch(/cron\.schedule\s*\(/);
    expect(sql).not.toMatch(/cron\.unschedule/);
    expect(sql).not.toMatch(/net\.http_post/);
    expect(sql).not.toMatch(/cron_invoke/);
  });

  it("does NOT touch jobid 20 (dispatch-acceptance-receipts)", () => {
    expect(sql).not.toMatch(/job_id := 20/);
    expect(sql).not.toMatch(/dispatch-acceptance-receipts/);
  });

  it("does NOT mutate notification_dispatches / acceptance_receipts / email_send_log", () => {
    expect(sql).not.toMatch(/UPDATE\s+public\.notification_dispatches/i);
    expect(sql).not.toMatch(/UPDATE\s+public\.acceptance_receipts/i);
    expect(sql).not.toMatch(/UPDATE\s+public\.email_send_log/i);
    expect(sql).not.toMatch(/INSERT\s+INTO\s+public\.notification_dispatches/i);
    expect(sql).not.toMatch(/INSERT\s+INTO\s+public\.acceptance_receipts/i);
    expect(sql).not.toMatch(/INSERT\s+INTO\s+public\.email_send_log/i);
  });

  it("does NOT send emails or call providers", () => {
    expect(sql).not.toMatch(/mailgun/i);
    expect(sql).not.toMatch(/resend/i);
    expect(sql).not.toMatch(/sendgrid/i);
  });
});
