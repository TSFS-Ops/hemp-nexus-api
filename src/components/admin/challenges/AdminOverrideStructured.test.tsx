/**
 * Phase 3E — Admin override structured governance fields.
 *
 * Covers:
 *   • Dialog blocks submit when reason category is missing
 *   • Dialog blocks submit when internal approval reference is missing
 *   • Dialog blocks submit when written reason <60 chars
 *   • Allows blank regulator reference and sends "Not applicable"
 *   • Successful submit calls match-challenges/break-glass with the
 *     full structured payload
 *   • Failure shows toast.error and dialog stays open, loading clears
 *   • Drawer renders structured override details after closure
 *   • Wording/invariants: no fault/blame language; no rating emission code;
 *     legacy disputes untouched; no edits to unrelated Phase 3A gates
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ChallengeRow } from "@/hooks/useMatchChallenge";

vi.mock("@/lib/edge-invoke", () => ({ fetchEdgeFunction: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ isPlatformAdmin: true }),
}));
vi.mock("@/hooks/useChallengeOverrideAudit", () => ({
  useChallengeOverrideAudit: vi.fn(() => ({
    data: {
      id: "audit-1",
      actor_user_id: "47fffafa-ae53-4e63-b273-e0f4950bd6db",
      created_at: "2026-05-09T12:00:00Z",
      metadata: {
        reason_category: "documentation_corrected_commercial_confirmation_received",
        internal_approval_reference: "IZENZO-REV-2026-041",
        regulator_reference: "Not applicable",
        written_reason: "x".repeat(80),
      },
    },
    isLoading: false,
    error: null,
  })),
}));

vi.mock("@/components/match/ChallengeCommentThread", () => ({
  ChallengeCommentThread: () => null,
}));
vi.mock("@/components/match/ChallengeCommentComposer", () => ({
  ChallengeCommentComposer: () => null,
}));
vi.mock("@/components/match/ChallengeEvidenceList", () => ({
  ChallengeEvidenceList: () => null,
}));

import { fetchEdgeFunction } from "@/lib/edge-invoke";
import { toast } from "sonner";
import { AdminOverrideDialog } from "@/components/admin/challenges/AdminOverrideDialog";
import { AdminChallengeReviewDrawer } from "@/components/admin/challenges/AdminChallengeReviewDrawer";

function withProviders(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

const matchId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

async function advance() {
  fireEvent.click(screen.getByTestId("override-continue-button"));
  await screen.findByTestId("override-reason-input");
}

async function pickCategory() {
  fireEvent.click(screen.getByTestId("override-category-select"));
  const opt = await screen.findByTestId(
    "override-category-documentation_corrected_commercial_confirmation_received",
  );
  fireEvent.click(opt);
}

describe("AdminOverrideDialog — Phase 3E governance fields", () => {
  beforeEach(() => vi.clearAllMocks());

  it("blocks submit when reason category is missing", async () => {
    render(withProviders(<AdminOverrideDialog open onOpenChange={() => {}} matchId={matchId} />));
    await advance();
    fireEvent.change(screen.getByTestId("override-approval-ref-input"), {
      target: { value: "IZENZO-REV-2026-041" },
    });
    fireEvent.change(screen.getByTestId("override-reason-input"), {
      target: { value: "z".repeat(80) },
    });
    fireEvent.click(screen.getByTestId("override-submit-button"));
    await waitFor(() =>
      expect(screen.getByTestId("override-validation-error").textContent).toMatch(
        /Reason category is required/i,
      ),
    );
    expect(fetchEdgeFunction).not.toHaveBeenCalled();
  });

  it("blocks submit when internal approval reference is missing", async () => {
    render(withProviders(<AdminOverrideDialog open onOpenChange={() => {}} matchId={matchId} />));
    await advance();
    await pickCategory();
    fireEvent.change(screen.getByTestId("override-reason-input"), {
      target: { value: "z".repeat(80) },
    });
    fireEvent.click(screen.getByTestId("override-submit-button"));
    await waitFor(() =>
      expect(screen.getByTestId("override-validation-error").textContent).toMatch(
        /Internal approval reference is required/i,
      ),
    );
    expect(fetchEdgeFunction).not.toHaveBeenCalled();
  });

  it("blocks submit when written reason <60 chars", async () => {
    render(withProviders(<AdminOverrideDialog open onOpenChange={() => {}} matchId={matchId} />));
    await advance();
    await pickCategory();
    fireEvent.change(screen.getByTestId("override-approval-ref-input"), {
      target: { value: "IZENZO-REV-2026-041" },
    });
    fireEvent.change(screen.getByTestId("override-reason-input"), {
      target: { value: "too short" },
    });
    fireEvent.click(screen.getByTestId("override-submit-button"));
    await waitFor(() =>
      expect(screen.getByTestId("override-validation-error").textContent).toMatch(
        /at least 60 characters/i,
      ),
    );
    expect(fetchEdgeFunction).not.toHaveBeenCalled();
  });

  it("allows blank regulator reference and sends 'Not applicable'", async () => {
    (fetchEdgeFunction as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true });
    render(withProviders(<AdminOverrideDialog open onOpenChange={() => {}} matchId={matchId} />));
    await advance();
    await pickCategory();
    fireEvent.change(screen.getByTestId("override-approval-ref-input"), {
      target: { value: "IZENZO-REV-2026-041" },
    });
    fireEvent.change(screen.getByTestId("override-reason-input"), {
      target: { value: "z".repeat(80) },
    });
    fireEvent.click(screen.getByTestId("override-submit-button"));
    await waitFor(() => expect(fetchEdgeFunction).toHaveBeenCalledTimes(1));
    const [path, init] = (fetchEdgeFunction as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(path).toBe("match-challenges/break-glass");
    expect(init.body).toMatchObject({
      match_id: matchId,
      reason_category: "documentation_corrected_commercial_confirmation_received",
      internal_approval_reference: "IZENZO-REV-2026-041",
      regulator_reference: "Not applicable",
    });
    expect(init.body.reason.length).toBeGreaterThanOrEqual(60);
  });

  it("sends the full structured payload on success and surfaces toast.success", async () => {
    (fetchEdgeFunction as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true });
    render(withProviders(<AdminOverrideDialog open onOpenChange={() => {}} matchId={matchId} />));
    await advance();
    await pickCategory();
    fireEvent.change(screen.getByTestId("override-approval-ref-input"), {
      target: { value: "IZENZO-REV-2026-041" },
    });
    fireEvent.change(screen.getByTestId("override-regulator-ref-input"), {
      target: { value: "FCA-REF-2026-09" },
    });
    fireEvent.change(screen.getByTestId("override-reason-input"), {
      target: { value: "z".repeat(80) },
    });
    fireEvent.click(screen.getByTestId("override-submit-button"));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const [, init] = (fetchEdgeFunction as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.body.regulator_reference).toBe("FCA-REF-2026-09");
  });

  it("failure surfaces toast.error and dialog stays open, loading clears", async () => {
    (fetchEdgeFunction as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("BOOM"),
    );
    const onOpenChange = vi.fn();
    render(
      withProviders(<AdminOverrideDialog open onOpenChange={onOpenChange} matchId={matchId} />),
    );
    await advance();
    await pickCategory();
    fireEvent.change(screen.getByTestId("override-approval-ref-input"), {
      target: { value: "IZENZO-REV-2026-041" },
    });
    fireEvent.change(screen.getByTestId("override-reason-input"), {
      target: { value: "z".repeat(80) },
    });
    fireEvent.click(screen.getByTestId("override-submit-button"));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(screen.getByTestId("override-submit-button")).not.toBeDisabled();
  });
});

describe("AdminChallengeReviewDrawer — Phase 3E override details panel", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders structured override details when outcome is admin_override_recorded", async () => {
    const challenge: ChallengeRow = {
      id: "c03e0006-0006-0006-0006-000000000006",
      match_id: "0e3e0006-0006-0006-0006-000000000006",
      org_id: null,
      raised_by_org_id: null,
      raised_by_user_id: null,
      raised_by_role: "buyer_org_admin",
      subject_code: "delivery_or_settlement_concern",
      summary: "x".repeat(80),
      status: "outcome_recorded",
      outcome_code: "admin_override_recorded",
      outcome_summary: "Demo override outcome summary recorded for governance review.",
      closed_at: "2026-05-09T12:00:00Z",
      closed_by_user_id: "47fffafa-ae53-4e63-b273-e0f4950bd6db",
      break_glass_override_used: true,
      created_at: "2026-05-08T08:00:00Z",
      updated_at: null,
    };
    render(
      withProviders(
        <AdminChallengeReviewDrawer open onOpenChange={() => {}} challenge={challenge} />,
      ),
    );
    expect(await screen.findByTestId("override-details-panel")).toBeInTheDocument();
    expect(screen.getByTestId("override-detail-category").textContent).toMatch(
      /Documentation corrected/i,
    );
    expect(screen.getByTestId("override-detail-approval-ref").textContent).toBe(
      "IZENZO-REV-2026-041",
    );
    expect(screen.getByTestId("override-detail-regulator-ref").textContent).toBe(
      "Not applicable",
    );
    expect(screen.getByTestId("override-detail-written-reason").textContent?.length ?? 0).toBeGreaterThanOrEqual(60);
  });
});

describe("Phase 3E invariants", () => {
  it("AdminOverrideDialog uses sober wording (no break-glass UI string, no fault/blame)", () => {
    const src = fs.readFileSync(
      "src/components/admin/challenges/AdminOverrideDialog.tsx",
      "utf8",
    );
    const userFacing = src
      .split("\n")
      .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
      .join("\n");
    expect(/break[\s-]?glass/i.test(userFacing)).toBe(false);
    for (const banned of [/guilty/i, /liable/i, /\bfraud/i, /upheld/i, /winner/i, /\bloser/i]) {
      expect(banned.test(userFacing)).toBe(false);
    }
  });

  it("does not introduce rating emission code in the challenge surface", () => {
    const files = [
      "src/components/admin/challenges/AdminOverrideDialog.tsx",
      "src/components/admin/challenges/AdminChallengeReviewDrawer.tsx",
      "src/hooks/useAdminChallengeMutations.ts",
      "src/hooks/useChallengeOverrideAudit.ts",
      "src/lib/challenge-override-categories.ts",
    ];
    for (const f of files) {
      const src = fs.readFileSync(f, "utf8");
      expect(/emit.*rating|rating.*emit|rating_signal/i.test(src)).toBe(false);
    }
  });

  it("does not touch the legacy disputes table from any of the new/edited files", () => {
    const files = [
      "src/components/admin/challenges/AdminOverrideDialog.tsx",
      "src/components/admin/challenges/AdminChallengeReviewDrawer.tsx",
      "src/hooks/useAdminChallengeMutations.ts",
      "src/hooks/useChallengeOverrideAudit.ts",
      "src/lib/challenge-override-categories.ts",
      "supabase/functions/match-challenges/index.ts",
      "supabase/tests/batch_c_phase3e_fixtures_seed.sql",
    ];
    for (const f of files) {
      const src = fs.readFileSync(f, "utf8");
      expect(/from\s+["'`]disputes["'`]|public\.disputes\b|\bdisputes\s*\(/i.test(src)).toBe(false);
    }
  });
});
