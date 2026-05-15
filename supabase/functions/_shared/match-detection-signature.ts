/**
 * Batch O Phase 2b Step 2 — deterministic detection signature helper.
 *
 * Pure, no I/O, no DB. Computes a stable signature string from a match id
 * plus its inconsistency reason set so the future detection-emit RPC can
 * de-duplicate `match.legacy_state_reconciliation_required` audit rows
 * via the unique `(match_id, signature)` constraint on
 * `public.match_legacy_detection_emits`.
 *
 * Server-only by design: only the future SECURITY DEFINER RPC / edge
 * function will write detection-emit rows, so the client never needs to
 * compute this. Kept under `supabase/functions/_shared/` for that reason.
 * If a UI surface ever needs to display the signature (it should not) we
 * can mirror it into `src/lib/` and add it to the lifecycle mirror block.
 *
 * Determinism rules:
 *   • Reasons are de-duplicated and sorted lexicographically before hashing,
 *     so callers MAY pass them in any order.
 *   • Empty reason set → fixed sentinel `"none"` segment so we never produce
 *     a collision-prone empty signature.
 *   • Output shape: `v1:<matchId>:<sortedReasonsJoinedByComma>`. Versioned
 *     so we can evolve the algorithm without silently colliding with
 *     historic rows.
 */

export const DETECTION_SIGNATURE_VERSION = "v1" as const;

export function computeDetectionSignature(
  matchId: string,
  reasons: ReadonlyArray<string>,
): string {
  if (!matchId || typeof matchId !== "string") {
    throw new Error("computeDetectionSignature: matchId is required");
  }
  const cleaned = Array.from(
    new Set(
      (reasons ?? [])
        .filter((r): r is string => typeof r === "string" && r.length > 0),
    ),
  ).sort();
  const segment = cleaned.length === 0 ? "none" : cleaned.join(",");
  return `${DETECTION_SIGNATURE_VERSION}:${matchId}:${segment}`;
}
