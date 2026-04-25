/**
 * ETag / If-None-Match conditional GET helpers.
 * ─────────────────────────────────────────────
 * Used by read-heavy GET endpoints (e.g. /wad/:wadId/attestation-ui) so that
 * clients which poll for state changes can short-circuit unchanged responses
 * with a cheap `304 Not Modified` instead of re-downloading the full body.
 *
 * Design notes:
 *   • ETags are strong validators — they are computed from a SHA-256 digest
 *     of the canonical JSON response payload. Any change to the payload
 *     (status, attestation timestamps, viewer-specific text) produces a new
 *     ETag, so clients are guaranteed correctness.
 *   • Per RFC 7232 we wrap the digest hex in double quotes. Clients echo the
 *     exact value back via `If-None-Match`. We compare verbatim and also
 *     accept the `W/"…"` weak-prefixed form for tolerant clients/proxies.
 *   • The matcher splits on commas to handle the (rare) list form
 *     (`If-None-Match: "a", "b"`) and the wildcard `*` shortcut.
 *   • Helpers are pure functions so they can be unit-tested without spinning
 *     up an HTTP server. The Response builder is a thin convenience wrapper.
 */

/** Compute a SHA-256 hex digest of a UTF-8 string. */
export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Compute a strong ETag for a JSON-serializable payload.
 * The ETag is the SHA-256 hex digest of the JSON body, wrapped in quotes.
 */
export async function computeETag(payload: unknown): Promise<string> {
  const json = JSON.stringify(payload);
  const hex = await sha256Hex(json);
  return `"${hex}"`;
}

/**
 * Returns true if the supplied `If-None-Match` header value matches the
 * server-computed ETag. Handles:
 *   • Wildcard:  `*`           → always matches when an ETag exists
 *   • List form: `"a", "b"`   → match if any token equals the etag
 *   • Weak form: `W/"abc"`    → matched against the strong etag (we treat
 *                                weak/strong as equivalent for the purpose
 *                                of conditional GETs on idempotent reads)
 */
export function ifNoneMatchMatches(
  ifNoneMatch: string | null,
  etag: string,
): boolean {
  if (!ifNoneMatch) return false;
  const trimmed = ifNoneMatch.trim();
  if (trimmed === "*") return true;

  const normalize = (token: string): string => {
    const t = token.trim();
    return t.startsWith("W/") ? t.slice(2) : t;
  };

  const target = normalize(etag);
  return trimmed
    .split(",")
    .map(normalize)
    .some((token) => token === target);
}

/**
 * Build a 304 Not Modified response with the supplied ETag and any
 * caller-provided headers (typically CORS + Cache-Control). Per RFC 7232
 * a 304 MUST NOT include a body, and SHOULD echo the validator headers
 * (ETag, Cache-Control) so the client can re-prime its cache entry.
 */
export function notModifiedResponse(
  etag: string,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(null, {
    status: 304,
    headers: {
      ...extraHeaders,
      ETag: etag,
    },
  });
}
