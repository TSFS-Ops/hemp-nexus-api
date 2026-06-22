/**
 * Point 6 — Admin drill-down drawer.
 *
 * Proves:
 *   • AdminApiMonitoringPanel imports the shared history table.
 *   • Drill-down opens a Sheet, mounts the history table in "admin" mode.
 *   • Existing platform_admin gating on the summary CSV is unchanged.
 *   • No new audit RPC; reuses log_api_monitoring_csv_export.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const read = (p: string) => readFileSync(resolve(p), "utf8");

describe("Point 6 · admin drill-down", () => {
  const panel = read("src/components/admin/AdminApiMonitoringPanel.tsx");

  it("imports the shared history table", () => {
    expect(panel).toMatch(/from "@\/components\/usage\/Point6UsageHistoryTable"/);
  });

  it("mounts the history table in admin mode inside a Sheet", () => {
    expect(panel).toMatch(/<Sheet\b/);
    expect(panel).toMatch(/<Point6UsageHistoryTable[\s\S]*?mode="admin"/);
  });

  it("drill button exists with stable test id", () => {
    expect(panel).toMatch(/data-testid={`admin-drill-\$\{r\.api_client_id\}`}/);
  });

  it("summary CSV remains gated to platform_admin", () => {
    expect(panel).toMatch(/isPlatformAdmin/);
    expect(panel).toMatch(/Only platform_admin can export/);
  });

  it("does not introduce a new audit RPC", () => {
    // Only the existing audit functions appear.
    expect(panel).toMatch(/log_api_monitoring_csv_export/);
    expect(panel).not.toMatch(/log_api_monitoring_per_row_export/);
  });
});
