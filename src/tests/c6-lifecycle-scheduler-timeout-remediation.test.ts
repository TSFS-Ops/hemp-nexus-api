/**
 * C6 — lifecycle-scheduler pg_net timeout remediation guard.
 *
 * Pins the targeted timeout fix:
 *   1. public.cron_invoke gains an optional p_timeout_milliseconds
 *      parameter that defaults to 5000 (so all existing 3-arg callers
 *      remain unchanged).
 *   2. The timeout is clamped to [1000, 30000].
 *   3. timeout_milliseconds is passed through to net.http_post.
 *   4. The body merge / correlation metadata block is preserved
 *      verbatim.
 *   5. Only jobid 3 (lifecycle-scheduler-job) is altered, and it
 *      passes 15000 ms.
 *   6. No other cron job, no cron.schedule / cron.unschedule, no
 *      business / runtime table is touched.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const MIGRATION = resolve(
  "supabase/migrations/20260630150548_fbb7d440-9f77-4aa3-bff9-eabc4437c878.sql",
);

describe("C6 lifecycle-scheduler timeout remediation migration", () => {
  const sql = readFileSync(MIGRATION, "utf8");

  it("adds p_timeout_milliseconds with default 5000", () => {
    expect(sql).toMatch(/p_timeout_milliseconds\s+integer\s+DEFAULT\s+5000/i);
  });

  it("clamps timeout between 1000 and 30000", () => {
    expect(sql).toMatch(/GREATEST\s*\(\s*1000\s*,\s*LEAST\s*\(\s*30000/i);
  });

  it("passes timeout_milliseconds to net.http_post", () => {
    expect(sql).toMatch(/timeout_milliseconds\s*:=\s*v_timeout/);
  });

  it("preserves the body merge / correlation payload", () => {
    expect(sql).toMatch(
      /COALESCE\(p_body,\s*'\{\}'::jsonb\)[\s\S]{0,120}'cron_run_id'[\s\S]{0,80}'cron_job_name'/,
    );
  });

  it("preserves heartbeat upsert semantics (job_name conflict + pending status)", () => {
    expect(sql).toMatch(/ON\s+CONFLICT\s*\(\s*job_name\s*\)/i);
    expect(sql).toMatch(/last_status\s*=\s*'pending'/);
  });

  it("alters only jobid 3 (lifecycle-scheduler-job)", () => {
    const ids = [...sql.matchAll(/job_id\s*:=\s*(\d+)/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(id).toBe("3");
    expect(sql).toMatch(/cron_invoke\(\s*'lifecycle-scheduler'/);
    expect(sql).toMatch(/\/functions\/v1\/lifecycle-scheduler\b/);
  });

  it("lifecycle scheduler command passes 15000 ms timeout", () => {
    expect(sql).toMatch(/15000\b/);
  });

  it("does not call cron.schedule or cron.unschedule", () => {
    expect(sql).not.toMatch(/cron\.schedule\s*\(/);
    expect(sql).not.toMatch(/cron\.unschedule/);
  });

  it("does not alter schedule, URL, or job name", () => {
    expect(sql).not.toMatch(/schedule\s*:=\s*'/);
    expect(sql).not.toMatch(/jobname\s*:=\s*'/);
  });

  it("does not edit lifecycle scheduler edge function source", () => {
    expect(sql).not.toMatch(/supabase\/functions\/lifecycle-scheduler/);
  });

  it("does not mutate any business / runtime table", () => {
    const forbidden = [
      /\bpoi_engagements\b/i,
      /\bpois\b/i,
      /\bwads\b/i,
      /\bmatches\b/i,
      /\btoken_ledger\b/i,
      /\bledger_events\b/i,
      /\btoken_balances\b/i,
      /\bpayment_disputes\b/i,
      /\brefund_requests\b/i,
      /\bacceptance_receipts\b/i,
      /\bnotification_dispatches\b/i,
      /\bemail_send_log\b/i,
      /\baudit_logs\b/i,
      /\bpod_milestones\b/i,
      /\bbreaches\b/i,
    ];
    for (const pat of forbidden) expect(sql).not.toMatch(pat);
  });

  it("guards against accidental global timeout increase (15000 ms is wired into exactly one cron command)", () => {
    // Strip line comments so prose mentions of 15000 do not count.
    const code = sql
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    const occurrences = code.match(/\b15000\b/g) ?? [];
    expect(occurrences.length).toBe(1);
  });

  it("does not embed a raw Authorization: Bearer JWT", () => {
    expect(sql).not.toMatch(/Bearer\s+eyJ[A-Za-z0-9._-]+/);
  });
});
