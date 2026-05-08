/**
 * Batch B Phase 8.5b — ReconfirmLateAcceptanceCard UI tests.
 *
 * Pins:
 *   • Visibility: only shown to initiator org_admin (or platform_admin
 *     override) when engagement_status =
 *     `late_acceptance_pending_initiator_reconfirmation`.
 *   • Hidden from counterparty org_admin, ordinary counterparty members,
 *     unrelated orgs, and ordinary initiator members.
 *   • Platform admin override is clearly labelled.
 *   • Reconfirm calls POST /poi-engagements/:id/reconfirm.
 *   • Decline calls POST /poi-engagements/:id/decline-late-acceptance.
 *   • Success invalidates engagement queries.
 *   • F-B4 wording branch: PendingEngagementSection renders the
 *     "reconfirmation window elapsed" wording when
 *     late_acceptance_resolution = reconfirmation_window_expired.
 *   • No "auto-decline" wording anywhere.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

// ── Mocks ────────────────────────────────────────────────────────────────
const fetchEdgeFunctionMock = vi.fn();
vi.mock("@/lib/edge-invoke", () => ({
  fetchEdgeFunction: (...args: unknown[]) => fetchEdgeFunctionMock(...args),
}));

const invalidateQueriesMock = vi.fn();
vi.mock("@/lib/query-client", () => ({
  queryClient: { invalidateQueries: (...args: unknown[]) => invalidateQueriesMock(...args) },
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
const toastInfo = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
    info: (...a: unknown[]) => toastInfo(...a),
  },
}));

let mockAuth: { isOrgAdmin: boolean; isPlatformAdmin: boolean } = {
  isOrgAdmin: false,
  isPlatformAdmin: false,
};
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => mockAuth,
}));

let mockOrgId: string | null = null;
vi.mock("@/hooks/use-user-org", () => ({
  useUserOrg: () => mockOrgId,
}));

// Import after mocks.
import { ReconfirmLateAcceptanceCard } from "@/components/match/ReconfirmLateAcceptanceCard";

const INITIATOR_ORG = "00000000-0000-0000-0000-000000000001";
const COUNTERPARTY_ORG = "00000000-0000-0000-0000-000000000002";
const UNRELATED_ORG = "00000000-0000-0000-0000-000000000003";
const ENGAGEMENT_ID = "11111111-1111-1111-1111-111111111111";

const baseMatch = { id: "m-1", org_id: INITIATOR_ORG, commodity: "Copper" };
const baseEngagement = {
  id: ENGAGEMENT_ID,
  engagement_status: "late_acceptance_pending_initiator_reconfirmation" as const,
  reconfirmation_window_expires_at: "2099-01-01T00:00:00.000Z",
};

beforeEach(() => {
  fetchEdgeFunctionMock.mockReset();
  invalidateQueriesMock.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
  toastInfo.mockReset();
  mockAuth = { isOrgAdmin: false, isPlatformAdmin: false };
  mockOrgId = null;
});

describe("ReconfirmLateAcceptanceCard — visibility", () => {
  it("renders for initiator org_admin on F-B1", () => {
    mockAuth = { isOrgAdmin: true, isPlatformAdmin: false };
    mockOrgId = INITIATOR_ORG;
    render(<ReconfirmLateAcceptanceCard match={baseMatch} engagement={baseEngagement} />);
    expect(screen.getByTestId("reconfirm-late-acceptance-card")).toBeInTheDocument();
    expect(screen.getByTestId("reconfirm-late-acceptance-button")).toBeInTheDocument();
    expect(screen.getByTestId("decline-late-acceptance-button")).toBeInTheDocument();
    expect(screen.queryByTestId("platform-admin-override-badge")).toBeNull();
  });

  it("hides for counterparty org_admin", () => {
    mockAuth = { isOrgAdmin: true, isPlatformAdmin: false };
    mockOrgId = COUNTERPARTY_ORG;
    const { container } = render(
      <ReconfirmLateAcceptanceCard match={baseMatch} engagement={baseEngagement} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("hides for ordinary counterparty member", () => {
    mockAuth = { isOrgAdmin: false, isPlatformAdmin: false };
    mockOrgId = COUNTERPARTY_ORG;
    const { container } = render(
      <ReconfirmLateAcceptanceCard match={baseMatch} engagement={baseEngagement} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("hides for unrelated org", () => {
    mockAuth = { isOrgAdmin: true, isPlatformAdmin: false };
    mockOrgId = UNRELATED_ORG;
    const { container } = render(
      <ReconfirmLateAcceptanceCard match={baseMatch} engagement={baseEngagement} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("hides for ordinary initiator member (no org_admin)", () => {
    mockAuth = { isOrgAdmin: false, isPlatformAdmin: false };
    mockOrgId = INITIATOR_ORG;
    const { container } = render(
      <ReconfirmLateAcceptanceCard match={baseMatch} engagement={baseEngagement} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("hides for any other engagement status", () => {
    mockAuth = { isOrgAdmin: true, isPlatformAdmin: false };
    mockOrgId = INITIATOR_ORG;
    const { container } = render(
      <ReconfirmLateAcceptanceCard
        match={baseMatch}
        engagement={{ ...baseEngagement, engagement_status: "expired" }}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders for platform_admin override with explicit badge", () => {
    mockAuth = { isOrgAdmin: true, isPlatformAdmin: true };
    mockOrgId = UNRELATED_ORG; // not on initiating org
    render(<ReconfirmLateAcceptanceCard match={baseMatch} engagement={baseEngagement} />);
    expect(screen.getByTestId("reconfirm-late-acceptance-card")).toBeInTheDocument();
    expect(screen.getByTestId("platform-admin-override-badge")).toBeInTheDocument();
  });
});

describe("ReconfirmLateAcceptanceCard — route wiring", () => {
  beforeEach(() => {
    mockAuth = { isOrgAdmin: true, isPlatformAdmin: false };
    mockOrgId = INITIATOR_ORG;
  });

  it("Reconfirm calls POST /poi-engagements/:id/reconfirm and invalidates queries", async () => {
    fetchEdgeFunctionMock.mockResolvedValueOnce({});
    render(<ReconfirmLateAcceptanceCard match={baseMatch} engagement={baseEngagement} />);
    fireEvent.click(screen.getByTestId("reconfirm-late-acceptance-button"));
    fireEvent.click(screen.getByTestId("reconfirm-dialog-confirm"));
    await waitFor(() => {
      expect(fetchEdgeFunctionMock).toHaveBeenCalledWith(
        `poi-engagements/${ENGAGEMENT_ID}/reconfirm`,
        expect.objectContaining({ method: "POST" }),
      );
    });
    expect(invalidateQueriesMock).toHaveBeenCalledWith({ queryKey: ["engagement-status-gate"] });
    expect(invalidateQueriesMock).toHaveBeenCalledWith({ queryKey: ["engagement-tracker"] });
    expect(toastSuccess).toHaveBeenCalled();
  });

  it("Decline calls POST /poi-engagements/:id/decline-late-acceptance after confirmation", async () => {
    fetchEdgeFunctionMock.mockResolvedValueOnce({});
    render(<ReconfirmLateAcceptanceCard match={baseMatch} engagement={baseEngagement} />);
    fireEvent.click(screen.getByTestId("decline-late-acceptance-button"));
    fireEvent.click(screen.getByTestId("reconfirm-dialog-confirm"));
    await waitFor(() => {
      expect(fetchEdgeFunctionMock).toHaveBeenCalledWith(
        `poi-engagements/${ENGAGEMENT_ID}/decline-late-acceptance`,
        expect.objectContaining({ method: "POST" }),
      );
    });
    expect(invalidateQueriesMock).toHaveBeenCalled();
    expect(toastInfo).toHaveBeenCalled();
  });

  it("Decline shows confirmation dialog before firing the request", async () => {
    render(<ReconfirmLateAcceptanceCard match={baseMatch} engagement={baseEngagement} />);
    fireEvent.click(screen.getByTestId("decline-late-acceptance-button"));
    expect(screen.getByTestId("reconfirm-dialog-cancel")).toBeInTheDocument();
    expect(fetchEdgeFunctionMock).not.toHaveBeenCalled();
  });

  it("uses humanised error toast on failure", async () => {
    fetchEdgeFunctionMock.mockRejectedValueOnce(new Error("INVALID_TRANSITION"));
    render(<ReconfirmLateAcceptanceCard match={baseMatch} engagement={baseEngagement} />);
    fireEvent.click(screen.getByTestId("reconfirm-late-acceptance-button"));
    await act(async () => {
      fireEvent.click(screen.getByTestId("reconfirm-dialog-confirm"));
    });
    await waitFor(() => expect(toastError).toHaveBeenCalled());
  });
});

describe("ReconfirmLateAcceptanceCard — wording safety", () => {
  it("never uses 'auto-decline' or 'mutual'/'binding'/'final'/'sealed' wording", () => {
    mockAuth = { isOrgAdmin: true, isPlatformAdmin: false };
    mockOrgId = INITIATOR_ORG;
    const { container } = render(
      <ReconfirmLateAcceptanceCard match={baseMatch} engagement={baseEngagement} />,
    );
    fireEvent.click(screen.getByTestId("decline-late-acceptance-button"));
    const text = (container.textContent || "") + " " + (document.body.textContent || "");
    expect(text).not.toMatch(/auto[-\s_]?decline/i);
    expect(text).not.toMatch(/mutually\s+(accepted|binding|agreed)/i);
    expect(text).not.toMatch(/\bbinding\b/i);
    expect(text).not.toMatch(/\bdeal\s+is\s+(final|sealed|settled|executed|complete)\b/i);
  });
});

// ── F-B4 wording branch in PendingEngagementSection ──────────────────────
import { PendingEngagementSection } from "@/components/match/PendingEngagementSection";

describe("PendingEngagementSection — F-B4 expired-window wording branch", () => {
  it("renders 'reconfirmation window elapsed' wording for reconfirmation_window_expired", () => {
    const engagement = {
      id: ENGAGEMENT_ID,
      engagement_status: "expired" as const,
      counterparty_type: "named_individual",
      counterparty_email: "x@example.com",
      counterparty_org_id: null,
      counterparty_response: "accepted_after_expiry",
      late_acceptance_recorded_at: "2026-04-01T00:00:00Z",
      late_acceptance_resolution: "reconfirmation_window_expired",
    };
    render(
      <PendingEngagementSection
        engagement={engagement as any}
        match={{ buyer_name: "Acme", seller_name: null, buyer_org_id: null, seller_org_id: null }}
        isInitiator
      />,
    );
    const txt = document.body.textContent || "";
    // Resolution copy must surface.
    expect(txt).toMatch(/did not reconfirm/i);
    expect(txt).toMatch(/late acceptance remains recorded/i);
    expect(txt).toMatch(/original engagement remains expired/i);
    // Active "awaiting initiator reconfirmation" wording must NOT appear.
    expect(txt).not.toMatch(/awaiting initiator reconfirmation/i);
    // Banned wording.
    expect(txt).not.toMatch(/auto[-\s_]?decline/i);
  });

  it("renders 'initiator declined' wording for initiator_declined_renewal", () => {
    const engagement = {
      id: ENGAGEMENT_ID,
      engagement_status: "expired" as const,
      counterparty_type: "named_individual",
      counterparty_email: "x@example.com",
      counterparty_org_id: null,
      counterparty_response: "accepted_after_expiry",
      late_acceptance_recorded_at: "2026-04-01T00:00:00Z",
      late_acceptance_resolution: "initiator_declined_renewal",
    };
    render(
      <PendingEngagementSection
        engagement={engagement as any}
        match={{ buyer_name: "Acme", seller_name: null, buyer_org_id: null, seller_org_id: null }}
        isInitiator
      />,
    );
    const txt = document.body.textContent || "";
    expect(txt).toMatch(/initiator declined/i);
    expect(txt).not.toMatch(/auto[-\s_]?decline/i);
  });

  it("renders 'renewed engagement created' wording for renewed_engagement_created", () => {
    const engagement = {
      id: ENGAGEMENT_ID,
      engagement_status: "expired" as const,
      counterparty_type: "named_individual",
      counterparty_email: "x@example.com",
      counterparty_org_id: null,
      counterparty_response: "accepted_after_expiry",
      late_acceptance_recorded_at: "2026-04-01T00:00:00Z",
      late_acceptance_resolution: "renewed_engagement_created",
      renewed_engagement_id: "22222222-2222-2222-2222-222222222222",
    };
    render(
      <PendingEngagementSection
        engagement={engagement as any}
        match={{ buyer_name: "Acme", seller_name: null, buyer_org_id: null, seller_org_id: null }}
        isInitiator
      />,
    );
    const txt = document.body.textContent || "";
    expect(txt).toMatch(/renewed engagement/i);
    expect(txt).not.toMatch(/auto[-\s_]?decline/i);
  });
});
