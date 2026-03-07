/**
 * Validates and sanitises returnTo parameters to prevent open redirects.
 *
 * Only allows relative paths that start with "/" and don't contain protocol
 * markers, double slashes, or other redirect tricks.
 */

const DEFAULT_DESTINATION = "/dashboard";

/**
 * Returns a safe internal path from a raw returnTo value.
 * Falls back to `fallback` (default: /dashboard) if the value is invalid.
 */
export function getSafeReturnTo(
  raw: string | null | undefined,
  fallback: string = DEFAULT_DESTINATION,
): string {
  if (!raw) return fallback;

  // Must start with exactly one slash and not be a protocol-relative URL
  if (!raw.startsWith("/") || raw.startsWith("//")) return fallback;

  // Block embedded protocols (javascript:, data:, etc.)
  if (/^\/[^/]*:/i.test(raw)) return fallback;

  // Block encoded characters that could hide redirects
  try {
    const decoded = decodeURIComponent(raw);
    if (decoded.startsWith("//") || /^\/[^/]*:/i.test(decoded)) return fallback;
  } catch {
    // Malformed encoding — reject
    return fallback;
  }

  // Block newlines and null bytes that can break HTTP headers
  if (/[\r\n\0]/.test(raw)) return fallback;

  return raw;
}
