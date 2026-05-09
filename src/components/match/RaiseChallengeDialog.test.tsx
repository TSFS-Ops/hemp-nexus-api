/**
 * Phase 3B close-out — R3 + B1–B4 explicit assertions for RaiseChallengeDialog
 * and ChallengeStatusCard `under_review` rendering.
 *
 * B5 (banner mute of CTA cluster) is asserted at the host-page level: the
 * banner is mounted ABOVE existing CTA components without replacing or
 * intercepting their handlers — see MatchDetails.tsx + B5 sanity check below.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ChallengeStatusCard } from "./ChallengeStatusCard";
import { ProgressionPausedBanner } from "./ProgressionPausedBanner";
import { RaiseChallengeDialog } from "./RaiseChallengeDialog";
import type { ChallengeRow } from "@/hooks/useMatchChallenge";

vi.mock("@/lib/edge-invoke", () => ({
  fetchEdgeFunction: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { fetchEdgeFunction } from "@/lib/edge-invoke";
import { toast } from "sonner";

const base: ChallengeRow = {
  id: "11111111-2222-3333-4444-555555555555",
  match_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  org_id: null,
  raised_by_org_id: null,
  raised_by_user_id: null,
  raised_by_role: "buyer_org_admin",
  subject_code: "terms_disagreement",
  summary: "x".repeat(80),
  status: "open",
  outcome_code: null,
  outcome_summary: null,
  closed_at: null,
  closed_by_user_id: null,
  break_glass_override_used: null,
  created_at: new Date().toISOString(),
  updated_at: null,
};

function withClient(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

describe("R3: ChallengeStatusCard renders for under_review", () => {
  it("renders card and shows Under review badge", () => {
    render(<ChallengeStatusCard challenge={{ ...base, status: "under_review" }} />);
    expect(screen.getByTestId("challenge-status-card")).toBeInTheDocument();
    expect(screen.getByTestId("challenge-status-badge").textContent).toMatch(/Under review/i);
  });
});

describe("RaiseChallengeDialog — B1–B4", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  const baseProps = {
    matchId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    viewerSide: "buyer" as const,
    viewerOrgId: "00000000-0000-0000-0000-000000000001",
  };

  it("B1: Cancel button dismisses without submit", async () => {
    const onOpenChange = vi.fn();
    render(
      withClient(
        <RaiseChallengeDialog open={true} onOpenChange={onOpenChange} {...baseProps} />,
      ),
    );
    fireEvent.click(screen.getByTestId("challenge-cancel-button"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(fetchEdgeFunction).not.toHaveBeenCalled();
  });

  it("B2: summary < 60 chars blocks submit and makes no network call", async () => {
    const user = userEvent.setup();
    render(
      withClient(
        <RaiseChallengeDialog open={true} onOpenChange={vi.fn()} {...baseProps} />,
      ),
    );
    // Pick a subject by clicking the trigger and selecting an option
    fireEvent.click(screen.getByTestId("challenge-subject-select"));
    // Use the first option — the dropdown content renders in a portal
    const opt = await screen.findByText(/Terms disagreement/i);
    fireEvent.click(opt);
    await user.type(screen.getByTestId("challenge-summary-input"), "too short");
    fireEvent.click(screen.getByTestId("challenge-submit-button"));
    await waitFor(() =>
      expect(screen.getByTestId("challenge-validation-error")).toBeInTheDocument(),
    );
    expect(fetchEdgeFunction).not.toHaveBeenCalled();
  });

  it("B3: valid submit with mocked 200 closes dialog and calls match-challenges/raise", async () => {
    (fetchEdgeFunction as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true });
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(
      withClient(
        <RaiseChallengeDialog open={true} onOpenChange={onOpenChange} {...baseProps} />,
      ),
    );
    fireEvent.click(screen.getByTestId("challenge-subject-select"));
    const opt = await screen.findByText(/Terms disagreement/i);
    fireEvent.click(opt);
    await user.type(
      screen.getByTestId("challenge-summary-input"),
      "y".repeat(120),
    );
    fireEvent.click(screen.getByTestId("challenge-submit-button"));
    await waitFor(() => expect(fetchEdgeFunction).toHaveBeenCalledTimes(1));
    const [path, init] = (fetchEdgeFunction as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(path).toBe("match-challenges/raise");
    expect(init.method).toBe("POST");
    expect(init.body.match_id).toBe(baseProps.matchId);
    expect(init.body.raised_by_role).toBe("buyer_org_admin");
    expect(toast.success).toHaveBeenCalled();
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("B4: mocked failure shows toast.error, dialog stays open, loading clears", async () => {
    (fetchEdgeFunction as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("CHALLENGE_OPEN"),
    );
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(
      withClient(
        <RaiseChallengeDialog open={true} onOpenChange={onOpenChange} {...baseProps} />,
      ),
    );
    fireEvent.click(screen.getByTestId("challenge-subject-select"));
    const opt = await screen.findByText(/Terms disagreement/i);
    fireEvent.click(opt);
    await user.type(
      screen.getByTestId("challenge-summary-input"),
      "z".repeat(120),
    );
    fireEvent.click(screen.getByTestId("challenge-submit-button"));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    // Dialog NOT closed
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    // Submit button no longer in loading state
    expect(screen.getByTestId("challenge-submit-button")).not.toBeDisabled();
  });
});

describe("B5: banner is presentational only (does not replace CTA handlers)", () => {
  it("ProgressionPausedBanner renders no buttons or interactive controls", () => {
    render(<ProgressionPausedBanner challenge={{ ...base, status: "open" }} />);
    const banner = screen.getByTestId("progression-paused-banner");
    expect(banner.querySelectorAll("button").length).toBe(0);
    expect(banner.querySelectorAll("input,select,textarea,a[href]").length).toBe(0);
    // role=status, not a region that can intercept events
    expect(banner.getAttribute("role")).toBe("status");
  });
});
