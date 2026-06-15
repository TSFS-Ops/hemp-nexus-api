/**
 * Phase 4 — MatchApprovedAiSummary tests.
 *
 * Verifies the Phase 4 visibility contract:
 *
 *   • renders NOTHING when the server returns no row (i.e. when
 *     client_visible=false, status≠approved_client_view, or
 *     approved_payload is missing — all three are collapsed to "no row"
 *     by the security-definer RPC);
 *   • renders ONLY whitelisted safe fields when a row is returned;
 *   • never surfaces raw payload, source URLs, confidence numbers, or
 *     "Verified" wording;
 *   • uses the conservative fallback "Potential counterparty under
 *     review" when the approved payload has no counterparty name;
 *   • action buttons call the `match-ai-summary-action` edge function
 *     with the correct action and do not change AI/POI/match state.
 *
 * Supabase + fetchEdgeFunction are fully mocked.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ── Mock supabase.rpc(get_match_approved_ai_summary) ──────────────────
const rpcMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: unknown[]) => rpcMock(...args) },
}));

// ── Mock edge-invoke ─────────────────────────────────────────────────
const fetchEdgeFunctionMock = vi.fn();
vi.mock("@/lib/edge-invoke", () => ({
  fetchEdgeFunction: (...args: unknown[]) => fetchEdgeFunctionMock(...args),
  EdgeInvokeError: class EdgeInvokeError extends Error {},
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { MatchApprovedAiSummary } from "../MatchApprovedAiSummary";

const wrap = (ui: React.ReactNode) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
};

beforeEach(() => {
  rpcMock.mockReset();
  fetchEdgeFunctionMock.mockReset();
});

describe("MatchApprovedAiSummary (Phase 4)", () => {
  it("renders nothing when the RPC returns no row (client_visible=false, status≠approved_client_view, or approved_payload missing)", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    const { container } = wrap(<MatchApprovedAiSummary matchId="m-1" />);
    await waitFor(() => {
      expect(rpcMock).toHaveBeenCalledWith("get_match_approved_ai_summary", {
        _match_id: "m-1",
      });
    });
    expect(container.querySelector('[data-testid="match-approved-ai-summary"]')).toBeNull();
  });

  it("renders nothing when the RPC errors (defensive — never expose anything by default)", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    const { container } = wrap(<MatchApprovedAiSummary matchId="m-1" />);
    await waitFor(() => expect(rpcMock).toHaveBeenCalled());
    expect(container.querySelector('[data-testid="match-approved-ai-summary"]')).toBeNull();
  });

  it("renders only safe whitelisted fields when a row is returned", async () => {
    rpcMock.mockResolvedValueOnce({
      data: [
        {
          proposed_match_id: "pm-1",
          match_id: "m-1",
          suggested_counterparty_name: "Acme Trading Ltd",
          counterparty_role: "buyer",
          jurisdiction: "Kenya",
          sector_or_product_fit: "Coffee, green beans",
          short_summary: "Active green-coffee buyer with EU distribution.",
          status_label: "Approved summary available",
          approved_at: "2026-06-15T10:00:00Z",
        },
      ],
      error: null,
    });

    wrap(<MatchApprovedAiSummary matchId="m-1" />);

    expect(await screen.findByText("Acme Trading Ltd")).toBeTruthy();
    expect(screen.getByText("Kenya")).toBeTruthy();
    expect(screen.getByText("Coffee, green beans")).toBeTruthy();
    expect(
      screen.getByText("Active green-coffee buyer with EU distribution."),
    ).toBeTruthy();
    expect(screen.getByText("Approved summary available")).toBeTruthy();

    // Forbidden surfaces must not appear.
    const html = document.body.innerHTML.toLowerCase();
    expect(html).not.toContain("verified");
    expect(html).not.toContain("compliance passed");
    expect(html).not.toContain("kyb approved");
    expect(html).not.toContain("wad ready");
    expect(html).not.toContain("bank verified");
    // Never surface raw payloads, sources, confidence numbers, risk flags.
    expect(html).not.toContain("original_payload");
    expect(html).not.toContain("edited_payload");
    expect(html).not.toContain("approved_payload");
    expect(html).not.toContain("source_url");
    expect(html).not.toContain("risk_flag");
    expect(html).not.toContain("confidence_score");
  });

  it("falls back to 'Potential counterparty under review' when no approved name", async () => {
    rpcMock.mockResolvedValueOnce({
      data: [
        {
          proposed_match_id: "pm-2",
          match_id: "m-1",
          suggested_counterparty_name: null,
          counterparty_role: "seller",
          jurisdiction: null,
          sector_or_product_fit: null,
          short_summary: null,
          status_label: "Approved summary available",
          approved_at: null,
        },
      ],
      error: null,
    });
    wrap(<MatchApprovedAiSummary matchId="m-1" />);
    expect(await screen.findByText("Potential counterparty under review")).toBeTruthy();
  });

  it("'Flag incorrect information' creates an internal task via the edge function (no AI/POI/match state change)", async () => {
    rpcMock.mockResolvedValueOnce({
      data: [
        {
          proposed_match_id: "pm-1",
          match_id: "m-1",
          suggested_counterparty_name: "Acme Trading Ltd",
          counterparty_role: "buyer",
          jurisdiction: "Kenya",
          sector_or_product_fit: null,
          short_summary: null,
          status_label: "Approved summary available",
          approved_at: null,
        },
      ],
      error: null,
    });
    fetchEdgeFunctionMock.mockResolvedValueOnce({ ok: true, task_id: "t-1" });

    wrap(<MatchApprovedAiSummary matchId="m-1" />);
    fireEvent.click(await screen.findByTestId("ai-summary-flag-btn"));
    const textarea = await screen.findByRole("textbox");
    fireEvent.change(textarea, { target: { value: "Country is wrong — they operate from Kenya, not Ghana." } });
    fireEvent.click(screen.getByRole("button", { name: /flag for review/i }));

    await waitFor(() => {
      expect(fetchEdgeFunctionMock).toHaveBeenCalledTimes(1);
    });
    const [path, opts] = fetchEdgeFunctionMock.mock.calls[0];
    expect(path).toBe("match-ai-summary-action");
    expect(opts.method).toBe("POST");
    expect(opts.body.action).toBe("flag_incorrect");
    expect(opts.body.match_id).toBe("m-1");
    expect(typeof opts.body.note).toBe("string");
  });

  it("'Request more intel' sends action=request_more_intel (note optional)", async () => {
    rpcMock.mockResolvedValueOnce({
      data: [
        {
          proposed_match_id: "pm-1",
          match_id: "m-1",
          suggested_counterparty_name: "Acme",
          counterparty_role: null,
          jurisdiction: null,
          sector_or_product_fit: null,
          short_summary: null,
          status_label: null,
          approved_at: null,
        },
      ],
      error: null,
    });
    fetchEdgeFunctionMock.mockResolvedValueOnce({ ok: true });
    wrap(<MatchApprovedAiSummary matchId="m-1" />);
    fireEvent.click(await screen.findByTestId("ai-summary-request-more-btn"));
    fireEvent.click(await screen.findByRole("button", { name: /request more intel/i }));
    await waitFor(() => expect(fetchEdgeFunctionMock).toHaveBeenCalled());
    const [, opts] = fetchEdgeFunctionMock.mock.calls[0];
    expect(opts.body.action).toBe("request_more_intel");
  });

  it("'Ask Izenzo to proceed' sends action=ask_izenzo_to_proceed and does NOT call any POI/match/outreach endpoint", async () => {
    rpcMock.mockResolvedValueOnce({
      data: [
        {
          proposed_match_id: "pm-1",
          match_id: "m-1",
          suggested_counterparty_name: "Acme",
          counterparty_role: null,
          jurisdiction: null,
          sector_or_product_fit: null,
          short_summary: null,
          status_label: null,
          approved_at: null,
        },
      ],
      error: null,
    });
    fetchEdgeFunctionMock.mockResolvedValueOnce({ ok: true });
    wrap(<MatchApprovedAiSummary matchId="m-1" />);
    fireEvent.click(await screen.findByTestId("ai-summary-proceed-btn"));
    fireEvent.click(await screen.findByRole("button", { name: /ask izenzo to proceed/i }));
    await waitFor(() => expect(fetchEdgeFunctionMock).toHaveBeenCalled());
    const calls = fetchEdgeFunctionMock.mock.calls;
    // Only one call, only to the Phase 4 action endpoint. Nothing else.
    expect(calls.length).toBe(1);
    expect(calls[0][0]).toBe("match-ai-summary-action");
    expect(calls[0][1].body.action).toBe("ask_izenzo_to_proceed");
  });
});
