/**
 * C6.5 — purge-email-send-log-daily-dryrun heartbeat coverage migration guard.
 *
 * Pins that the C6.5 migration:
 *  - alters only jobid 39 (does not touch jobid 42 / live),
 *  - converts the cron command from raw net.http_post to public.cron_invoke,
 *  - uses a SEPARATE heartbeat name from the live job,
 *  - preserves dry-run safety (dry_run=true, no confirm, no HARD_DELETE),
 *  - seeds cron_heartbeats for 'purge-email-send-log-daily-dryrun' at 86400s,
 *  - does not touch schedule, active flag, edge function source, or business tables.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const MIGRATION = resolve(
  "supabase/migrations/20260628131231_b156043b-02d0-415b-805f-d47891783cef.sql",
);
const sql = readFileSync(MIGRATION, "utf8");
const stripped = sql.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");

const EVIDENCE = resolve(
  "evidence/c6-chron-observability/purge-email-send-log-dryrun-heartbeat/README.md",
);
const evidence = readFileSync(EVIDENCE, "utf8");

describe("C6.5 purge-email-send-log-daily-dryrun heartbeat migration", () => {
  it("documents the pre-apply cron_invoke payload-preservation safety check", () => {
    expect(evidence).toMatch(/cron_invoke/i);
    expect(evidence).toMatch(/preserv/i);
    expect(evidence).toMatch(/COALESCE\s*\(\s*p_body/i);
  });

  it("uses cron.alter_job targeting job_id := 39 only", () => {
    expect(sql).toMatch(/cron\.alter_job\s*\(/);
    const jobIds = [...sql.matchAll(/job_id\s*:=\s*(\d+)/g)].map((m) => m[1]);
    expect(jobIds.length).toBeGreaterThan(0);
    for (const id of jobIds) expect(id).toBe("39");
  });

  it("does not reference or alter jobid 42 (live)", () => {
    expect(sql).not.toMatch(/job_id\s*:=\s*42\b/);
    expect(stripped).not.toMatch(/purge-email-send-log-daily-live/);
  });

  it("does not touch any other C6 job", () => {
    expect(sql).not.toMatch(/job_id\s*:=\s*3\b/);
    expect(sql).not.toMatch(/job_id\s*:=\s*17\b/);
    expect(sql).not.toMatch(/job_id\s*:=\s*18\b/);
    expect(sql).not.toMatch(/job_id\s*:=\s*25\b/);
    expect(stripped).not.toMatch(/lifecycle-scheduler/);
    expect(stripped).not.toMatch(/outreach-sla-monitor/);
    expect(stripped).not.toMatch(/cleanup-expired-unsubscribe-tokens/);
    expect(stripped).not.toMatch(/account-deletion-sweeper/);
  });

  it("does not unschedule, schedule, or alter schedule/active flag", () => {
    expect(sql).not.toMatch(/cron\.schedule\s*\(/);
    expect(sql).not.toMatch(/cron\.unschedule\s*\(/);
    expect(sql).not.toMatch(/\bschedule\s*:=/);
    expect(sql).not.toMatch(/\bactive\s*:=/);
  });

  it("new command uses public.cron_invoke with the dryrun job name and correct URL", () => {
    expect(sql).toMatch(/public\.cron_invoke\s*\(/);
    expect(sql).toMatch(/'purge-email-send-log-daily-dryrun'/);
    expect(sql).toMatch(/\/functions\/v1\/purge-email-send-log-daily\b/);
  });

  it("payload preserves dry-run safety keys", () => {
    expect(sql).toMatch(/'dry_run'\s*,\s*true/);
    expect(sql).toMatch(/'max_orgs'\s*,\s*50/);
    expect(sql).toMatch(/'max_rows_per_org'\s*,\s*5000/);
    expect(sql).toMatch(/'source'\s*,\s*'cron:purge-email-send-log-daily-dryrun'/);
    expect(sql).toMatch(/'trigger'\s*,\s*'cron'/);
    expect(sql).toMatch(/'time'\s*,\s*now\(\)/);
  });

  it("payload contains no destructive flags", () => {
    expect(stripped).not.toMatch(/'dry_run'\s*,\s*false/i);
    expect(stripped).not.toMatch(/confirm/i);
    expect(stripped).not.toMatch(/HARD_DELETE/);
  });

  it("cron command does not embed Authorization / Bearer JWT / raw net.http_post", () => {
    const alterMatch = sql.match(/cron\.alter_job[\s\S]*?\);/);
    expect(alterMatch).toBeTruthy();
    const cmd = alterMatch![0];
    expect(cmd).not.toMatch(/Authorization/i);
    expect(cmd).not.toMatch(/Bearer\s+eyJ/);
    expect(cmd).not.toMatch(/eyJ[A-Za-z0-9_\-]{20,}\./);
    expect(cmd).not.toMatch(/net\.http_post/i);
  });

  it("seeds cron_heartbeats with separate dryrun name and 86400s interval", () => {
    expect(sql).toMatch(/INSERT\s+INTO\s+public\.cron_heartbeats/i);
    expect(sql).toMatch(/'purge-email-send-log-daily-dryrun'/);
    expect(sql).toMatch(/86400/);
    expect(sql).toMatch(/ON\s+CONFLICT\s*\(\s*job_name\s*\)/i);
  });

  it("does not deploy or edit edge function source", () => {
    expect(sql).not.toMatch(/supabase\/functions\/purge-email-send-log-daily/);
  });

  it("does not mutate email_send_log or other business tables", () => {
    const forbidden = [
      "email_send_log",
      "notifications", "notification_dispatches",
      "profiles", "auth.users", "user_roles", "organizations",
      "audit_logs", "admin_audit_logs", "admin_risk_items",
      "retention_run_evidence", "retention_flags",
      "pois", "poi_engagements", "wads", "matches",
      "token_ledger", "ledger_events", "token_balances", "token_wallets",
      "payment_disputes", "refund_requests", "acceptance_receipts",
      "legal_holds", "compliance_holds", "storage_deletion_queue",
    ];
    for (const tbl of forbidden) {
      const re = new RegExp(
        `\\b(INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+(public\\.)?${tbl.replace(".", "\\.")}\\b`,
        "i",
      );
      // Allow the heartbeat INSERT specifically; only forbidden tables checked here.
      expect(sql).not.toMatch(re);
    }
  });
});
