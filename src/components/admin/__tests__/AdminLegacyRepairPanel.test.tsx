/**
 * Batch O Phase 2 closeout — AdminLegacyRepairPanel render test.
 *
 * Asserts:
 *   • inconsistent rows returned by the admin RPC are rendered (item 9);
 *   • when the RPC returns no rows, the empty-state copy renders
 *     (the panel itself filters nothing — clean rows never reach it);
 *   • the panel surfaces read-only copy and zero repair/archive buttons (item 11);
 *   • rendering causes no POI/WaD/payment/credit/notification side effects:
 *     only the single admin_list_inconsistent_matches RPC call is made (item 13).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

const rpcSpy = vi.fn();
const fromSpy = vi.fn();
const invokeSpy = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcSpy(...args),
    from: (...args: unknown[]) => {
      fromSpy(...args);
      // any chained call returns rejected to prove it isn't relied on
      return new Proxy(
        {},
        {
          get: () => () => Promise.reject(new Error("from() should not be called")),
        },
      );
    },
    functions: { invoke: (...args: unknown[]) => invokeSpy(...args) },
  },
}));

import { AdminLegacyRepairPanel } from "@/components/admin/AdminLegacyRepairPanel";

function renderPanel() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AdminLegacyRepairPanel />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const FIXTURE_ROW = {
  id: "11111111-1111-1111-1111-111111111111",
  commodity: "Copper Cathode",
  buyer_org_id: "22222222-2222-2222-2222-222222222222",
  seller_org_id: "33333333-3333-3333-3333-333333333333",
  org_id: null,
  buyer_name: "Buyer Co",
  seller_name: "Seller Co",
  status: "settled",
  state: "discovery",
  poi_state: "DRAFT",
  settled_at: "2026-01-01T00:00:00Z",
  completed_at: null,
  buyer_committed_at: null,
  seller_committed_at: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
  metadata: null,
  inconsistency_reasons: ["settled_status_with_draft_poi"],
};

describe("AdminLegacyRepairPanel — read-only Phase 2", () => {
  beforeEach(() => {
    rpcSpy.mockReset();
    fromSpy.mockReset();
    invokeSpy.mockReset();
  });

  it("renders inconsistent rows returned by the admin RPC", async () => {
    rpcSpy.mockResolvedValueOnce({ data: [FIXTURE_ROW], error: null });
    renderPanel();
    expect(await screen.findByText(/Copper Cathode/)).toBeInTheDocument();
    expect(screen.getByText(/Settled status with draft POI/i)).toBeInTheDocument();
    expect(rpcSpy).toHaveBeenCalledWith("admin_list_inconsistent_matches");
  });

  it("renders the clean empty state when the RPC returns no rows", async () => {
    rpcSpy.mockResolvedValueOnce({ data: [], error: null });
    renderPanel();
    expect(
      await screen.findByText(/No inconsistent matches detected/i),
    ).toBeInTheDocument();
  });

  it("ships read-only copy and no repair / archive / mark-reviewed actions", async () => {
    rpcSpy.mockResolvedValueOnce({ data: [FIXTURE_ROW], error: null });
    renderPanel();
    await screen.findByText(/Copper Cathode/);
    expect(screen.getByText(/coming next/i)).toBeInTheDocument();
    // Defensive: no destructive affordances render.
    expect(screen.queryByRole("button", { name: /repair/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /archive/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /mark reviewed/i })).toBeNull();
    // The only navigational affordance is a Spine deep link.
    expect(screen.getByRole("link", { name: /open/i })).toBeInTheDocument();
  });

  it("makes no POI/WaD/payment/credit/notification side-effect calls on render", async () => {
    rpcSpy.mockResolvedValueOnce({ data: [FIXTURE_ROW], error: null });
    renderPanel();
    await waitFor(() => expect(rpcSpy).toHaveBeenCalledTimes(1));
    expect(rpcSpy).toHaveBeenCalledWith("admin_list_inconsistent_matches");
    expect(fromSpy).not.toHaveBeenCalled();
    expect(invokeSpy).not.toHaveBeenCalled();
  });
});
