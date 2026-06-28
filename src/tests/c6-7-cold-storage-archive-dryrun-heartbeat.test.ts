/**
 * C6.7 — cold-storage-archive-dryrun heartbeat coverage migration guard.
 *
 * Pins that the C6.7 migration:
 *  - alters only jobid 40 (does not touch jobid 41 / live, nor 39 / 42),
 *  - converts the cron command from raw net.http_post to public.cron_invoke,
 *  - uses a SEPARATE heartbeat name from the live job,
 *  - preserves dry-run safety (dry_run=true, no live/HARD flags),
 *  - seeds cron_heartbeats for 'cold-storage-archive-dryrun' at 604800s,
 *  - does not touch schedule, active flag, edge function source, or business tables.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const MIGRATION = resolve(
  "supabase/migrations/20260628140147_616509b5-660c-4eef-a107-349df70ad4b1.sql",
);
const sql = readFileSync(MIGRATION, "utf8");
const stripped = sql.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");

const EVIDENCE = resolve(
  "evidence/c6-chron-observability/cold-storage-archive-dryrun-heartbeat/README.md",
);
const evidence = readFileSync(EVIDENCE, "utf8");

describe("C6.7 cold-storage-archive-dryrun heartbeat migration", () => {
  it("documents the pre-apply cron_invoke payload-preservation safety check", () => {
    expect(evidence).toMatch(/cron_invoke/i);
    expect(evidence).toMatch(/preserv/i);
    expect(evidence).toMatch(/COALESCE\s*\(\s*p_body/i);
  });

  it("uses cron.alter_job targeting job_id := 40 only", () => {
    expect(sql).toMatch(/cron\.alter_job\s*\(/);
    const jobIds = [...sql.matchAll(/job_id\s*:=\s*(\d+)/g)].map((m) => m[1]);
    expect(jobIds.length).toBeGreaterThan(0);
    for (const id of jobIds) expect(id).toBe("40");
  });

  it("does not reference or alter jobid 41 (live)", () => {
    expect(sql).not.toMatch(/job_id\s*:=\s*41\b/);
    expect(stripped).not.toMatch(/cold-storage-archive-live/);
  });

  it("does not touch any other C6 job", () => {
    expect(sql).not.toMatch(/job_id\s*:=\s*3\b/);
    expect(sql).not.toMatch(/job_id\s*:=\s*17\b/);
    expect(sql).not.toMatch(/job_id\s*:=\s*18\b/);
    expect(sql).not.toMatch(/job_id\s*:=\s*25\b/);
    expect(sql).not.toMatch(/job_id\s*:=\s*39\b/);
    expect(sql).not.toMatch(/job_id\s*:=\s*42\b/);
    expect(stripped).not.toMatch(/lifecycle-scheduler/);
    expect(stripped).not.toMatch(/outreach-sla-monitor/);
    expect(stripped).not.toMatch(/cleanup-expired-unsubscribe-tokens/);
    expect(stripped).not.toMatch(/account-deletion-sweeper/);
    expect(stripped).not.toMatch(/purge-email-send-log-daily-dryrun/);
    expect(stripped).not.toMatch(/purge-email-send-log-daily-live/);
  });

  it("does not unschedule, schedule, or alter schedule/active flag", () => {
    expect(sql).not.toMatch(/cron\.schedule\s*\(/);
    expect(sql).not.toMatch(/cron\.unschedule\s*\(/);
    expect(sql).not.toMatch(/\bschedule\s*:=/);
    expect(sql).not.toMatch(/\bactive\s*:=/);
  });

  it("new command uses public.cron_invoke with the dryrun job name and exact URL", () => {
    expect(sql).toMatch(/public\.cron_invoke\s*\(/);
    expect(sql).toMatch(/'cold-storage-archive-dryrun'/);
    expect(sql).toMatch(/\/functions\/v1\/cold-storage-archive\b/);
  });

  it("payload preserves dry-run safety keys exactly", () => {
    expect(sql).toMatch(/'dry_run'\s*,\s*true/);
    expect(sql).toMatch(/'limit'\s*,\s*50/);
    expect(sql).toMatch(/'source'\s*,\s*'cron:cold-storage-archive-dryrun'/);
  });

  it("payload contains no destructive / live flags", () => {
    expect(stripped).not.toMatch(/'dry_run'\s*,\s*false/i);
    expect(stripped).not.toMatch(/confirm/i);
    expect(stripped).not.toMatch(/HARD_DELETE/);
  });

  it("cron command embeds no Authorization / Bearer / JWT / raw net.http_post", () => {
    const alterMatch = sql.match(/cron\.alter_job[\s\S]*?\)\s*;/);
    expect(alterMatch).toBeTruthy();
    const cmd = alterMatch![0];
    expect(cmd).not.toMatch(/Authorization/i);
    expect(cmd).not.toMatch(/Bearer\s+eyJ/);
    expect(cmd).not.toMatch(/eyJ[A-Za-z0-9_\-]{20,}\./);
    expect(cmd).not.toMatch(/net\.http_post/i);
  });

  it("seeds cron_heartbeats with separate dryrun name and 604800s interval", () => {
    expect(sql).toMatch(/INSERT\s+INTO\s+public\.cron_heartbeats/i);
    expect(sql).toMatch(/'cold-storage-archive-dryrun'/);
    expect(sql).toMatch(/604800/);
    expect(sql).toMatch(/ON\s+CONFLICT\s*\(\s*job_name\s*\)/i);
  });

  it("does not seed a shared or live heartbeat row", () => {
    // Forbid an exact 'cold-storage-archive' job_name literal (without -dryrun/-live suffix).
    expect(stripped).not.toMatch(/'cold-storage-archive'(?!-)/);
    expect(stripped).not.toMatch(/'cold-storage-archive-live'/);
  });

  it("does not deploy or edit edge function source", () => {
    expect(sql).not.toMatch(/supabase\/functions\/cold-storage-archive/);
  });

  it("does not mutate archive/business tables", () => {
    const forbidden = [
      "retention_flags", "retention_run_evidence",
      "email_send_log",
      "notifications", "notification_dispatches",
      "profiles", "auth.users", "user_roles", "organizations",
      "audit_logs", "admin_audit_logs", "admin_risk_items",
      "pois", "poi_engagements", "wads", "matches", "match_documents", "match_events",
      "token_ledger", "ledger_events", "token_balances", "token_wallets",
      "payment_disputes", "refund_requests", "acceptance_receipts",
      "legal_holds", "compliance_holds", "storage_deletion_queue",
      "compliance_cases", "screening_results",
    ];
    for (const tbl of forbidden) {
      const re = new RegExp(
        `\\b(INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+(public\\.)?${tbl.replace(".", "\\.")}\\b`,
        "i",
      );
      expect(sql).not.toMatch(re);
    }
  });
});
