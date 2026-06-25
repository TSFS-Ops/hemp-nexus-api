import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Phase 1: cron_invoke correlation-id hardening (outreach-only witness fallback).
// Pins the migration + edge function to the agreed strict scope.

const MIGRATION_PATH = resolve(
  __dirname,
  "../../supabase/migrations/20260625135237_40964f86-6099-4dd6-8723-4a142a1d8e2a.sql",
);
const EDGE_PATH = resolve(
  __dirname,
  "../../supabase/functions/outreach-sla-monitor/index.ts",
);

const sql = readFileSync(MIGRATION_PATH, "utf8");
const edge = readFileSync(EDGE_PATH, "utf8");

describe("Phase 1 — cron_heartbeats schema additions", () => {
  it("adds last_correlation_id uuid (nullable)", () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS\s+last_correlation_id\s+uuid\s+NULL/i);
  });
  it("adds last_metadata jsonb (nullable)", () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS\s+last_metadata\s+jsonb\s+NULL/i);
  });
  it("contains no destructive schema changes against cron_heartbeats", () => {
    expect(sql).not.toMatch(/ALTER\s+TABLE\s+public\.cron_heartbeats[\s\S]{0,200}DROP\s+COLUMN/i);
    expect(sql).not.toMatch(/DROP\s+TABLE\s+public\.cron_heartbeats/i);
  });
  it("does not introduce a cron_run_events table in Phase 1", () => {
    expect(sql).not.toMatch(/CREATE\s+TABLE\s+(public\.)?cron_run_events/i);
  });
});

describe("Phase 1 — cron_invoke signature + correlation behaviour", () => {
  it("preserves signature (p_job_name text, p_url text, p_body jsonb)", () => {
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.cron_invoke\(\s*p_job_name text,\s*p_url\s+text,\s*p_body\s+jsonb DEFAULT '\{\}'::jsonb\s*\)\s*RETURNS bigint/,
    );
  });
  it("generates a cron_run_id with gen_random_uuid()", () => {
    expect(sql).toMatch(/v_run_id\s+uuid\s*:=\s*gen_random_uuid\(\)/);
  });
  it("injects cron_run_id and cron_job_name into the request body", () => {
    expect(sql).toMatch(/'cron_run_id'/);
    expect(sql).toMatch(/'cron_job_name'/);
    expect(sql).toMatch(/COALESCE\(p_body, '\{\}'::jsonb\)\s*\|\|\s*jsonb_build_object/);
  });
  it("calls net.http_post exactly once", () => {
    const matches = sql.match(/net\.http_post\s*\(/g) ?? [];
    expect(matches.length).toBe(1);
  });
  it("persists last_correlation_id and last_metadata on the heartbeat", () => {
    expect(sql).toMatch(/last_correlation_id\s*=\s*EXCLUDED\.last_correlation_id/);
    expect(sql).toMatch(/last_metadata\s*=\s*EXCLUDED\.last_metadata/);
  });
  it("preserves INTERNAL_CRON_KEY missing behaviour and records correlation in metadata", () => {
    expect(sql).toMatch(/INTERNAL_CRON_KEY missing from vault/);
    expect(sql).toMatch(/'missing_secret',\s*true/);
  });
});

describe("Phase 1 — reconciler outreach-only edge-witness fallback", () => {
  it("scopes the witness fallback to job_name = 'outreach-sla-monitor'", () => {
    expect(sql).toMatch(/r\.job_name\s*=\s*'outreach-sla-monitor'/);
  });
  it("queries admin_audit_logs for action='cron.outreach_sla_monitor_tick'", () => {
    expect(sql).toMatch(/admin_audit_logs[\s\S]{0,400}'cron\.outreach_sla_monitor_tick'/);
  });
  it("matches witness rows on cron_run_id and outcome='ok'", () => {
    expect(sql).toMatch(/details->>'cron_run_id'/);
    expect(sql).toMatch(/details->>'outcome'[\s\S]{0,40}'ok'/);
  });
  it("uses a -1 minute .. +10 minute reconciliation window around last_run_at", () => {
    expect(sql).toMatch(/interval '1 minute'/);
    expect(sql).toMatch(/interval '10 minutes'/);
  });
  it("sets last_status='success_with_pg_net_warning' when witness confirms run", () => {
    expect(sql).toMatch(/last_status\s*=\s*'success_with_pg_net_warning'/);
  });
  it("clears last_error and stores pg_net warning metadata on witness fallback", () => {
    expect(sql).toMatch(/last_error\s*=\s*NULL/);
    expect(sql).toMatch(/'pg_net_warning'/);
    expect(sql).toMatch(/'witness_action'/);
    expect(sql).toMatch(/'reconciled_via',\s*'edge_witness'/);
  });
  it("treats success_with_pg_net_warning as non-failed in C4 risk-item logic", () => {
    // The ELSIF for resolution must include the new status.
    expect(sql).toMatch(/r\.last_status IN \('success', 'success_with_pg_net_warning'\)/);
  });
  it("keeps the existing failed branches when no witness exists", () => {
    expect(sql).toMatch(/last_status\s*=\s*'failed'/);
  });
});

describe("Phase 1 — outreach edge function witness", () => {
  it("reads cron_run_id and cron_job_name from the request body", () => {
    expect(edge).toMatch(/body\.cron_run_id/);
    expect(edge).toMatch(/body\.cron_job_name/);
  });
  it("defines an emitWitness helper", () => {
    expect(edge).toMatch(/emitWitness\s*=\s*async/);
  });
  it("writes an admin_audit_logs row with action='cron.outreach_sla_monitor_tick'", () => {
    expect(edge).toMatch(/action:\s*"cron\.outreach_sla_monitor_tick"/);
    expect(edge).toMatch(/target_type:\s*"cron_job"/);
  });
  it("witness details include cron_run_id, cron_job_name, outcome, source", () => {
    expect(edge).toMatch(/cron_run_id:\s*cronRunId/);
    expect(edge).toMatch(/cron_job_name:\s*cronJobName/);
    expect(edge).toMatch(/source:\s*"outreach-sla-monitor"/);
    expect(edge).toMatch(/outcome,/);
  });
  it("only emits a witness when cronRunId is present (manual calls do not write)", () => {
    expect(edge).toMatch(/if\s*\(!cronRunId\)\s*return/);
  });
  it("emits a witness on the zero-eligible (zero-work) path", () => {
    expect(edge).toMatch(/eligible_for_reminder:\s*0[\s\S]{0,200}email_sent:\s*false/);
    // The zero-work block calls emitWitness("ok", { included: 0, ... })
    expect(edge).toMatch(/emitWitness\("ok",\s*\{\s*included:\s*0/);
  });
  it("emits a witness on the digest-dispatched path", () => {
    expect(edge).toMatch(/emitWitness\("ok",\s*\{\s*included:\s*ids\.length/);
  });
  it("emits a witness on the unhandled-error catch block", () => {
    expect(edge).toMatch(/emitWitness\("error",\s*\{\s*error:\s*\(err as Error\)\.message\s*\}\)/);
  });
  it("preserves existing outreach.sla_digest_dispatched audit", () => {
    expect(edge).toMatch(/action:\s*"outreach\.sla_digest_dispatched"/);
  });
  it("does not add provider/email retries", () => {
    expect(edge).not.toMatch(/setTimeout\(/);
    expect(edge).not.toMatch(/retry/i);
  });
});

describe("Phase 1 — negative scope", () => {
  it("migration does not change cron schedule or active flag", () => {
    expect(sql).not.toMatch(/cron\.alter_job/);
    expect(sql).not.toMatch(/cron\.schedule\s*\(/);
    expect(sql).not.toMatch(/cron\.unschedule\s*\(/);
    expect(sql).not.toMatch(/\bschedule\s*:=/);
    expect(sql).not.toMatch(/\bactive\s*:=/);
  });
  it("migration mutates no business tables", () => {
    const forbidden = [
      "poi_engagements", "audit_logs", "notification_dispatches", "notifications",
      "email_send_log", "acceptance_receipts", "wads", "matches", "pois",
      "token_ledger", "ledger_events", "token_balances", "token_wallets",
      "refund_requests", "payment_disputes",
    ];
    for (const tbl of forbidden) {
      const mutationRegex = new RegExp(
        `\\b(INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+(public\\.)?${tbl}\\b`,
        "i",
      );
      expect(sql).not.toMatch(mutationRegex);
    }
  });
});
