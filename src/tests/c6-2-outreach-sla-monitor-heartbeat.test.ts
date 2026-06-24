import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// C6.2 guard: outreach-sla-monitor-hourly heartbeat coverage conversion.
// Pins the migration to a strictly-scoped cron.alter_job on jobid 17 only,
// with no schedule/active change, no raw bearer JWT, and a correctly-shaped
// public.cron_invoke() call against the outreach-sla-monitor function URL.

const MIGRATION_PATH = resolve(
  __dirname,
  "../../supabase/migrations/20260624085422_a35c3f68-75fa-431c-bcde-43280dd84d5f.sql",
);

const sql = readFileSync(MIGRATION_PATH, "utf8");

describe("C6.2 outreach-sla-monitor heartbeat coverage migration", () => {
  it("uses cron.alter_job targeting job_id := 17", () => {
    expect(sql).toMatch(/cron\.alter_job\s*\(\s*job_id\s*:=\s*17\b/);
  });

  it("does not reference any other jobid", () => {
    // Match any 'job_id := <n>' literal and assert it equals 17.
    const matches = [...sql.matchAll(/job_id\s*:=\s*(\d+)/g)];
    expect(matches.length).toBeGreaterThan(0);
    for (const m of matches) expect(m[1]).toBe("17");
  });

  it("does not use cron.schedule", () => {
    expect(sql).not.toMatch(/cron\.schedule\s*\(/);
  });

  it("does not use cron.unschedule", () => {
    expect(sql).not.toMatch(/cron\.unschedule\s*\(/);
  });

  it("does not alter the schedule", () => {
    expect(sql).not.toMatch(/\bschedule\s*:=/);
  });

  it("does not alter the active flag", () => {
    expect(sql).not.toMatch(/\bactive\s*:=/);
  });

  it("calls public.cron_invoke for the outreach-sla-monitor job", () => {
    expect(sql).toMatch(/public\.cron_invoke\s*\(\s*'outreach-sla-monitor'/);
  });

  it("uses the exact outreach-sla-monitor function URL", () => {
    expect(sql).toContain(
      "https://ugrfyhwlonlmlcmcpcdm.supabase.co/functions/v1/outreach-sla-monitor",
    );
  });

  it("preserves the payload fields trigger, time, and source", () => {
    expect(sql).toMatch(/'trigger'\s*,\s*'cron'/);
    expect(sql).toMatch(/'time'\s*,\s*now\(\)/);
    expect(sql).toMatch(/'source'\s*,\s*'cron:outreach-sla-monitor-hourly'/);
  });

  it("seeds cron_heartbeats for job_name='outreach-sla-monitor'", () => {
    expect(sql).toMatch(/INSERT\s+INTO\s+public\.cron_heartbeats[\s\S]*'outreach-sla-monitor'/i);
  });

  it("seeds expected_interval_seconds=3600 (hourly)", () => {
    expect(sql).toMatch(/3600/);
    expect(sql).toMatch(/expected_interval_seconds/);
  });

  it("does not contain a hard-coded Bearer JWT", () => {
    expect(sql).not.toMatch(/Bearer\s+eyJ/);
  });

  it("does not contain an Authorization header literal", () => {
    expect(sql).not.toMatch(/Authorization/i);
  });

  it("does not call net.http_post directly in the new command", () => {
    // Strip SQL line comments before matching so descriptive header text
    // referring to the prior net.http_post shape doesn't trip the guard.
    const stripped = sql
      .split("\n")
      .map((l) => l.replace(/--.*$/, ""))
      .join("\n");
    expect(stripped).not.toMatch(/net\.http_post\s*\(/);
  });

  it("does not mutate outreach or business tables", () => {
    const forbidden = [
      "poi_engagements",
      "audit_logs",
      "admin_audit_logs",
      "admin_settings",
      "notification_dispatches",
      "notifications",
      "email_send_log",
      "acceptance_receipts",
      "wads",
      "matches",
      "pois",
      "token_ledger",
      "ledger_events",
      "token_balances",
      "token_wallets",
      "refund_requests",
      "payment_disputes",
    ];
    for (const tbl of forbidden) {
      // Allow the table name to appear inside SQL only if NOT inside an INSERT/UPDATE/DELETE.
      const mutationRegex = new RegExp(
        `\\b(INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+(public\\.)?${tbl}\\b`,
        "i",
      );
      expect(sql).not.toMatch(mutationRegex);
    }
  });
});
