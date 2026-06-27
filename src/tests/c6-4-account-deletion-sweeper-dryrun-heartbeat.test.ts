/**
 * C6.4 — account-deletion-sweeper-daily-dryrun heartbeat coverage migration guard.
 *
 * Pins that the C6.4 migration:
 *  - alters only jobid 25,
 *  - converts the cron command from raw net.http_post to public.cron_invoke,
 *  - preserves dry-run safety (dry_run=true, no confirm, no HARD_DELETE),
 *  - seeds cron_heartbeats for 'account-deletion-sweeper' with 86400s interval,
 *  - does not touch any other cron job, schedule, active flag, or business table.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const MIGRATION = resolve(
  "supabase/migrations/20260627213919_53d698b6-f460-4139-a000-da000ca9eb75.sql",
);
const sql = readFileSync(MIGRATION, "utf8");
const stripped = sql.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");

const EVIDENCE_README = resolve(
  "evidence/c6-chron-observability/account-deletion-sweeper-dryrun-heartbeat/README.md",
);
const evidence = readFileSync(EVIDENCE_README, "utf8");

describe("C6.4 account-deletion-sweeper-daily-dryrun heartbeat migration", () => {
  it("documents the pre-apply cron_invoke payload-preservation safety check", () => {
    expect(evidence).toMatch(/cron_invoke/i);
    expect(evidence).toMatch(/preserve|preservation/i);
    expect(evidence).toMatch(/COALESCE\s*\(\s*p_body/i);
  });

  it("uses cron.alter_job targeting job_id := 25 only", () => {
    expect(sql).toMatch(/cron\.alter_job\s*\(/);
    const jobIds = [...sql.matchAll(/job_id\s*:=\s*(\d+)/g)].map((m) => m[1]);
    expect(jobIds.length).toBeGreaterThan(0);
    for (const id of jobIds) expect(id).toBe("25");
  });

  it("does not unschedule, schedule, or alter the schedule/active flag", () => {
    expect(sql).not.toMatch(/cron\.schedule\s*\(/);
    expect(sql).not.toMatch(/cron\.unschedule\s*\(/);
    expect(sql).not.toMatch(/\bschedule\s*:=/);
    expect(sql).not.toMatch(/\bactive\s*:=/);
  });

  it("new command uses public.cron_invoke with the correct job name and URL", () => {
    expect(sql).toMatch(/public\.cron_invoke\s*\(/);
    expect(sql).toMatch(/'account-deletion-sweeper'/);
    expect(sql).toMatch(/\/functions\/v1\/account-deletion-sweeper\b/);
  });

  it("payload preserves dry-run safety keys", () => {
    expect(sql).toMatch(/'dry_run'\s*,\s*true/);
    expect(sql).toMatch(/'max_rows'\s*,\s*50/);
    expect(sql).toMatch(/'source'\s*,\s*'cron:account-deletion-sweeper-daily-dryrun'/);
    expect(sql).toMatch(/'trigger'\s*,\s*'cron'/);
    expect(sql).toMatch(/'time'\s*,\s*now\(\)/);
  });

  it("payload contains no destructive flags", () => {
    expect(stripped).not.toMatch(/'dry_run'\s*,\s*false/i);
    expect(stripped).not.toMatch(/confirm/i);
    expect(stripped).not.toMatch(/HARD_DELETE/);
  });

  it("does not embed Authorization / Bearer JWT / anon JWT / direct net.http_post in cron command", () => {
    expect(stripped).not.toMatch(/Authorization/i);
    expect(stripped).not.toMatch(/Bearer\s+eyJ/);
    // The cron command itself must not use net.http_post; the wrapper does that internally.
    const alterMatch = sql.match(/cron\.alter_job[\s\S]*?\);/);
    expect(alterMatch).toBeTruthy();
    expect(alterMatch![0]).not.toMatch(/net\.http_post/i);
  });

  it("seeds cron_heartbeats for 'account-deletion-sweeper' with 86400s interval", () => {
    expect(sql).toMatch(/INSERT\s+INTO\s+public\.cron_heartbeats/i);
    expect(sql).toMatch(/'account-deletion-sweeper'/);
    expect(sql).toMatch(/86400/);
    expect(sql).toMatch(/ON\s+CONFLICT\s*\(\s*job_name\s*\)/i);
  });

  it("does not deploy or edit edge function source", () => {
    expect(sql).not.toMatch(/supabase\/functions\/account-deletion-sweeper/);
  });

  it("does not mutate account/user/profile/org or other business tables", () => {
    const forbidden = [
      "profiles", "auth.users", "user_roles",
      "pois", "poi_engagements", "wads", "matches",
      "token_ledger", "ledger_events", "token_balances", "token_wallets",
      "payment_disputes", "refund_requests", "acceptance_receipts",
      "notification_dispatches", "notifications", "email_send_log",
      "audit_logs", "admin_audit_logs", "admin_risk_items",
      "retention_flags", "storage_deletion_queue", "compliance_holds", "legal_holds",
    ];
    for (const tbl of forbidden) {
      const re = new RegExp(
        `\\b(INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+(public\\.)?${tbl.replace(".", "\\.")}\\b`,
        "i",
      );
      expect(sql).not.toMatch(re);
    }
  });

  it("does not touch any other C6 job (especially jobid 18)", () => {
    expect(sql).not.toMatch(/job_id\s*:=\s*18\b/);
    expect(sql).not.toMatch(/job_id\s*:=\s*3\b/);
    expect(sql).not.toMatch(/job_id\s*:=\s*20\b/);
    expect(sql).not.toMatch(/job_id\s*:=\s*21\b/);
    expect(sql).not.toMatch(/cleanup-expired-unsubscribe-tokens/);
    expect(sql).not.toMatch(/lifecycle-scheduler/);
    expect(sql).not.toMatch(/outreach-sla-monitor/);
  });
});
