import { fetchEdgeFunction } from "@/lib/edge-invoke";

type MatchEvidenceCountsResponse = {
  success?: boolean;
  error?: string;
  message?: string;
  data?: {
    match_id: string;
    match_documents_count: number;
    buyer_documents_count?: number;
    seller_documents_count?: number;
    governance_documents_count: number;
    document_count: number;
    notes_count: number;
    has_supporting_evidence: boolean;
    is_unilateral?: boolean;
    min_bundle_satisfied?: boolean;
    buyer_side_satisfied?: boolean;
    seller_side_satisfied?: boolean;
    /** @deprecated waiver gate removed 2026-04-30 - always false. */
    waiver_required: boolean;
  };
};

export type MatchEvidenceCounts = {
  matchDocumentCount: number;
  buyerDocumentCount: number;
  sellerDocumentCount: number;
  governanceDocumentCount: number;
  documentCount: number;
  notesCount: number;
  hasSupportingEvidence: boolean;
  isUnilateral: boolean;
  /** True when the per-side 1-doc-per-side bundle gate is satisfied (or unilateral). */
  minBundleSatisfied: boolean;
  buyerSideSatisfied: boolean;
  sellerSideSatisfied: boolean;
  /** @deprecated retained for backwards compat with EvidenceDebugPanel; always false. */
  waiverRequired: boolean;
  /** Client-side timestamp (ISO) marking when the server response was received. */
  fetchedAt: string;
};

export async function getMatchEvidenceCounts(matchId: string): Promise<MatchEvidenceCounts> {
  const payload = await fetchEdgeFunction<MatchEvidenceCountsResponse>(
    `match-evidence-counts/${matchId}`,
    {
      method: "GET",
      label: "load supporting evidence count",
    }
  );

  if (!payload || payload.success !== true || !payload.data) {
    const msg = payload?.error || payload?.message || "Failed to load supporting evidence count";
    throw new Error(msg);
  }

  return {
    matchDocumentCount: payload.data.match_documents_count || 0,
    buyerDocumentCount: payload.data.buyer_documents_count ?? 0,
    sellerDocumentCount: payload.data.seller_documents_count ?? 0,
    governanceDocumentCount: payload.data.governance_documents_count || 0,
    documentCount: payload.data.document_count || 0,
    notesCount: payload.data.notes_count || 0,
    hasSupportingEvidence: !!payload.data.has_supporting_evidence,
    isUnilateral: !!payload.data.is_unilateral,
    minBundleSatisfied: payload.data.min_bundle_satisfied ?? !!payload.data.has_supporting_evidence,
    buyerSideSatisfied: payload.data.buyer_side_satisfied ?? true,
    sellerSideSatisfied: payload.data.seller_side_satisfied ?? true,
    waiverRequired: false,
    fetchedAt: new Date().toISOString(),
  };
}
