/**
 * MatchStatusBadge - Canonical badge for match statuses.
 *
 * Replaces the repeated pattern of:
 *   <StatusBadge status={MatchState.isSettled(match.status) ? "confirmed" : match.status} />
 *
 * Centralises the settled→confirmed mapping so consumers never need to know about it.
 *
 * Batch T — UI-013: supports two optional truthfulness qualifiers that
 * are rendered as small chips alongside the canonical status badge so
 * the UI never lies about the underlying backend state:
 *   - `testMode`        — row was created/processed under a test-mode
 *                         bypass (e.g. `metadata.test_mode_bypass=true`)
 *   - `providerError`   — last provider/dispatch attempt failed (e.g.
 *                         `metadata.provider_status === "provider_error"`
 *                         or `last_status === "failed"`)
 *
 * Callers pass these explicitly, derived from row metadata; the badge
 * itself does no querying.
 *
 * Usage:
 *   <MatchStatusBadge status={match.status} />
 *   <MatchStatusBadge status={match.status} testMode providerError />
 */

import * as MatchState from "@/lib/match-state";
import { StatusBadge } from "@/components/ui/status-badge";

interface MatchStatusBadgeProps {
  status: string;
  className?: string;
  /** True when the row was produced via a test-mode bypass. */
  testMode?: boolean;
  /** True when the upstream provider/dispatch attempt failed. */
  providerError?: boolean;
}

export function MatchStatusBadge({
  status,
  className,
  testMode,
  providerError,
}: MatchStatusBadgeProps) {
  const displayStatus = MatchState.isSettled(status) ? "confirmed" : status;
  const label = MatchState.statusLabel(status);

  if (!testMode && !providerError) {
    return <StatusBadge status={displayStatus} label={label} className={className} />;
  }

  return (
    <span className="inline-flex items-center gap-1 flex-wrap">
      <StatusBadge status={displayStatus} label={label} className={className} />
      {testMode && (
        <span
          data-testid="status-badge-test-mode"
          title="This row was produced under a test-mode bypass — not real data"
          className="inline-flex items-center rounded-sm border border-amber-300 bg-amber-50 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-amber-800 dark:bg-amber-500/10 dark:text-amber-400"
        >
          TEST-MODE
        </span>
      )}
      {providerError && (
        <span
          data-testid="status-badge-provider-error"
          title="Provider/dispatch reported an error for this row"
          className="inline-flex items-center rounded-sm border border-rose-300 bg-rose-50 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-rose-800 dark:bg-rose-500/10 dark:text-rose-400"
        >
          PROVIDER-ERROR
        </span>
      )}
    </span>
  );
}
