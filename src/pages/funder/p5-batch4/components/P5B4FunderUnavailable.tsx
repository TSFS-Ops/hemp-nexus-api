/**
 * P-5 Batch 4 Stage 6 — funder unavailable notice.
 *
 * Used when the funder has no active release, the release has been
 * revoked, the release has expired, or the case isn't released to the
 * caller's funder org. Never reveals other funders' data or internal
 * reasons.
 */
export function P5B4FunderUnavailable({
  reason,
  message,
}: {
  reason?: string;
  message?: string;
}) {
  return (
    <div
      data-testid="p5b4-funder-unavailable"
      className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
    >
      <div className="font-medium">Released material not available</div>
      <p className="mt-1">
        {message ?? "This case has not been released to your funder organisation, or your access has expired."}
      </p>
      {reason ? (
        <p className="mt-2 text-xs text-amber-800/80">Reference: {reason}</p>
      ) : null}
    </div>
  );
}
