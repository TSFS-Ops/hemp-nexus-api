/**
 * Centralized formatting utilities.
 *
 * Replaces the duplicated formatDate / formatRelativeTime / formatLastActivity
 * helpers scattered across ConsoleOverview, ApiKeysSection, MatchesList, etc.
 */

/**
 * Format a date string to a locale date (e.g. "3/6/2026").
 * Returns "Never" for null/undefined.
 */
export function formatDate(dateString: string | null | undefined): string {
  if (!dateString) return "Never";
  return new Date(dateString).toLocaleDateString();
}

/**
 * Format a date string to a locale date+time.
 */
export function formatDateTime(dateString: string | null | undefined): string {
  if (!dateString) return "Never";
  return new Date(dateString).toLocaleString();
}

/**
 * Human-readable relative time: "Just now", "5m ago", "3h ago", "2d ago".
 * Returns fallback for null input.
 */
export function formatRelativeTime(
  timestamp: string | null | undefined,
  fallback = "No activity yet"
): string {
  if (!timestamp) return fallback;

  const diffMs = Date.now() - new Date(timestamp).getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

