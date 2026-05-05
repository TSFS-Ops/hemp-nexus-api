import { fetchEdgeFunction } from "@/lib/edge-invoke";

export interface FinaliseMatchDocumentUploadPayload {
  match_id: string;
  document_id: string;
  storage_path: string;
  filename: string;
  file_size?: number | null;
  mime_type?: string | null;
  sha256_hash: string;
  doc_type: string;
  title?: string | null;
  notes?: string | null;
  visibility: "private" | "share_with_counterparty" | "share_with_roles";
  magic_bytes_verified?: boolean | null;
  server_detected_mime?: string | null;
  client_request_id: string;
}

export interface FinaliseMatchDocumentUploadResult {
  ok: true;
  request_id: string;
  document: {
    id: string;
    match_id: string;
    storage_path: string;
    uploader_org_id: string | null;
    created_at: string;
  };
}

export async function finaliseMatchDocumentUpload(payload: FinaliseMatchDocumentUploadPayload): Promise<FinaliseMatchDocumentUploadResult> {
  return await fetchEdgeFunction<FinaliseMatchDocumentUploadResult>("finalise-match-document-upload", {
    method: "POST",
    body: payload,
    label: "finalise document upload",
  });
}
