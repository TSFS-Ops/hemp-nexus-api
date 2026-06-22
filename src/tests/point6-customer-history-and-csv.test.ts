/**
 * Point 6 — Customer request-history table + customer CSV.
 *
 * Proves:
 *   • ClientUsageDashboard mounts the new history table in "client" mode.
 *   • The history table targets get_api_client_usage_rows (own-org scoped).
 *   • CSV columns include David's required per-row fields.
 *   • Forbidden-token guard preserved.
 *   • Customer CSV audit RPC unchanged (log_api_client_usage_csv_export).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const read = (p: string) => readFileSync(resolve(p), "utf8");

describe("Point 6 · customer history + CSV", () => {
  const dashboard = read("src/components/developer/ClientUsageDashboard.tsx");
  const table = read("src/components/usage/Point6UsageHistoryTable.tsx");

  it("ClientUsageDashboard imports and mounts the history table in client mode", () => {
    expect(dashboard).toMatch(/from "@\/components\/usage\/Point6UsageHistoryTable"/);
    expect(dashboard).toMatch(/<Point6UsageHistoryTable[\s\S]*?mode="client"/);
  });

  it("history table calls the customer RPC by name", () => {
    expect(table).toMatch(/get_api_client_usage_rows/);
    expect(table).toMatch(/get_api_admin_usage_rows/);
    // The customer mode resolves to the customer RPC only.
    expect(table).toMatch(/mode === "client"\s*\?\s*"get_api_client_usage_rows"\s*:\s*"get_api_admin_usage_rows"/);
  });

  it("CSV columns cover David's required per-row fields", () => {
    for (const col of [
      "created_at", "endpoint", "environment", "request_id",
      "api_key_alias", "chargeable", "non_billable_reason",
      "credits_burned", "opening_balance", "closing_balance",
    ]) {
      expect(table, `CSV must include ${col}`).toMatch(new RegExp(`"${col}"`));
    }
  });

  it("preserves forbidden-token guard", () => {
    for (const t of ["api_key", "key_hash", "secret", "request_body", "response_body", "ip_address"]) {
      expect(table).toMatch(new RegExp(`"${t}"`));
    }
  });

  it("customer CSV audit uses the existing RPC unchanged (no signature edits)", () => {
    expect(table).toMatch(/log_api_client_usage_csv_export/);
    // No new positional args introduced — existing 4-arg shape.
    expect(table).toMatch(/p_api_client_id:[\s\S]*?p_period_start:[\s\S]*?p_period_end:[\s\S]*?p_row_count:/);
  });

  it("admin CSV audit reuses existing RPC with backwards-compatible scope flag in p_filters", () => {
    expect(table).toMatch(/log_api_monitoring_csv_export/);
    expect(table).toMatch(/scope:\s*"per_row"/);
  });
});
