/**
 * Batch M (integration) — count query failure fallback.
 *
 * Simulates the precise count query failing (network/RLS error) and
 * verifies that:
 *
 *   1. The rows query still succeeds and the visible rows render.
 *   2. The truncation warning falls back to the heuristic
 *      (`rows.length >= ROW_LIMIT`) wording — i.e. the
 *      "may be showing the first 500" copy, NOT the precise
 *      "Showing the first 500 of N" copy.
 *   3. The count text falls back to the heuristic
 *      "Showing N outreach-blocked event(s)" wording (no "of Y").
 *   4. Clicking Export CSV still uses the panel's currently visible
 *      rows — `downloadCSV` is invoked with the safe column allowlist
 *      and a row count equal to `rows.length`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ── Spy on the safe CSV download helper.
const downloadCSVSpy = vi.fn();
vi.mock("@/lib/download-utils", () => ({
  downloadCSV: (...args: unknown[]) => downloadCSVSpy(...args),
  timestampedFilename: (prefix: string, ext: string) => `${prefix}-TEST.${ext}`,
}));

// ── Supabase mock:
//    • audit_logs rows query (select with no count opt) → succeeds with
//      ROW_LIMIT (500) rows so the heuristic-fallback warning fires.
//    • audit_logs count query (select("id", { count: "exact", head: true }))
//      → rejects with an error so countQuery.isSuccess === false.
//    • organizations (id, name) lookup → succeeds with one mapping.
const ROW_LIMIT_FIXTURE = 500;
const SAMPLE_ROW = (i: number) => ({
  id: `row-${i}`,
  action: "outreach.blocked.contact_incomplete",
  org_id: "org-aaa",
  entity_id: `eng-${i}`,
  metadata: { surface: "send-outreach" },
  created_at: new Date(Date.now() - i * 1000).toISOString(),
});
const SAMPLE_ROWS = Array.from({ length: ROW_LIMIT_FIXTURE }, (_, i) =>
  SAMPLE_ROW(i),
);

vi.mock("@/integrations/supabase/client", () => {
  function makeAuditRowsBuilder() {
    const b: Record<string, unknown> = {};
    const passthrough = () => b;
    for (const m of ["in", "order", "limit", "eq", "gte"]) {
      (b as Record<string, () => unknown>)[m] = passthrough;
    }
    (b as { then: unknown }).then = (
      onFulfilled: (v: unknown) => unknown,
      onRejected?: (e: unknown) => unknown,
    ) =>
      Promise.resolve({ data: SAMPLE_ROWS, error: null }).then(
        onFulfilled,
        onRejected,
      );
    return b;
  }
  function makeAuditCountBuilder() {
    const b: Record<string, unknown> = {};
    const passthrough = () => b;
    for (const m of ["in", "eq", "gte"]) {
      (b as Record<string, () => unknown>)[m] = passthrough;
    }
    (b as { then: unknown }).then = (
      onFulfilled: (v: unknown) => unknown,
      onRejected?: (e: unknown) => unknown,
    ) =>
      Promise.resolve({
        count: null,
        error: { message: "simulated count failure" },
      }).then(onFulfilled, onRejected);
    return b;
  }
  function makeOrgsBuilder() {
    const b: Record<string, unknown> = {};
    (b as { select: () => unknown }).select = () => b;
    (b as { in: () => unknown }).in = () => b;
    (b as { then: unknown }).then = (
      onFulfilled: (v: unknown) => unknown,
      onRejected?: (e: unknown) => unknown,
    ) =>
      Promise.resolve({
        data: [{ id: "org-aaa", name: "Org Alpha" }],
        error: null,
      }).then(onFulfilled, onRejected);
    return b;
  }
  function makeAuditBuilder() {
    return {
      select: (
        _cols: string,
        opts?: { count?: string; head?: boolean },
      ) => {
        if (opts && opts.count) return makeAuditCountBuilder();
        return makeAuditRowsBuilder();
      },
    };
  }
  return {
    supabase: {
      from: (table: string) => {
        if (table === "audit_logs") return makeAuditBuilder();
        if (table === "organizations") return makeOrgsBuilder();
        throw new Error(`Unexpected table in test: ${table}`);
      },
    },
  };
});

import { AdminOutreachBlocksPanel } from "@/components/admin/AdminOutreachBlocksPanel";

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <AdminOutreachBlocksPanel />
    </QueryClientProvider>,
  );
}

describe("Batch M :: count query failure → heuristic fallback", () => {
  beforeEach(() => {
    downloadCSVSpy.mockReset();
  });

  it("renders rows even when the precise count query fails", async () => {
    renderPanel();
    await waitFor(() =>
      expect(
        screen.getByTestId("outreach-blocks-count-text"),
      ).toBeInTheDocument(),
    );
    // No "of Y" precise wording — falls back to heuristic phrasing.
    const countText = screen.getByTestId("outreach-blocks-count-text");
    expect(countText.textContent ?? "").toMatch(
      /Showing\s+500\s+outreach-blocked event\(s\)/,
    );
    expect(countText.textContent ?? "").not.toMatch(
      /of\s+\d[\d,]*\s+matching outreach-blocked events/,
    );
  });

  it("cap warning falls back to the heuristic 'may be showing' wording", async () => {
    renderPanel();
    const warning = await screen.findByTestId("outreach-blocks-cap-warning");
    expect(warning.textContent ?? "").toMatch(/may be showing the first 500/i);
    expect(warning.textContent ?? "").not.toMatch(
      /Showing the first 500 of\s+\d/,
    );
    expect(warning.textContent ?? "").toMatch(/narrow the filters/i);
  });

  it("Export CSV still uses the currently visible rows with the safe column allowlist", async () => {
    renderPanel();
    const exportBtn = await screen.findByRole("button", { name: /Export CSV/i });
    await waitFor(() => expect(exportBtn).not.toBeDisabled());

    fireEvent.click(exportBtn);

    expect(downloadCSVSpy).toHaveBeenCalledTimes(1);
    const [headers, csvRows, filename] = downloadCSVSpy.mock.calls[0] as [
      string[],
      unknown[][],
      string,
    ];

    // Safe column allowlist preserved (Batch K/L/M contract).
    expect(headers).toEqual([
      "Created At",
      "Reason",
      "Action",
      "Organisation Name",
      "Organisation ID",
      "Engagement ID",
      "Surface",
    ]);

    // Row count matches the visible rows (heuristic-truncated to 500).
    expect(csvRows.length).toBe(ROW_LIMIT_FIXTURE);

    // Filename uses the timestamped helper for outreach-blocks.
    expect(filename).toMatch(/^izenzo-outreach-blocks-/);

    // Spot-check first row shape: organisation name resolved via the
    // safe (id, name) lookup, not raw counterparty/dispute/commercial data.
    const first = csvRows[0] as unknown[];
    expect(first[1]).toBe("Contact details incomplete");
    expect(first[2]).toBe("outreach.blocked.contact_incomplete");
    expect(first[3]).toBe("Org Alpha");
    expect(first[4]).toBe("org-aaa");
    expect(first[6]).toBe("send-outreach");
  });
});
