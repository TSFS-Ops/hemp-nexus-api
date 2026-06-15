/**
 * Client helper to record a structured server-side log row for every
 * `match-documents` storage upload attempt - both successes and failures.
 *
 * The server endpoint (`match-document-upload-log`) evaluates the caller's
 * participant role(s) against the match's three org slots and writes a single
 * `audit_logs` row tagged `document.upload.attempt`. This gives operators a
 * grep-able trail with: requesting user, profile org, match id, the three
 * match org slots, the resolved participant roles, the storage path, the
 * storage status/body, the db error (if any), and a correlation id.
 *
 * Calls here are best-effort - they MUST NOT block or throw the upload UX.
 */
import { fetchEdgeFunction } from "@/lib/edge-invoke";

export type UploadLogPhase =
  | "storage_upload"
  | "db_insert"
  | "validation"
  | "success";

export type UploadLogOutcome = "success" | "failure";

export interface UploadLogPayload {
  match_id: string;
  storage_path: string;
  filename: string;
  file_size?: number;
  mime_type?: string | null;
  phase: UploadLogPhase;
  outcome: UploadLogOutcome;
  storage_status?: number | null;
  storage_error?: string | null;
  db_error?: string | null;
  client_request_id: string;
  document_id?: string | null;
}

export async function logMatchDocumentUploadAttempt(
  payload: UploadLogPayload
): Promise<void> {
  try {
    await fetchEdgeFunction("match-document-upload-log", {
      method: "POST",
      body: payload,
      label: "log match document upload",
    });
  } catch (err) {
    // Best-effort. We deliberately swallow here because the user-visible
    // upload outcome must not depend on the audit channel.
    // eslint-disable-next-line no-console
    console.warn("match-document-upload-log failed", err);
  }
}
