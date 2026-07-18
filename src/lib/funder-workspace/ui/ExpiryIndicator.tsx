import { formatDate, relativeFromNow } from "./labels";

const DAY = 24 * 60 * 60 * 1000;

interface Props {
  expiresAt: string | null | undefined;
  now?: number;
  /** When true, omit the parenthetical relative text on very small displays. */
  compact?: boolean;
}

/**
 * Renders an expiry as `12 Jul 2026 · in 5 days` with colour cue for
 * <= 14 days (amber) and <= 0 (destructive). Passive info, not a badge.
 */
export function ExpiryIndicator({ expiresAt, now = Date.now(), compact }: Props) {
  if (!expiresAt) return <span className="text-muted-foreground">—</span>;
  const t = Date.parse(expiresAt);
  if (!Number.isFinite(t)) return <span className="text-muted-foreground">—</span>;
  const remaining = t - now;
  let cls = "text-foreground";
  if (remaining <= 0) cls = "text-destructive font-medium";
  else if (remaining <= 14 * DAY) cls = "text-amber-600 dark:text-amber-500 font-medium";
  const date = formatDate(expiresAt);
  const rel = relativeFromNow(expiresAt, now);
  return (
    <span className={cls}>
      {date}
      {!compact && <span className="text-muted-foreground"> · {rel}</span>}
    </span>
  );
}
