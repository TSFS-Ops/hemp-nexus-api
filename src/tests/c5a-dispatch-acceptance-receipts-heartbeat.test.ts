/**
 * C5a — heartbeat coverage migration guard.
 *
 * Pins that the C5a migration converts jobid 20
 * (dispatch-acceptance-receipts) from raw net.http_post to the
 * public.cron_invoke() wrapper and pre-seeds cron_heartbeats with
 * expected_interval_seconds=120, without changing the schedule, job
 * name, or the function URL, and without touching jobid 21.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const MIGRATION = resolve(
  "supabase/migrations/20260623202036_fcdd236e-52b3-446a-8350-f79c27684a7e.sql",
);

describe("C5a dispatch-acceptance-receipts heartbeat migration", () => {
  const sql = readFileSync(MIGRATION, "utf8");

  it("uses cron.alter_job on job_id 20", () => {
    expect(sql).toMatch(/cron\.alter_job\s*\(/);
    expect(sql).toMatch(/job_id\s*:=\s*20\b/);
  });

  it("invokes cron_invoke with the dispatch-acceptance-receipts job name", () => {
    expect(sql).toMatch(
      /cron_invoke\(\s*'dispatch-acceptance-receipts'/,
    );
  });

  it("preserves the dispatch-acceptance-receipts function URL", () => {
    expect(sql).toMatch(
      /\/functions\/v1\/dispatch-acceptance-receipts/,
    );
  });

  it("pre-seeds cron_heartbeats with expected_interval_seconds = 120", () => {
    expect(sql).toMatch(/INSERT\s+INTO\s+public\.cron_heartbeats/i);
    expect(sql).toMatch(/'dispatch-acceptance-receipts'/);
    expect(sql).toMatch(/expected_interval_seconds[\s\S]{0,80}120/);
    expect(sql).toMatch(/ON\s+CONFLICT\s*\(\s*job_name\s*\)/i);
  });

  it("does not unschedule or reschedule", () => {
    expect(sql).not.toMatch(/cron\.unschedule/);
    expect(sql).not.toMatch(/cron\.schedule\s*\(/);
  });

  it("does not touch jobid 21 (reconcile-acceptance-notifications)", () => {
    expect(sql).not.toMatch(/job_id\s*:=\s*21\b/);
    expect(sql).not.toMatch(/reconcile-acceptance-notifications/);
  });

  it("does not change the every-2-minute schedule", () => {
    // No schedule := '...' assignment of any kind.
    expect(sql).not.toMatch(/schedule\s*:=\s*'/);
  });

  it("does not embed a raw Authorization: Bearer JWT", () => {
    expect(sql).not.toMatch(/Authorization["'\s:]+Bearer\s+eyJ/i);
    expect(sql).not.toMatch(/Bearer\s+eyJ[A-Za-z0-9._-]+/);
  });
});
