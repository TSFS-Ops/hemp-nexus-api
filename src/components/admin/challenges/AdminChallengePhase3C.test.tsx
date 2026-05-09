/**
 * Phase 3C — Admin queue, drawer, and dialog test matrix.
 *
 * Covers:
 *   R4–R6: drawer action visibility by status
 *   B1–B7: dialog validation, mutation success, error, dismissal
 *
 * Uses fireEvent + jsdom polyfills configured in src/test/setup.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ChallengeRow } from "@/hooks/useMatchChallenge";

vi.mock("@/lib/edge-invoke", () => ({ fetchEdgeFunction: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ isPlatformAdmin: true }),
}));

import { fetchEdgeFunction } from "@/lib/edge-invoke";
import { toast } from "sonner";
import { AdminChallengeReviewDrawer } from "./AdminChallengeReviewDrawer";
import { RecordOutcomeDialog } from "./RecordOutcomeDialog";
import { AdminOverrideDialog } from "./AdminOverrideDialog";

function withProviders(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

const baseChallenge: ChallengeRow = {
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

describe("AdminChallengeReviewDrawer — R4/R5/R6", () => {
  beforeEach(() => vi.clearAllMocks());

  it("R4: open status shows all four actions", () => {
    render(
      withProviders(
        <AdminChallengeReviewDrawer open onOpenChange={() => {}} challenge={{ ...baseChallenge, status: "open" }} />,
      ),
    );
    expect(screen.getByTestId("action-move-to-review")).toBeInTheDocument();
    expect(screen.getByTestId("action-record-outcome")).toBeInTheDocument();
    expect(screen.getByTestId("action-close-no-action")).toBeInTheDocument();
    expect(screen.getByTestId("action-admin-override")).toBeInTheDocument();
  });

  it("R5: under_review hides Move-to-Under-Review and shows the rest", () => {
    render(
      withProviders(
        <AdminChallengeReviewDrawer open onOpenChange={() => {}} challenge={{ ...baseChallenge, status: "under_review" }} />,
      ),
    );
    expect(screen.queryByTestId("action-move-to-review")).not.toBeInTheDocument();
    expect(screen.getByTestId("action-record-outcome")).toBeInTheDocument();
    expect(screen.getByTestId("action-close-no-action")).toBeInTheDocument();
    expect(screen.getByTestId("action-admin-override")).toBeInTheDocument();
  });

  it("R6: terminal status (outcome_recorded) shows zero action buttons", () => {
    render(
      withProviders(
        <AdminChallengeReviewDrawer
          open
          onOpenChange={() => {}}
          challenge={{
            ...baseChallenge,
            status: "outcome_recorded",
            outcome_code: "no_action_required",
            closed_at: new Date().toISOString(),
          }}
        />,
      ),
    );
    expect(screen.queryByTestId("drawer-actions")).not.toBeInTheDocument();
  });
});

describe("RecordOutcomeDialog — B1/B2/B3/B7", () => {
  beforeEach(() => vi.clearAllMocks());

  it("B1: summary <40 chars blocks submit, no network call", async () => {
    render(
      withProviders(
        <RecordOutcomeDialog
          open
          onOpenChange={() => {}}
          mode="closed_no_action"
          challengeId={baseChallenge.id}
          matchId={baseChallenge.match_id}
        />,
      ),
    );
    fireEvent.change(screen.getByTestId("outcome-summary-input"), { target: { value: "too short" } });
    fireEvent.click(screen.getByTestId("outcome-submit-button"));
    await waitFor(() =>
      expect(screen.getByTestId("outcome-validation-error")).toBeInTheDocument(),
    );
    expect(fetchEdgeFunction).not.toHaveBeenCalled();
  });

  it("B2: 200 closes dialog, calls match-challenges/transition with correct payload", async () => {
    (fetchEdgeFunction as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true });
    const onOpenChange = vi.fn();
    render(
      withProviders(
        <RecordOutcomeDialog
          open
          onOpenChange={onOpenChange}
          mode="outcome_recorded"
          challengeId={baseChallenge.id}
          matchId={baseChallenge.match_id}
        />,
      ),
    );
    fireEvent.click(screen.getByTestId("outcome-code-select"));
    const opt = await screen.findByText(/Corrected — trade may proceed/);
    fireEvent.click(opt);
    fireEvent.change(screen.getByTestId("outcome-summary-input"), {
      target: { value: "y".repeat(80) },
    });
    fireEvent.click(screen.getByTestId("outcome-submit-button"));
    await waitFor(() => expect(fetchEdgeFunction).toHaveBeenCalledTimes(1));
    const [path, init] = (fetchEdgeFunction as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(path).toBe("match-challenges/transition");
    expect(init.body.to_status).toBe("outcome_recorded");
    expect(init.body.outcome_code).toBe("corrected_and_proceed");
    expect(init.body.challenge_id).toBe(baseChallenge.id);
    expect(toast.success).toHaveBeenCalled();
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("B3: failure surfaces toast.error, dialog stays open, loading clears", async () => {
    (fetchEdgeFunction as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("BOOM"));
    const onOpenChange = vi.fn();
    render(
      withProviders(
        <RecordOutcomeDialog
          open
          onOpenChange={onOpenChange}
          mode="closed_no_action"
          challengeId={baseChallenge.id}
          matchId={baseChallenge.match_id}
        />,
      ),
    );
    fireEvent.change(screen.getByTestId("outcome-summary-input"), {
      target: { value: "z".repeat(80) },
    });
    fireEvent.click(screen.getByTestId("outcome-submit-button"));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(screen.getByTestId("outcome-submit-button")).not.toBeDisabled();
  });

  it("B7: Cancel dismisses RecordOutcomeDialog without submit", async () => {
    const onOpenChange = vi.fn();
    render(
      withProviders(
        <RecordOutcomeDialog
          open
          onOpenChange={onOpenChange}
          mode="closed_no_action"
          challengeId={baseChallenge.id}
          matchId={baseChallenge.match_id}
        />,
      ),
    );
    fireEvent.click(screen.getByTestId("outcome-cancel-button"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(fetchEdgeFunction).not.toHaveBeenCalled();
  });
});

describe("AdminOverrideDialog — B4/B5/B7", () => {
  beforeEach(() => vi.clearAllMocks());

  async function advanceToStep2() {
    fireEvent.click(screen.getByTestId("override-continue-button"));
    await screen.findByTestId("override-reason-input");
  }

  it("B4: reason <60 chars blocks submit, no network call", async () => {
    render(
      withProviders(
        <AdminOverrideDialog open onOpenChange={() => {}} matchId={baseChallenge.match_id} />,
      ),
    );
    await advanceToStep2();
    fireEvent.change(screen.getByTestId("override-reason-input"), { target: { value: "too short" } });
    fireEvent.click(screen.getByTestId("override-submit-button"));
    await waitFor(() =>
      expect(screen.getByTestId("override-validation-error")).toBeInTheDocument(),
    );
    expect(fetchEdgeFunction).not.toHaveBeenCalled();
  });

  it("B5: 200 closes dialog and calls match-challenges/break-glass", async () => {
    (fetchEdgeFunction as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true });
    const onOpenChange = vi.fn();
    render(
      withProviders(
        <AdminOverrideDialog open onOpenChange={onOpenChange} matchId={baseChallenge.match_id} />,
      ),
    );
    await advanceToStep2();
    fireEvent.change(screen.getByTestId("override-reason-input"), {
      target: { value: "z".repeat(80) },
    });
    fireEvent.click(screen.getByTestId("override-submit-button"));
    await waitFor(() => expect(fetchEdgeFunction).toHaveBeenCalledTimes(1));
    const [path, init] = (fetchEdgeFunction as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(path).toBe("match-challenges/break-glass");
    expect(init.body.match_id).toBe(baseChallenge.match_id);
    expect(init.body.reason.length).toBeGreaterThanOrEqual(60);
    expect(toast.success).toHaveBeenCalled();
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("B7: Cancel dismisses AdminOverrideDialog without submit", async () => {
    const onOpenChange = vi.fn();
    render(
      withProviders(
        <AdminOverrideDialog open onOpenChange={onOpenChange} matchId={baseChallenge.match_id} />,
      ),
    );
    fireEvent.click(screen.getByTestId("override-cancel-button"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(fetchEdgeFunction).not.toHaveBeenCalled();
  });
});

describe("B6: Move-to-Under-Review submits transition with no outcome fields", () => {
  beforeEach(() => vi.clearAllMocks());
  it("calls transition with to_status=under_review and no outcome_*", async () => {
    (fetchEdgeFunction as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true });
    render(
      withProviders(
        <AdminChallengeReviewDrawer
          open
          onOpenChange={() => {}}
          challenge={{ ...baseChallenge, status: "open" }}
        />,
      ),
    );
    fireEvent.click(screen.getByTestId("action-move-to-review"));
    await waitFor(() => expect(fetchEdgeFunction).toHaveBeenCalledTimes(1));
    const [path, init] = (fetchEdgeFunction as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(path).toBe("match-challenges/transition");
    expect(init.body.to_status).toBe("under_review");
    expect(init.body.outcome_code).toBeFalsy();
    expect(init.body.outcome_summary).toBeFalsy();
  });
});
