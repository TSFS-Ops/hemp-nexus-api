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

  // Block backslash-based redirects (browsers normalise \ to / in some contexts)
  if (raw.includes("\\")) return fallback;

  // Block embedded protocols (javascript:, data:, etc.) in raw form
  if (/[^/]*:/i.test(raw.slice(1).split("/")[0])) return fallback;

  // Decode and re-check — catches %2F%2F, %5C, encoded protocols
  try {
    // Fully decode (handles double-encoding)
    let decoded = raw;
    let prev = "";
    let iterations = 0;
    while (decoded !== prev && iterations < 5) {
      prev = decoded;
      decoded = decodeURIComponent(decoded);
      iterations++;
    }

    // After full decoding, re-apply all checks
    if (!decoded.startsWith("/") || decoded.startsWith("//")) return fallback;
    if (decoded.includes("\\")) return fallback;
    if (/[^/]*:/i.test(decoded.slice(1).split("/")[0])) return fallback;
  } catch {
    // Malformed encoding — reject
    return fallback;
  }

  // Block newlines and null bytes that can break HTTP headers
  if (/[\r\n\0]/.test(raw)) return fallback;

  return raw;
}
