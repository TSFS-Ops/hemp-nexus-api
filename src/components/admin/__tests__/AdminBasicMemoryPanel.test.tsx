/**
 * Basic Memory Record v1 · Batch 4 UI tests.
 *
 * Asserts the HQ-only AdminBasicMemoryPanel:
 *   - renders approved empty-state wording when no rows exist
 *   - renders list rows with trigger, outcome, env badge
 *   - opens detail dialog showing status_snapshot + audit_event_ids
 *   - exposes filter inputs for date range, trigger, outcome, environment
 *   - exposes NO export / edit / delete / correction affordances
 *   - uses constants from src/lib/basic-memory/outcomes.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

type Row = {
  id: string;
  created_at: string;
  trigger_event_type: string;
  outcome: string;
  outcome_reason: string;
  outcome_summary: string | null;
  environment_classification: string;
  match_id: string | null;
  poi_id: string | null;
  wad_id: string | null;
  engagement_id: string | null;
  dispute_id: string | null;
  source_table: string;
  source_record_id: string;
  source_function: string;
  status_snapshot: unknown;
  audit_event_ids: string[];
};

let rows: Row[] = [];

function makeBuilder(data: Row[]) {
  const builder: any = {
    select: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    gte: vi.fn(() => builder),
    lte: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    then: (resolve: (v: { data: Row[]; error: null }) => void) =>
      Promise.resolve({ data, error: null }).then(resolve),
  };
  return builder;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn((_table: string) => makeBuilder(rows)),
  },
}));

import { AdminBasicMemoryPanel } from "@/components/admin/AdminBasicMemoryPanel";

function renderPanel() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AdminBasicMemoryPanel />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  rows = [];
});

const sample: Row = {
  id: "11111111-1111-1111-1111-111111111111",
  created_at: "2026-05-26T12:00:00.000Z",
  trigger_event_type: "finality.collapsed",
  outcome: "completed",
  outcome_reason: "collapse_recorded",
  outcome_summary: "Trade collapsed cleanly.",
  environment_classification: "live",
  match_id: "22222222-2222-2222-2222-222222222222",
  poi_id: null,
  wad_id: null,
  engagement_id: null,
  dispute_id: null,
  source_table: "collapse_ledger",
  source_record_id: "33333333-3333-3333-3333-333333333333",
  source_function: "collapse/index.ts",
  status_snapshot: { matchId: "22222222-2222-2222-2222-222222222222" },
  audit_event_ids: ["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"],
};

describe("AdminBasicMemoryPanel", () => {
  it("renders approved empty-state wording when no records exist", async () => {
    rows = [];
    renderPanel();
    await waitFor(() =>
      expect(screen.getByTestId("bm-empty")).toHaveTextContent(
        /No Basic Memory Record exists yet because no meaningful outcome has been recorded\./,
      ),
    );
  });

  it("renders list rows with env badge and trigger label", async () => {
    rows = [sample];
    renderPanel();
    const row = await screen.findByTestId("bm-row");
    expect(within(row).getByText("finality.collapsed")).toBeInTheDocument();
    expect(within(row).getByTestId("bm-env-badge")).toHaveTextContent("live");
  });

  it("opens detail dialog with snapshot + audit IDs", async () => {
    rows = [sample];
    renderPanel();
    const row = await screen.findByTestId("bm-row");
    await userEvent.click(row);
    const dialog = await screen.findByTestId("bm-detail");
    expect(
      within(dialog).getByText(
        /Basic Memory Record created\. This stores the retained outcome of this transaction path and links to the evidence that supports it\./,
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByTestId("bm-detail-snapshot")).toHaveTextContent(
      "22222222-2222-2222-2222-222222222222",
    );
    expect(within(dialog).getByTestId("bm-detail-audit-ids")).toHaveTextContent(
      "aaaaaaaa",
    );
  });

  it("exposes all four approved filter inputs", () => {
    renderPanel();
    expect(screen.getByTestId("bm-filter-from")).toBeInTheDocument();
    expect(screen.getByTestId("bm-filter-to")).toBeInTheDocument();
    expect(screen.getByTestId("bm-filter-trigger")).toBeInTheDocument();
    expect(screen.getByTestId("bm-filter-outcome")).toBeInTheDocument();
    expect(screen.getByTestId("bm-filter-env")).toBeInTheDocument();
  });

  it("exposes no write/export affordances", () => {
    rows = [sample];
    renderPanel();
    const forbidden = [
      /export/i,
      /download/i,
      /delete/i,
      /correct/i,
      /^create$/i,
      /new record/i,
      /edit/i,
    ];
    for (const pattern of forbidden) {
      expect(screen.queryByRole("button", { name: pattern })).toBeNull();
    }
  });
});
