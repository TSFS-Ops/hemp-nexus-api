/**
 * Real cryptographic primitives used across the client.
 *
 * Backed by the Web Crypto API (window.crypto.subtle). This is the canonical
 * SHA-256 utility for the UI — never re-introduce mock hash helpers.
 */

/** Compute the SHA-256 digest of a UTF-8 string and return lowercase hex. */
export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Compute the SHA-256 digest of a File/Blob and return lowercase hex. */
export async function sha256HexOfBlob(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Build a deterministic, canonical payload string for hashing commercial terms. */
export function canonicalTermsPayload(terms: Record<string, unknown>): string {
  const keys = Object.keys(terms).sort();
  const normalised: Record<string, unknown> = {};
  for (const k of keys) {
    const v = terms[k];
    normalised[k] = v == null ? "" : typeof v === "string" ? v.trim() : v;
  }
  return JSON.stringify(normalised);
}

/** Truncate a hex hash for compact display: `aaaaaaaaaa…bbbbbbbbbb`. */
export function shortHash(hex: string, head = 10, tail = 10): string {
  if (!hex) return "";
  if (hex.length <= head + tail + 1) return hex;
  return `${hex.slice(0, head)}…${hex.slice(-tail)}`;
}
