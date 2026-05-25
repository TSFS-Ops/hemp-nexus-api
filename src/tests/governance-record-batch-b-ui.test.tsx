/**
 * governance-record-batch-b-ui.test.tsx
 *
 * Batch B UI acceptance:
 *   - Original event row shows the "Corrected by later HQ note" badge when a
 *     later hq.event_corrected references it.
 *   - Original event row keeps a "Correct this event" affordance for HQ.
 *   - hq.event_corrected rows do NOT show "Correct this event".
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

const MATCH_ID = "11111111-1111-1111-1111-111111111111";
const ORIGINAL_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const CORRECTION_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const mockUseAuth = vi.fn();
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => mockUseAuth(),
}));

const matchRow = {
  id: MATCH_ID,
  status: "settled",
  state: "ACTIVE",
  poi_state: "ELIGIBLE",
  commodity: "Copper",
  buyer_org_id: "b-org",
  seller_org_id: "s-org",
  buyer_name: "Acme Buyer",
  seller_name: "Globex Seller",
  settled_at: null,
  is_demo: false,
  created_at: "2026-05-01T00:00:00Z",
  finality_tokens_burned: 0,
};

// Two event_store rows: an original POI event and a later correction
// targeting it via payload.corrects_event_id.
const originalRow = {
  id: ORIGINAL_ID,
  event_type: "poi.state_changed",
  aggregate_type: "match",
  aggregate_id: MATCH_ID,
  occurred_at: "2026-05-20T10:00:00Z",
  actor_id: "user-1",
  actor_role: "user",
  org_id: "b-org",
  payload: { match_id: MATCH_ID, new_state: "ELIGIBLE" },
};

const correctionRow = {
  id: CORRECTION_ID,
  event_type: "hq.event_corrected",
  aggregate_type: "match",
  aggregate_id: MATCH_ID,
  occurred_at: "2026-05-22T10:00:00Z",
  actor_id: "admin-1",
  actor_role: "platform_admin",
  org_id: "b-org",
  payload: {
    match_id: MATCH_ID,
    corrects_event_id: ORIGINAL_ID,
    note: "Data corrected per ops request.",
    reason: "incorrect_data_correction",
  },
};

function makeBuilder(rows: any[]) {
  const b: any = {
    _rows: rows,
    select() { return this; },
    eq() { return this; },
    in() { return this; },
    like() { return this; },
    or() { return this; },
    filter() { return this; },
    order() { return this; },
    limit() { return Promise.resolve({ data: this._rows, error: null }); },
    maybeSingle() { return Promise.resolve({ data: this._rows[0] ?? null, error: null }); },
    then(resolve: any) { return Promise.resolve({ data: this._rows, error: null }).then(resolve); },
  };
  return b;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from(table: string) {
      switch (table) {
        case "matches": return makeBuilder([matchRow]);
        case "audit_logs": return makeBuilder([]);
        case "admin_audit_logs": return makeBuilder([]);
        case "event_store": return makeBuilder([originalRow, correctionRow]);
        case "match_events": return makeBuilder([]);
        default: return makeBuilder([]);
      }
    },
    functions: { invoke: vi.fn() },
  },
}));

import { GovernanceRecordDetail } from "@/components/admin/governance/GovernanceRecordDetail";

function renderDetail() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <GovernanceRecordDetail anchor={{ matchId: MATCH_ID }} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Batch B — Governance Record correction UI", () => {
  beforeEach(() => {
    mockUseAuth.mockReset();
  });

  it("renders 'Corrected by later HQ note' badge on the corrected original row", async () => {
    mockUseAuth.mockReturnValue({ isPlatformAdmin: true });
    renderDetail();
    await waitFor(() => {
      expect(screen.getByTestId("corrected-badge")).toBeInTheDocument();
    });
    const badge = screen.getByTestId("corrected-badge");
    expect(badge).toHaveTextContent("Corrected by later HQ note");
    // Badge encodes the correction event id for traceability.
    expect(badge.getAttribute("data-correction-event-id")).toBe(CORRECTION_ID);
  });

  it("renders 'Correct this event' affordance for HQ on event_store rows", async () => {
    mockUseAuth.mockReturnValue({ isPlatformAdmin: true });
    renderDetail();
    await waitFor(() => {
      expect(screen.queryAllByTestId("correct-event-button").length).toBeGreaterThan(0);
    });
    const buttons = screen.getAllByTestId("correct-event-button");
    const targetIds = buttons.map((b) => b.getAttribute("data-source-row-id"));
    // Original event must be correctable. Correction event must NOT.
    expect(targetIds).toContain(ORIGINAL_ID);
    expect(targetIds).not.toContain(CORRECTION_ID);
  });

  it("hides the 'Correct this event' affordance for non-HQ users", async () => {
    mockUseAuth.mockReturnValue({ isPlatformAdmin: false });
    renderDetail();
    // Wait for the timeline to render at least one row before asserting absence.
    await waitFor(() => {
      expect(screen.queryAllByTestId("governance-timeline-row").length).toBeGreaterThan(0);
    });
    expect(screen.queryAllByTestId("correct-event-button")).toHaveLength(0);
  });
});
