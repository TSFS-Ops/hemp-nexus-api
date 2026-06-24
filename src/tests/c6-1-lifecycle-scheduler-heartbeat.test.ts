/**
 * C6.1 — lifecycle-scheduler-job heartbeat coverage migration guard.
 *
 * Pins that the C6.1 migration converts jobid 3 (lifecycle-scheduler-job)
 * from raw net.http_post to the public.cron_invoke() wrapper and
 * pre-seeds cron_heartbeats with expected_interval_seconds=86400,
 * without changing the schedule, job name, or function URL, and
 * without touching any other jobid.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const MIGRATION = resolve(
  "supabase/migrations/20260624083049_c65d2d90-84fe-493e-8a6f-1f409a50b214.sql",
);

describe("C6.1 lifecycle-scheduler-job heartbeat migration", () => {
  const sql = readFileSync(MIGRATION, "utf8");

  it("uses cron.alter_job on job_id 3", () => {
    expect(sql).toMatch(/cron\.alter_job\s*\(/);
    expect(sql).toMatch(/job_id\s*:=\s*3\b/);
  });

  it("invokes cron_invoke with the 'lifecycle-scheduler' job name", () => {
    expect(sql).toMatch(/cron_invoke\(\s*'lifecycle-scheduler'/);
  });

  it("preserves the lifecycle-scheduler function URL", () => {
    expect(sql).toMatch(/\/functions\/v1\/lifecycle-scheduler\b/);
  });

  it("pre-seeds cron_heartbeats with expected_interval_seconds = 86400", () => {
    expect(sql).toMatch(/INSERT\s+INTO\s+public\.cron_heartbeats/i);
    expect(sql).toMatch(/'lifecycle-scheduler'/);
    expect(sql).toMatch(/expected_interval_seconds[\s\S]{0,80}86400/);
    expect(sql).toMatch(/ON\s+CONFLICT\s*\(\s*job_name\s*\)/i);
  });

  it("does not unschedule or reschedule", () => {
    expect(sql).not.toMatch(/cron\.unschedule/);
    expect(sql).not.toMatch(/cron\.schedule\s*\(/);
  });

  it("does not alter the schedule", () => {
    expect(sql).not.toMatch(/schedule\s*:=\s*'/);
  });

  it("does not touch any jobid other than 3", () => {
    const jobIds = [...sql.matchAll(/job_id\s*:=\s*(\d+)/g)].map((m) => m[1]);
    expect(jobIds.length).toBeGreaterThan(0);
    for (const id of jobIds) expect(id).toBe("3");
  });

  it("does not use net.http_post in the new command", () => {
    expect(sql).not.toMatch(/net\.http_post/);
  });

  it("does not embed a raw Authorization: Bearer JWT", () => {
    expect(sql).not.toMatch(/Bearer\s+eyJ[A-Za-z0-9._-]+/);
  });

  it("does not mutate lifecycle / reminders / engagement / payment / ledger / POI / WaD / registry / notification tables", () => {
    const forbidden = [
      /\bpoi_engagements\b/i,
      /\bpois\b/i,
      /\bwads\b/i,
      /\bmatches\b/i,
      /\btoken_ledger\b/i,
      /\bledger_events\b/i,
      /\btoken_balances\b/i,
      /\btoken_wallets\b/i,
      /\bpayment_disputes\b/i,
      /\brefund_requests\b/i,
      /\bacceptance_receipts\b/i,
      /\bnotification_dispatches\b/i,
      /\bemail_send_log\b/i,
      /\bregistry_/i,
    ];
    for (const pat of forbidden) expect(sql).not.toMatch(pat);
  });

  it("does not edit lifecycle scheduler edge function source", () => {
    // Source-edit markers would not appear in a SQL migration; this is a
    // belt-and-braces pin that the migration body stays SQL-only.
    expect(sql).not.toMatch(/supabase\/functions\/lifecycle-scheduler/);
  });
});
