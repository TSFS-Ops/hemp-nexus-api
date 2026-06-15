/**
 * Phase 6 — AI Analytics tab tests.
 *
 * Verifies:
 *   1. Tab renders.
 *   2. Summary cards render.
 *   3. "Discovery Confidence" / "AI Intel Confidence" wording is used.
 *   4. "Verified" is not used for AI confidence.
 *   5. Empty state renders where data is missing.
 *   6. Provider cost displays "Not configured".
 *   7. Analytics never renders raw payload / source snippets / internal notes.
 *   8. Rejection reasons table is present.
 *   9. Outreach outcomes table is present.
 *  10. Provider usage table is present.
 *  11. Failed searches / provider failures table is present.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/integrations/supabase/client", () => {
  const builder = () => {
    const b: any = {
      select: vi.fn(() => b),
      eq: vi.fn(() => b),
      in: vi.fn(() => b),
      or: vi.fn(() => b),
      not: vi.fn(() => b),
      gte: vi.fn(() => b),
      lte: vi.fn(() => b),
      order: vi.fn(() => b),
      limit: vi.fn(() => Promise.resolve({ data: [], error: null })),
    };
    return b;
  };
  return {
    supabase: {
      from: vi.fn(() => builder()),
      functions: { invoke: vi.fn(() => Promise.resolve({ data: {}, error: null })) },
    },
  };
});

import { AiAnalyticsTab } from "../AiAnalyticsTab";

function renderTab() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AiAnalyticsTab />
    </QueryClientProvider>,
  );
}

describe("AiAnalyticsTab (Phase 6)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders the analytics surface with summary cards", async () => {
    const { container } = renderTab();
    await waitFor(() => {
      expect(container.querySelector('[data-testid="ai-analytics-summary"]')).toBeTruthy();
    });
    expect(container.textContent).toMatch(/Searches run/);
    expect(container.textContent).toMatch(/Counterparties found/);
    expect(container.textContent).toMatch(/Outreach sent/);
  });

  it("uses 'Discovery Confidence' / 'AI Intel Confidence' wording", async () => {
    const { container } = renderTab();
    await waitFor(() => container.querySelector('[data-testid="ai-analytics-summary"]'));
    const text = container.textContent ?? "";
    expect(text).toMatch(/Discovery Confidence|AI Intel Confidence/);
  });

  it("does not label AI confidence as 'Verified'", async () => {
    const { container } = renderTab();
    await waitFor(() => container.querySelector('[data-testid="ai-analytics-summary"]'));
    const text = container.textContent ?? "";
    expect(/verified\s*(confidence|intel|counterparty)/i.test(text)).toBe(false);
    expect(/confidence[:\s]+verified/i.test(text)).toBe(false);
  });

  it("renders empty states when no data is present", async () => {
    const { container } = renderTab();
    await waitFor(() => container.querySelector('[data-testid="ai-analytics-summary"]'));
    const text = container.textContent ?? "";
    expect(text).toMatch(/No rejected items in range/);
    expect(text).toMatch(/No outreach outcomes/);
    expect(text).toMatch(/No provider calls/);
    expect(text).toMatch(/No provider failures/);
  });

  it("displays 'Not configured' for provider cost / monthly limit", async () => {
    const { container } = renderTab();
    await waitFor(() => container.querySelector('[data-testid="ai-analytics-summary"]'));
    expect((container.textContent ?? "")).toMatch(/Not configured/);
  });

  it("renders rejection reasons, outreach outcomes, provider usage and failed searches panels", async () => {
    const { container } = renderTab();
    await waitFor(() => container.querySelector('[data-testid="ai-analytics-summary"]'));
    const text = container.textContent ?? "";
    expect(text).toMatch(/Rejection reasons/);
    expect(text).toMatch(/Outreach outcomes/);
    expect(text).toMatch(/Provider usage/);
    expect(text).toMatch(/Failed searches/);
  });

  it("does not render raw AI payloads, source snippets, or internal notes", async () => {
    const { container } = renderTab();
    await waitFor(() => container.querySelector('[data-testid="ai-analytics-summary"]'));
    const text = (container.textContent ?? "").toLowerCase();
    // None of these admin-only raw fields should appear in the analytics surface.
    expect(text).not.toMatch(/raw_payload|payload_raw|source_snippet|internal_note/);
  });

  it("is clearly labelled as operational analytics, not compliance", async () => {
    const { container } = renderTab();
    await waitFor(() => container.querySelector('[data-testid="ai-analytics-summary"]'));
    expect((container.textContent ?? "")).toMatch(/Operational analytics/);
  });
});
