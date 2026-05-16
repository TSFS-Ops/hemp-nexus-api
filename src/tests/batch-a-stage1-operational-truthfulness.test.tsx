/**
 * Batch A Stage 1 — operational truthfulness guards.
 *
 * These tests defend the core invariant of UI-010 / OPS-001 / OPS-003 / OPS-004:
 * no status surface may claim "operational" from static constants, and every
 * scheduled cron job must be routed through the cron_invoke heartbeat wrapper
 * with a reconciler running in source-controlled migrations.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// --- supabase client mock ---------------------------------------------------
const mockState: { heartbeats: any[]; risks: any[] } = { heartbeats: [], risks: [] };

vi.mock("@/integrations/supabase/client", () => {
  const make = (table: string) => ({
    select: (_cols?: string, opts?: { count?: string; head?: boolean }) => {
      const chain: any = {
        order: () => chain,
        limit: () => chain,
        eq: () => chain,
        gte: () => chain,
        contains: () => chain,
        then: (resolve: any) => {
          if (table === "cron_heartbeats") {
            return Promise.resolve({ data: mockState.heartbeats, error: null }).then(resolve);
          }
          if (table === "admin_risk_items") {
            return Promise.resolve({
              data: mockState.risks,
              count: mockState.risks.length,
              error: null,
            }).then(resolve);
          }
          if (table === "audit_logs" && opts?.head) {
            return Promise.resolve({ count: 0, error: null }).then(resolve);
          }
          return Promise.resolve({ data: [], error: null }).then(resolve);
        },
      };
      return chain;
    },
  });
  return {
    supabase: {
      from: (table: string) => make(table),
    },
  };
});

import { HealthBoard } from "@/components/governance/HealthBoard";

function renderBoard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <HealthBoard />
    </QueryClientProvider>,
  );
}

// --- shared helpers --------------------------------------------------------
const REPO = process.cwd();
const HEALTH_BOARD = readFileSync(join(REPO, "src/components/governance/HealthBoard.tsx"), "utf8");
const PUBLIC_STATUS = readFileSync(join(REPO, "src/pages/Status.tsx"), "utf8");

function migrations(): string[] {
  return readdirSync(join(REPO, "supabase/migrations"))
    .filter(f => f.endsWith(".sql"))
    .map(f => readFileSync(join(REPO, "supabase/migrations", f), "utf8"));
}

// ============================================================================
// 1. UI source guards — no static green claims
// ============================================================================
describe("UI-010 source guards (no static green)", () => {
  it("HealthBoard does not declare a hardcoded GATES array of operational rows", () => {
    // The fix replaces the old `const GATES: Gate[] = [...status: 'operational']`
    // with a runtime query. If anyone reintroduces it, fail.
    const reintroduced =
      /const\s+GATES\s*:\s*Gate\s*\[\s*\]\s*=\s*\[/.test(HEALTH_BOARD) &&
      /status:\s*['"]operational['"]/.test(HEALTH_BOARD);
    expect(reintroduced).toBe(false);
  });

  it("HealthBoard does not contain a hardcoded composite SLA literal", () => {
    // The old value was "99.962%". Block any percentage literal that
    // hardcodes uptime in the source — real values must come from data.
    const slaLiteral = /\b9\d\.\d{2,}%\b/;
    expect(slaLiteral.test(HEALTH_BOARD)).toBe(false);
  });

  it("HealthBoard reads from cron_heartbeats", () => {
    expect(HEALTH_BOARD).toContain("cron_heartbeats");
  });

  it("public /status removes mocked uptime bars and unsupported green claims", () => {
    expect(PUBLIC_STATUS).not.toMatch(/generateBars\s*\(/);
    expect(PUBLIC_STATUS).not.toMatch(/All Systems Operational/i);
    // It must not present any 9x.xxx% uptime literals as fact either.
    expect(PUBLIC_STATUS).not.toMatch(/\b9\d\.\d{2,}%\b/);
  });
});

// ============================================================================
// 2. Migration guards — wrapper + reconciler + scheduled jobs
// ============================================================================
describe("OPS-003 / OPS-004 migration guards", () => {
  const allMigrations = migrations().join("\n\n");

  it("creates the cron_heartbeats table", () => {
    expect(allMigrations).toMatch(/CREATE TABLE\s+IF NOT EXISTS\s+public\.cron_heartbeats/i);
  });

  it("creates the cron_invoke wrapper function", () => {
    expect(allMigrations).toMatch(/CREATE OR REPLACE FUNCTION\s+public\.cron_invoke\s*\(/i);
  });

  it("creates the cron_reconcile_heartbeats reconciler", () => {
    expect(allMigrations).toMatch(
      /CREATE OR REPLACE FUNCTION\s+public\.cron_reconcile_heartbeats\s*\(\s*\)/i,
    );
  });

  it("reconciler raises admin_risk_items on failed/stale jobs", () => {
    expect(allMigrations).toMatch(
      /cron_reconcile_heartbeats[\s\S]+admin_risk_items/i,
    );
  });

  it("schedules infra-alerts in a tracked migration", () => {
    expect(allMigrations).toMatch(
      /cron\.schedule\(\s*'infra-alerts-cron'[\s\S]+cron_invoke[\s\S]+infra-alerts/i,
    );
  });

  it("schedules the heartbeat reconciler every minute", () => {
    expect(allMigrations).toMatch(
      /cron\.schedule\(\s*'cron-heartbeat-reconcile'\s*,\s*'\*\s*\*\s*\*\s*\*\s*\*'/,
    );
  });

  it("routes the three legacy jobs through cron_invoke (no raw net.http_post in their schedule)", () => {
    for (const jobName of [
      "webhook-retry-job",
      "engagement-reminder-daily",
      "burn-poi-reconciliation-daily",
    ]) {
      // The most recent matching schedule block must use cron_invoke.
      const matches = [
        ...allMigrations.matchAll(
          new RegExp(`cron\\.schedule\\(\\s*'${jobName}'[\\s\\S]+?\\);`, "gi"),
        ),
      ];
      expect(matches.length, `no schedule for ${jobName}`).toBeGreaterThan(0);
      const last = matches[matches.length - 1][0];
      expect(last, `${jobName} last schedule must use cron_invoke`).toMatch(/cron_invoke/);
    }
  });
});

// ============================================================================
// 3. Runtime — unknown monitor renders "not monitored", not "operational"
// ============================================================================
describe("HealthBoard renders truthful state", () => {
  beforeEach(() => {
    mockState.heartbeats = [];
    mockState.risks = [];
  });

  it("renders every job as 'not monitored' when cron_heartbeats is empty", async () => {
    renderBoard();
    await waitFor(() => {
      const matches = screen.getAllByText(/not monitored/i);
      expect(matches.length).toBeGreaterThanOrEqual(5);
    });
    // And it does NOT claim operational anywhere on the gate board.
    const board = screen.getByTestId("healthboard-cron-board");
    expect(board.textContent).not.toMatch(/\boperational\b/i);
  });

  it("renders a failed heartbeat as 'failed' and surfaces the HTTP status", async () => {
    mockState.heartbeats = [
      {
        job_name: "webhook-retry-job",
        last_run_at: new Date().toISOString(),
        last_request_id: 42,
        last_http_status: 401,
        last_status: "failed",
        last_error: "Unauthorized",
        expected_interval_seconds: 300,
        updated_at: new Date().toISOString(),
      },
    ];
    renderBoard();
    await waitFor(() => {
      const row = screen.getByTestId("healthboard-row-webhook-retry-job");
      expect(row.textContent).toMatch(/failed/i);
      expect(row.textContent).toMatch(/HTTP 401/);
    });
  });

  it("renders a stale heartbeat (older than 2× expected) as 'stale'", async () => {
    const tenHoursAgo = new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString();
    mockState.heartbeats = [
      {
        job_name: "webhook-retry-job",
        last_run_at: tenHoursAgo,
        last_request_id: 1,
        last_http_status: 200,
        last_status: "success",
        last_error: null,
        expected_interval_seconds: 300, // 5 min — last_run is way past 2×.
        updated_at: tenHoursAgo,
      },
    ];
    renderBoard();
    await waitFor(() => {
      const row = screen.getByTestId("healthboard-row-webhook-retry-job");
      expect(row.textContent).toMatch(/stale/i);
    });
  });

  it("does NOT display a fake composite SLA percentage", async () => {
    renderBoard();
    const tile = await screen.findByTestId("healthboard-composite-tile");
    expect(tile.textContent).not.toMatch(/\b9\d\.\d{2,}%\b/);
    expect(tile.textContent).toMatch(/—|not configured/i);
  });
});
