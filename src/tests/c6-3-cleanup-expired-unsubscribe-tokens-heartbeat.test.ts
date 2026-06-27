/**
 * C6.3 — cleanup-expired-unsubscribe-tokens heartbeat coverage migration guard.
 *
 * Pins that the C6.3 migration:
 *  - creates a SQL wrapper that calls the existing cleanup function exactly once,
 *  - upserts cron_heartbeats on success and on failure with a bare RAISE,
 *  - seeds the heartbeat row with expected_interval_seconds = 86400,
 *  - alters only jobid 18 and does not change schedule, active flag, jobname,
 *  - does not introduce edge-function/cron_invoke/net.http_post/JWT logic,
 *  - does not re-implement or widen the cleanup DELETE.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const MIGRATION = resolve(
  "supabase/migrations/20260627205915_e8f709b7-793e-4f4d-929e-fc7730a2d2aa.sql",
);
const sql = readFileSync(MIGRATION, "utf8");

// Strip SQL line-comments before forbidden-pattern matches so descriptive
// header text cannot trip the guards.
const stripped = sql
  .split("\n")
  .map((l) => l.replace(/--.*$/, ""))
  .join("\n");

describe("C6.3 cleanup-expired-unsubscribe-tokens heartbeat migration", () => {
  it("creates the wrapper function with the correct name and integer return", () => {
    expect(sql).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.run_cleanup_expired_unsubscribe_tokens_with_heartbeat\s*\(\s*\)\s*RETURNS\s+integer/i,
    );
  });

  it("wrapper is SECURITY DEFINER with search_path = public", () => {
    expect(sql).toMatch(/SECURITY\s+DEFINER/i);
    expect(sql).toMatch(/SET\s+search_path\s*=\s*public/i);
  });

  it("wrapper calls public.cleanup_expired_unsubscribe_tokens() exactly once", () => {
    const matches = stripped.match(/public\.cleanup_expired_unsubscribe_tokens\s*\(/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it("wrapper does NOT re-implement the cleanup DELETE", () => {
    expect(stripped).not.toMatch(/DELETE\s+FROM\s+public\.email_unsubscribe_tokens/i);
    expect(stripped).not.toMatch(/DELETE\s+FROM\s+email_unsubscribe_tokens/i);
    expect(stripped).not.toMatch(/expires_at\s*<\s*now\(\)\s+AND\s+used_at\s+IS\s+NULL/i);
  });

  it("upserts cron_heartbeats with success branch and failed branch", () => {
    expect(sql).toMatch(/last_status\s*=\s*'success'/);
    expect(sql).toMatch(/last_status\s*=\s*'failed'/);
    expect(sql).toMatch(/ON\s+CONFLICT\s*\(\s*job_name\s*\)\s+DO\s+UPDATE/i);
  });

  it("exception block contains a bare RAISE; (re-raises to preserve pg-cron failure)", () => {
    expect(sql).toMatch(/EXCEPTION\s+WHEN\s+OTHERS/i);
    expect(sql).toMatch(/\bRAISE\s*;/);
  });

  it("seeds heartbeat row for 'cleanup-expired-unsubscribe-tokens' with expected_interval_seconds = 86400", () => {
    expect(sql).toMatch(/INSERT\s+INTO\s+public\.cron_heartbeats/i);
    expect(sql).toMatch(/'cleanup-expired-unsubscribe-tokens'/);
    expect(sql).toMatch(/86400/);
  });

  it("uses cron.alter_job targeting job_id := 18 only", () => {
    expect(sql).toMatch(/cron\.alter_job\s*\(\s*\s*job_id\s*:=\s*18\b/);
    const jobIds = [...sql.matchAll(/job_id\s*:=\s*(\d+)/g)].map((m) => m[1]);
    expect(jobIds.length).toBeGreaterThan(0);
    for (const id of jobIds) expect(id).toBe("18");
  });

  it("new command is exactly the wrapper call", () => {
    expect(sql).toMatch(
      /command\s*:=\s*'SELECT\s+public\.run_cleanup_expired_unsubscribe_tokens_with_heartbeat\(\);'/,
    );
  });

  it("does not call cron.schedule or cron.unschedule", () => {
    expect(sql).not.toMatch(/cron\.schedule\s*\(/);
    expect(sql).not.toMatch(/cron\.unschedule\s*\(/);
  });

  it("does not alter schedule or active flag", () => {
    expect(sql).not.toMatch(/\bschedule\s*:=/);
    expect(sql).not.toMatch(/\bactive\s*:=/);
  });

  it("does not introduce edge-function/cron_invoke/HTTP/JWT machinery", () => {
    expect(stripped).not.toMatch(/cron_invoke\s*\(/);
    expect(stripped).not.toMatch(/net\.http_post\s*\(/);
    expect(stripped).not.toMatch(/Authorization/i);
    expect(stripped).not.toMatch(/Bearer\s+eyJ/);
    expect(stripped).not.toMatch(/\/functions\/v1\//);
  });

  it("does not mutate unrelated business tables", () => {
    const forbidden = [
      "poi_engagements",
      "pois",
      "wads",
      "matches",
      "token_ledger",
      "ledger_events",
      "token_balances",
      "token_wallets",
      "token_purchases",
      "payment_disputes",
      "refund_requests",
      "acceptance_receipts",
      "notification_dispatches",
      "notifications",
      "email_send_log",
      "audit_logs",
      "admin_audit_logs",
      "admin_risk_items",
    ];
    for (const tbl of forbidden) {
      const re = new RegExp(
        `\\b(INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+(public\\.)?${tbl}\\b`,
        "i",
      );
      expect(sql).not.toMatch(re);
    }
  });
});
