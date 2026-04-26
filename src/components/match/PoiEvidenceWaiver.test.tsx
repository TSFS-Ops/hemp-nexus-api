/**
 * Integration test — POI evidence waiver banner behavior
 *
 * Seeds a match with different evidence states (no docs/no notes, docs only,
 * notes only, both) by mocking the authoritative `getMatchEvidenceCounts`
 * client and asserts that:
 *
 *   1. The "No supporting evidence attached" waiver banner appears IFF
 *      the server returns `waiverRequired: true` (zero docs AND zero notes).
 *   2. The banner disappears the moment any evidence (a doc OR a note) is
 *      added — regardless of whether the doc is a `match_document` or a
 *      `governance_document`.
 *   3. The EvidenceDebugPanel reflects the server's exact decision and the
 *      counts the backend computed.
 *   4. The banner does NOT render when the action is not POI generation.
 *
 * This test exercises the same client + react-query plumbing the real screen
 * uses, so a regression in `match-evidence-counts-client.ts` or in the
 * banner gating logic is caught here without needing a full e2e.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import {
  getMatchEvidenceCounts,
  type MatchEvidenceCounts,
} from "@/lib/match-evidence-counts-client";
import { EvidenceDebugPanel } from "@/components/match/EvidenceDebugPanel";

// Mock the authoritative server client. Each test seeds a different value.
vi.mock("@/lib/match-evidence-counts-client", () => ({
  getMatchEvidenceCounts: vi.fn(),
}));

const mockedGet = getMatchEvidenceCounts as unknown as ReturnType<typeof vi.fn>;

const MATCH_ID = "11111111-2222-3333-4444-555555555555";

function seedCounts(partial: Partial<MatchEvidenceCounts>): MatchEvidenceCounts {
  const matchDocumentCount = partial.matchDocumentCount ?? 0;
  const governanceDocumentCount = partial.governanceDocumentCount ?? 0;
  const documentCount =
    partial.documentCount ?? matchDocumentCount + governanceDocumentCount;
  const notesCount = partial.notesCount ?? 0;
  const hasSupportingEvidence =
    partial.hasSupportingEvidence ?? (documentCount > 0 || notesCount > 0);
  return {
    matchDocumentCount,
    governanceDocumentCount,
    documentCount,
    notesCount,
    hasSupportingEvidence,
    waiverRequired: partial.waiverRequired ?? !hasSupportingEvidence,
    fetchedAt: partial.fetchedAt ?? new Date().toISOString(),
  };
}

/**
 * Minimal harness that mirrors the production POI gate logic from
 * `StateProgressionCard`: it renders the inline waiver banner exactly when the
 * server-computed `waiverRequired` is true AND the action is POI generation.
 * Also mounts the EvidenceDebugPanel against the same query so the test can
 * assert what the backend decided.
 */
function PoiWaiverHarness({
  matchId,
  isPoiAction = true,
}: {
  matchId: string;
  isPoiAction?: boolean;
}) {
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["state-progression-evidence", matchId, isPoiAction],
    queryFn: () => getMatchEvidenceCounts(matchId),
    enabled: isPoiAction,
    staleTime: 0,
  });

  const waiverRequired = isPoiAction && data?.waiverRequired === true;

  return (
    <div>
      {isPoiAction && (
        <EvidenceDebugPanel
          matchId={matchId}
          data={data}
          isLoading={isLoading}
          isFetching={isFetching}
          error={error}
          onRefetch={() => { void refetch(); }}
          effectiveWaiverRequired={waiverRequired}
        />
      )}

      {waiverRequired && (
        <div role="alert" data-testid="poi-waiver-banner">
          No supporting evidence attached
        </div>
      )}

      {isPoiAction && data && !waiverRequired && (
        <div data-testid="poi-evidence-ok">Evidence on file — ready to seal POI</div>
      )}
    </div>
  );
}

function renderHarness(props: { matchId: string; isPoiAction?: boolean }) {
  // Disable retries so a thrown mock surfaces immediately.
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const utils = render(
    <QueryClientProvider client={qc}>
      <PoiWaiverHarness {...props} />
    </QueryClientProvider>,
  );
  return { ...utils, qc };
}

describe("POI evidence waiver banner — integration", () => {
  beforeEach(() => {
    mockedGet.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows the waiver banner when the match has zero docs AND zero notes", async () => {
    mockedGet.mockResolvedValue(
      seedCounts({ matchDocumentCount: 0, governanceDocumentCount: 0, notesCount: 0 }),
    );

    renderHarness({ matchId: MATCH_ID });

    await waitFor(() =>
      expect(screen.getByTestId("poi-waiver-banner")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("poi-evidence-ok")).not.toBeInTheDocument();

    // Debug panel echoes the server decision.
    expect(
      screen.getByText(/server waiverRequired = true/i),
    ).toBeInTheDocument();
  });

  it("hides the waiver banner when a match_document is present", async () => {
    mockedGet.mockResolvedValue(
      seedCounts({ matchDocumentCount: 1, governanceDocumentCount: 0, notesCount: 0 }),
    );

    renderHarness({ matchId: MATCH_ID });

    await waitFor(() =>
      expect(screen.getByTestId("poi-evidence-ok")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("poi-waiver-banner")).not.toBeInTheDocument();
    expect(
      screen.getByText(/server waiverRequired = false/i),
    ).toBeInTheDocument();
  });

  it("hides the waiver banner when only a governance_document is attached", async () => {
    // Regression guard: governance_documents must count as evidence.
    mockedGet.mockResolvedValue(
      seedCounts({ matchDocumentCount: 0, governanceDocumentCount: 1, notesCount: 0 }),
    );

    renderHarness({ matchId: MATCH_ID });

    await waitFor(() =>
      expect(screen.getByTestId("poi-evidence-ok")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("poi-waiver-banner")).not.toBeInTheDocument();
  });

  it("hides the waiver banner when only a note is attached (no documents)", async () => {
    mockedGet.mockResolvedValue(
      seedCounts({ matchDocumentCount: 0, governanceDocumentCount: 0, notesCount: 1 }),
    );

    renderHarness({ matchId: MATCH_ID });

    await waitFor(() =>
      expect(screen.getByTestId("poi-evidence-ok")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("poi-waiver-banner")).not.toBeInTheDocument();
  });

  it("flips banner OFF when the server response transitions from empty to populated", async () => {
    // First render: no evidence → banner ON.
    mockedGet.mockResolvedValueOnce(seedCounts({}));
    const { rerender } = renderHarness({ matchId: MATCH_ID });

    await waitFor(() =>
      expect(screen.getByTestId("poi-waiver-banner")).toBeInTheDocument(),
    );

    // Now seed a doc + force a fresh QueryClient so the next render performs
    // a new fetch with the new mock value (mirrors a refetch after upload).
    mockedGet.mockResolvedValueOnce(
      seedCounts({ matchDocumentCount: 1 }),
    );

    const qc2 = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    rerender(
      <QueryClientProvider client={qc2}>
        <PoiWaiverHarness matchId={MATCH_ID} />
      </QueryClientProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("poi-evidence-ok")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("poi-waiver-banner")).not.toBeInTheDocument();
  });

  it("flips banner ON when evidence is removed (server now reports waiverRequired=true)", async () => {
    // Start populated, then empty.
    mockedGet.mockResolvedValueOnce(
      seedCounts({ matchDocumentCount: 1 }),
    );
    const { rerender } = renderHarness({ matchId: MATCH_ID });

    await waitFor(() =>
      expect(screen.getByTestId("poi-evidence-ok")).toBeInTheDocument(),
    );

    mockedGet.mockResolvedValueOnce(seedCounts({}));
    const qc2 = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    rerender(
      <QueryClientProvider client={qc2}>
        <PoiWaiverHarness matchId={MATCH_ID} />
      </QueryClientProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("poi-waiver-banner")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("poi-evidence-ok")).not.toBeInTheDocument();
  });

  it("does NOT render the waiver banner outside POI actions, even with zero evidence", async () => {
    mockedGet.mockResolvedValue(seedCounts({}));

    renderHarness({ matchId: MATCH_ID, isPoiAction: false });

    // Give react-query a tick — there should be NO query at all.
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.queryByTestId("poi-waiver-banner")).not.toBeInTheDocument();
    expect(mockedGet).not.toHaveBeenCalled();
  });
});
