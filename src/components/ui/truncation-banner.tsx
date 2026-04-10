/**
 * TruncationBanner - warns users when a list query hit its row limit
 * and data may be silently incomplete.
 *
 * Usage:
 *   <TruncationBanner data={items} />
 *
 * Works with useSupabaseList (attaches __totalCount / __limit) and
 * with manual queries by passing totalCount and limit explicitly.
 */

import { AlertTriangle } from "lucide-react";

interface TruncationBannerProps {
  /** The data array (may have __totalCount / __limit from useSupabaseList) */
  data?: unknown[] | null;
  /** Override: actual total count from the server */
  totalCount?: number;
  /** Override: the limit used in the query */
  limit?: number;
}

export function TruncationBanner({ data, totalCount, limit }: TruncationBannerProps) {
  const resolvedTotal = totalCount ?? (data as any)?.__totalCount;
  const resolvedLimit = limit ?? (data as any)?.__limit;
  const rowCount = data?.length ?? 0;

  // Show if: we know the total exceeds what was returned, OR
  // if returned rows exactly equal the limit (likely truncated)
  const isTruncated =
    (resolvedTotal != null && resolvedLimit != null && resolvedTotal > resolvedLimit) ||
    (resolvedTotal == null && resolvedLimit != null && rowCount >= resolvedLimit);

  if (!isTruncated) return null;

  const displayTotal = resolvedTotal != null ? resolvedTotal.toLocaleString() : "more";

  return (
    <div className="flex items-center gap-2 rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-sm text-warning-foreground">
      <AlertTriangle className="h-4 w-4 flex-shrink-0 text-warning" />
      <span>
        Showing {rowCount.toLocaleString()} of {displayTotal} records.
        {resolvedTotal != null && resolvedLimit != null && (
          <> Use filters or pagination to see all results.</>
        )}
        {resolvedTotal == null && (
          <> Results may be incomplete — refine your query to see all data.</>
        )}
      </span>
    </div>
  );
}
