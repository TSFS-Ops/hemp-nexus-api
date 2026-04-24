import { fetchEdgeFunction } from "@/lib/edge-invoke";

export type MatchDocumentListItem = {
  id: string;
  match_id: string;
  org_id: string;
  uploader_org_id: string | null;
  uploader_user_id: string | null;
  doc_type: string;
  filename: string;
  storage_path: string;
  sha256_hash: string;
  file_size: number | null;
  mime_type: string | null;
  status: string;
  created_at: string;
  expiry_date: string | null;
  title: string | null;
  notes: string | null;
  visibility: string;
  valid_from: string | null;
  valid_to: string | null;
  version: number;
  supersedes_document_id: string | null;
  root_document_id: string | null;
  is_current_version: boolean;
  superseded_at: string | null;
  change_notes: string | null;
  verified_at: string | null;
  verified_by: string | null;
  verification_notes: string | null;
};

type MatchDocumentsResponse = {
  success?: boolean;
  error?: string;
  message?: string;
  data?: {
    match_id: string;
    documents: MatchDocumentListItem[];
    truncated?: boolean;
    warning?: string;
  };
};

export type MatchDocumentsResult = {
  documents: MatchDocumentListItem[];
  truncated: boolean;
  warning?: string;
};

export async function listMatchDocuments(
  matchId: string,
  opts?: { order?: "asc" | "desc" }
): Promise<MatchDocumentsResult> {
  const order = opts?.order ?? "desc";

  const payload = await fetchEdgeFunction<MatchDocumentsResponse>(
    `match-documents/${matchId}`,
    {
      method: "GET",
      query: { order },
      label: "load documents",
    }
  );

  if (!payload || payload.success !== true) {
    const msg = payload?.error || payload?.message || "Failed to load documents";
    throw new Error(msg);
  }

  return {
    documents: payload.data?.documents || [],
    truncated: payload.data?.truncated || false,
    warning: payload.data?.warning,
  };
}

