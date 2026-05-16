/**
 * upload-cleanup-on-failure — Batch E SEC-012 / WEB-008 helper
 *
 * After a storage upload SUCCEEDED but the follow-up DB / finaliser call
 * FAILED — including because the auth session died (REFRESH_FAILED,
 * NO_SESSION, UNAUTHORIZED) — we must not leave the storage object
 * dangling until the 24 h sweeper.
 *
 * Strategy (best-effort, never throws):
 *   1. Try a direct `storage.remove()` using whatever session credentials
 *      are still cached in supabase-js memory. The user uploaded the file
 *      moments ago, so the RLS DELETE policy will accept the same token.
 *   2. If that fails (e.g. token already wiped, RLS denial, network
 *      blip), POST the path to `enqueue-storage-cleanup`. That endpoint
 *      runs unauthenticated and schedules the path in
 *      `storage_deletion_queue` for the next sweeper pass (~5 minutes).
 *
 * Callers should `await` this in the upload error path but MUST NOT
 * re-throw — the user-visible error is the upload failure itself.
 */
import { supabase } from "@/integrations/supabase/client";

const ALLOWED_BUCKETS = ["match-documents", "match-challenge-evidence", "kyc-documents"] as const;
export type CleanupBucket = (typeof ALLOWED_BUCKETS)[number];

const SUPABASE_URL = (import.meta as unknown as { env: Record<string, string> }).env
  ?.VITE_SUPABASE_URL ?? "";

export async function cleanupOrphanUpload(
  bucket: CleanupBucket,
  filePath: string,
  reason: string,
): Promise<{ removed: boolean; enqueued: boolean; error?: string }> {
  if (!ALLOWED_BUCKETS.includes(bucket)) {
    return { removed: false, enqueued: false, error: "bucket_not_allowlisted" };
  }
  try {
    const { error } = await supabase.storage.from(bucket).remove([filePath]);
    if (!error) return { removed: true, enqueued: false };
  } catch { /* fall through to enqueue */ }

  // Direct delete failed (likely session dead). Schedule async cleanup
  // via an unauthenticated endpoint that only accepts true orphans.
  try {
    const url = `${SUPABASE_URL}/functions/v1/enqueue-storage-cleanup`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bucket, file_path: filePath, reason: reason.slice(0, 120) }),
    });
    if (resp.ok) return { removed: false, enqueued: true };
    return { removed: false, enqueued: false, error: `enqueue_status_${resp.status}` };
  } catch (e) {
    return { removed: false, enqueued: false, error: (e as Error).message };
  }
}

/**
 * Returns true if the error from a finaliser call looks like a dead-session
 * code (REFRESH_FAILED / NO_SESSION / UNAUTHORIZED) raised by edge-invoke.
 */
export function isSessionDeadError(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  if (code === "REFRESH_FAILED" || code === "NO_SESSION" || code === "UNAUTHORIZED") return true;
  const status = (err as { status?: number })?.status;
  return status === 401;
}
