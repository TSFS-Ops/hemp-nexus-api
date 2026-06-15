/**
 * Phase 3B UI smoke tests for the AI Review workspace.
 *
 * Verifies:
 *   - Tabs render (Pending Review, Stale Intel, Failed Searches, Analytics).
 *   - "Verified" wording is NOT used for AI confidence. Only "Discovery
 *     Confidence" or "AI Intel Confidence" variants are allowed.
 *   - The Stale Intel and Failed Searches tabs render without crashing.
 *
 * Supabase access is fully mocked. No network is touched.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/integrations/supabase/client", () => {
  const builder = () => {
    const b: any = {
      select: vi.fn(() => b),
      eq: vi.fn(() => b),
      in: vi.fn(() => b),
      or: vi.fn(() => b),
      not: vi.fn(() => b),
      order: vi.fn(() => b),
      limit: vi.fn(() => Promise.resolve({ data: [], error: null })),
      maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
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

// AiSuggestionLauncher pulls a lot of unrelated data; stub it.
vi.mock("@/components/admin/ai-review/AiSuggestionLauncher", () => ({
  AiSuggestionLauncher: () => <div data-testid="ai-launcher-stub" />,
}));

import { AiReviewWorkspace } from "../AiReviewWorkspace";

function renderWorkspace() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AiReviewWorkspace />
    </QueryClientProvider>,
  );
}

describe("AiReviewWorkspace", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders all nine review tabs", () => {
    renderWorkspace();
    for (const label of [
      "Pending Review",
      "Approved Shortlists",
      "Draft Outreach",
      "Ready to Send",
      "Sent Outreach",
      "Responses",
      "Failed Searches",
      "Stale Intel",
      "Analytics",
    ]) {
      expect(screen.getByRole("tab", { name: label })).toBeInTheDocument();
    }
  });

  it("never labels AI confidence as 'Verified'", async () => {
    const { container } = renderWorkspace();
    // Switch through tabs to render their bodies.
    for (const label of ["Stale Intel", "Failed Searches", "Analytics", "Pending Review"]) {
      fireEvent.click(screen.getByRole("tab", { name: label }));
      await waitFor(() => container.textContent !== null);
    }
    const text = container.textContent ?? "";
    // Allow "verification" (escalation target) but never "verified" used as an
    // AI confidence claim. We assert the word in isolation does not appear.
    expect(/\bverified\b/i.test(text)).toBe(false);
    expect(text).toMatch(/Discovery Confidence|AI Intel Confidence/);
  });

  it("renders the Failed Searches tab without crashing", async () => {
    const { container } = renderWorkspace();
    fireEvent.click(screen.getByRole("tab", { name: "Failed Searches" }));
    await new Promise((r) => setTimeout(r, 50));
    expect(container.textContent).toMatch(/Failed Searches|provider_failure_review/i);
  });

  it("renders the Stale Intel tab without crashing", async () => {
    const { container } = renderWorkspace();
    fireEvent.click(screen.getByRole("tab", { name: "Stale Intel" }));
    await new Promise((r) => setTimeout(r, 50));
    expect(container.textContent).toMatch(/Stale Intel/i);
  });

  it("renders the Analytics placeholder", async () => {
    const { container } = renderWorkspace();
    fireEvent.click(screen.getByRole("tab", { name: "Analytics" }));
    await new Promise((r) => setTimeout(r, 50));
    expect(container.textContent).toMatch(/Phase 6|Analytics/);
  });
});
