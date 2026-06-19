/**
 * Batch 4 follow-up — Token / credit balance alert triggers.
 *
 *   • detect_api_token_balance_alerts function exists, is SECURITY DEFINER
 *     with explicit search_path, gated by can_access_api_monitoring.
 *   • Emits two alert types: token_balance_low (warning) and
 *     token_balance_zero (critical).
 *   • Uses ON CONFLICT (dedupe_key) DO NOTHING for idempotency.
 *   • Joins via api_clients.org_id and skips revoked/suspended clients.
 *   • Reuses public.api_usage_alerts; no new table.
 *   • Admin panel triggers the new detector alongside detect_api_usage_alerts.
 *   • No client-facing surface references the new alert types.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf-8");

function allMigrations(): string {
  const dir = path.join(ROOT, "supabase/migrations");
  let combined = "";
  for (const f of fs.readdirSync(dir)) {
    combined += "\n" + fs.readFileSync(path.join(dir, f), "utf-8");
  }
  return combined;
}
const MIG = allMigrations();

describe("Batch 4 follow-up · token/credit balance alerts", () => {
  it("creates detect_api_token_balance_alerts as SECURITY DEFINER with search_path", () => {
    const fn = MIG.match(
      /create or replace function public\.detect_api_token_balance_alerts[\s\S]*?\$\$;/i,
    );
    expect(fn, "detector function missing").not.toBeNull();
    expect(fn![0]).toMatch(/security definer/i);
    expect(fn![0]).toMatch(/set search_path\s*=\s*public/i);
    expect(fn![0]).toMatch(/can_access_api_monitoring\(v_uid\)/);
  });

  it("emits token_balance_zero (critical) and token_balance_low (warning)", () => {
    const fn = MIG.match(
      /create or replace function public\.detect_api_token_balance_alerts[\s\S]*?\$\$;/i,
    )![0];
    expect(fn).toMatch(/'token_balance_zero'/);
    expect(fn).toMatch(/'critical'/);
    expect(fn).toMatch(/'token_balance_low'/);
    expect(fn).toMatch(/'warning'/);
  });

  it("uses ON CONFLICT (dedupe_key) DO NOTHING for idempotency", () => {
    const fn = MIG.match(
      /create or replace function public\.detect_api_token_balance_alerts[\s\S]*?\$\$;/i,
    )![0];
    const matches = fn.match(/on conflict \(dedupe_key\) do nothing/gi) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it("joins api_clients by org_id and excludes revoked/suspended", () => {
    const fn = MIG.match(
      /create or replace function public\.detect_api_token_balance_alerts[\s\S]*?\$\$;/i,
    )![0];
    expect(fn).toMatch(/join\s+public\.api_clients\s+c[\s\S]*?c\.org_id\s*=\s*tb\.org_id/i);
    expect(fn).toMatch(/c\.status\s+not\s+in\s*\(\s*'revoked'\s*,\s*'suspended'\s*\)/i);
  });

  it("uses the 20% threshold against minimum_required for low alerts", () => {
    const fn = MIG.match(
      /create or replace function public\.detect_api_token_balance_alerts[\s\S]*?\$\$;/i,
    )![0];
    expect(fn).toMatch(/minimum_required[\s\S]*?0\.20/);
  });

  it("does not create a new alerts table — reuses api_usage_alerts", () => {
    const fn = MIG.match(
      /create or replace function public\.detect_api_token_balance_alerts[\s\S]*?\$\$;/i,
    )![0];
    expect(fn).toMatch(/insert into public\.api_usage_alerts/i);
    // No new CREATE TABLE introduced by the follow-up.
    expect(fn).not.toMatch(/create\s+table/i);
  });

  it("grants EXECUTE to authenticated", () => {
    expect(MIG).toMatch(
      /grant execute on function public\.detect_api_token_balance_alerts\(\) to authenticated/i,
    );
  });

  it("admin alerts panel invokes detect_api_token_balance_alerts alongside detect_api_usage_alerts", () => {
    const panel = read("src/components/admin/AdminApiUsageAlertsPanel.tsx");
    expect(panel).toMatch(/detect_api_usage_alerts/);
    expect(panel).toMatch(/detect_api_token_balance_alerts/);
  });

  it("client-facing dashboards do not reference token balance alerts", () => {
    const dev = read("src/pages/DeveloperCenter.tsx");
    expect(dev).not.toMatch(/token_balance_low|token_balance_zero|api_usage_alerts/);
  });
});
