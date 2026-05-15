/**
 * Batch O Phase 2b Step 5 — AdminLegacyRepairPanel wiring tests.
 *
 * Asserts the admin panel now wires inconsistent rows to the existing
 * archive and repair edge functions while keeping all out-of-scope
 * systems (POI / WaD / payment / credit / notification / rating /
 * compliance / public-status / lifecycle / SLA / Batch D / Batch E)
 * untouched.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

const rpcSpy = vi.fn();
const fromSpy = vi.fn();
const invokeSpy = vi.fn();

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcSpy(...args),
    from: (...args: unknown[]) => {
      fromSpy(...args);
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
import { toast } from "sonner";

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
  inconsistency_reasons: ["settled_with_draft_poi"],
};

const VALID_NOTES = "Legacy row archived following business decision XYZ-123.";

describe("AdminLegacyRepairPanel — Step 5 admin actions", () => {
  beforeEach(() => {
    rpcSpy.mockReset();
    fromSpy.mockReset();
    invokeSpy.mockReset();
    (toast.success as ReturnType<typeof vi.fn>).mockReset();
    (toast.error as ReturnType<typeof vi.fn>).mockReset();
  });

  it("renders reason chips for inconsistent rows", async () => {
    rpcSpy.mockResolvedValueOnce({ data: [FIXTURE_ROW], error: null });
    renderPanel();
    expect(await screen.findByText(/Settled status with draft POI/i)).toBeInTheDocument();
  });

  it("does not render a detection scan button", async () => {
    rpcSpy.mockResolvedValueOnce({ data: [FIXTURE_ROW], error: null });
    renderPanel();
    await screen.findByText(/Copper Cathode/);
    expect(screen.queryByRole("button", { name: /scan/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /detect/i })).toBeNull();
  });

  it("opens archive dialog and disables submit until notes are valid", async () => {
    const user = userEvent.setup();
    rpcSpy.mockResolvedValueOnce({ data: [FIXTURE_ROW], error: null });
    renderPanel();
    await screen.findByText(/Copper Cathode/);

    await user.click(screen.getByRole("button", { name: /^Archive$/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Archive legacy match/i)).toBeInTheDocument();

    const confirm = within(dialog).getByRole("button", { name: /Confirm archive/i });
    expect(confirm).toBeDisabled();

    await user.type(within(dialog).getByLabelText(/Admin notes/i), "too short");
    expect(confirm).toBeDisabled();

    await user.clear(within(dialog).getByLabelText(/Admin notes/i));
    await user.type(within(dialog).getByLabelText(/Admin notes/i), VALID_NOTES);
    expect(confirm).toBeEnabled();
  });

  it("calls admin-match-legacy-archive with an Idempotency-Key and refetches on success", async () => {
    const user = userEvent.setup();
    rpcSpy
      .mockResolvedValueOnce({ data: [FIXTURE_ROW], error: null })
      .mockResolvedValueOnce({ data: [], error: null });
    invokeSpy.mockResolvedValueOnce({
      data: { ok: true, result: { archived: true } },
      error: null,
    });
    renderPanel();
    await screen.findByText(/Copper Cathode/);
    await user.click(screen.getByRole("button", { name: /^Archive$/ }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/Admin notes/i), VALID_NOTES);
    await user.click(within(dialog).getByRole("button", { name: /Confirm archive/i }));

    await waitFor(() => expect(invokeSpy).toHaveBeenCalledTimes(1));
    const [name, opts] = invokeSpy.mock.calls[0];
    expect(name).toBe("admin-match-legacy-archive");
    expect(opts.method).toBe("POST");
    expect(opts.headers["Idempotency-Key"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(opts.body).toEqual({ match_id: FIXTURE_ROW.id, notes: VALID_NOTES });

    await waitFor(() => expect(rpcSpy).toHaveBeenCalledTimes(2));
    expect(toast.success).toHaveBeenCalled();
  });

  it("opens repair dialog and lists allowed operations with deferred one disabled", async () => {
    const user = userEvent.setup();
    rpcSpy.mockResolvedValueOnce({ data: [FIXTURE_ROW], error: null });
    renderPanel();
    await screen.findByText(/Copper Cathode/);
    await user.click(screen.getByRole("button", { name: /^Repair$/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Repair legacy match/i)).toBeInTheDocument();

    await user.click(within(dialog).getByRole("combobox"));
    expect(await screen.findByRole("option", { name: /Clear stale settled_at/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Restore POI state for completed match/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Clear legacy repair marker/i })).toBeInTheDocument();
    const deferred = screen.getByRole("option", {
      name: /Force terminal for orphan settled \(deferred\)/i,
    });
    expect(deferred).toHaveAttribute("aria-disabled", "true");
  });

  it("repair confirm stays disabled until both operation and valid notes are set", async () => {
    const user = userEvent.setup();
    rpcSpy.mockResolvedValueOnce({ data: [FIXTURE_ROW], error: null });
    renderPanel();
    await screen.findByText(/Copper Cathode/);
    await user.click(screen.getByRole("button", { name: /^Repair$/ }));
    const dialog = await screen.findByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: /Confirm repair/i });
    expect(confirm).toBeDisabled();

    await user.type(within(dialog).getByLabelText(/Admin notes/i), VALID_NOTES);
    expect(confirm).toBeDisabled(); // operation still missing

    await user.click(within(dialog).getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: /Clear stale settled_at/i }));
    expect(confirm).toBeEnabled();
  });

  it("calls admin-match-legacy-repair with Idempotency-Key and refetches on success", async () => {
    const user = userEvent.setup();
    rpcSpy
      .mockResolvedValueOnce({ data: [FIXTURE_ROW], error: null })
      .mockResolvedValueOnce({ data: [], error: null });
    invokeSpy.mockResolvedValueOnce({
      data: { ok: true, result: { repaired: true } },
      error: null,
    });
    renderPanel();
    await screen.findByText(/Copper Cathode/);
    await user.click(screen.getByRole("button", { name: /^Repair$/ }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/Admin notes/i), VALID_NOTES);
    await user.click(within(dialog).getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: /Clear stale settled_at/i }));
    await user.click(within(dialog).getByRole("button", { name: /Confirm repair/i }));

    await waitFor(() => expect(invokeSpy).toHaveBeenCalledTimes(1));
    const [name, opts] = invokeSpy.mock.calls[0];
    expect(name).toBe("admin-match-legacy-repair");
    expect(opts.method).toBe("POST");
    expect(opts.headers["Idempotency-Key"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(opts.body).toEqual({
      match_id: FIXTURE_ROW.id,
      operation: "clear_stale_settled_at",
      notes: VALID_NOTES,
    });
    await waitFor(() => expect(rpcSpy).toHaveBeenCalledTimes(2));
    expect(toast.success).toHaveBeenCalled();
  });

  it("renders mapped error copy without exposing stack/SQL details", async () => {
    const user = userEvent.setup();
    rpcSpy.mockResolvedValueOnce({ data: [FIXTURE_ROW], error: null });
    invokeSpy.mockResolvedValueOnce({
      data: null,
      error: {
        message: "Edge Function returned a non-2xx status code",
        context: {
          response: new Response(
            JSON.stringify({
              error: "NOT_INCONSISTENT",
              message: "internal SQL detail leaked: SELECT * FROM matches WHERE ...",
              requestId: "req_x",
            }),
            { status: 409, headers: { "Content-Type": "application/json" } },
          ),
        },
      },
    });
    renderPanel();
    await screen.findByText(/Copper Cathode/);
    await user.click(screen.getByRole("button", { name: /^Archive$/ }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/Admin notes/i), VALID_NOTES);
    await user.click(within(dialog).getByRole("button", { name: /Confirm archive/i }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "This match is no longer flagged as inconsistent.",
      ),
    );
    // Defensive: SQL fragments must never reach the user.
    const errCalls = (toast.error as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => String(c[0]))
      .join(" ");
    expect(errCalls).not.toMatch(/SELECT/i);
    expect(errCalls).not.toMatch(/non-2xx/i);
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
