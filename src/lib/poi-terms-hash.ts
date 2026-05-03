/**
 * D-02: POI terms-drift protection.
 *
 * Computes a deterministic SHA-256 fingerprint of the canonical commercial
 * terms on a match. Client and server MUST produce the identical hash for
 * the same row, or the server will reject mint with TERMS_DRIFT.
 *
 * Algorithm — MUST mirror public.compute_match_terms_hash() in PG:
 *   1. Read 15 canonical fields from the match (alphabetical key order).
 *   2. For each field render `key=value`. Empty/null = '' after the '='.
 *      String values are trimmed; numbers go through Number→String which
 *      strips trailing zeros (matches numeric→text in Postgres).
 *   3. Join the pairs with '|'.
 *   4. SHA-256 the UTF-8 bytes; lowercase hex output.
 *
 * Canonical field set (do not change without updating both sides):
 *   buyer_id, buyer_name, buyer_org_id, commodity, destination_country,
 *   match_type, origin_country, price_amount, price_currency,
 *   quantity_amount, quantity_unit, seller_id, seller_name, seller_org_id,
 *   terms
 */

export interface CanonicalTermsInput {
  buyer_id?: string | null;
  buyer_name?: string | null;
  buyer_org_id?: string | null;
  commodity?: string | null;
  destination_country?: string | null;
  match_type?: string | null;
  origin_country?: string | null;
  price_amount?: number | string | null;
  price_currency?: string | null;
  quantity_amount?: number | string | null;
  quantity_unit?: string | null;
  seller_id?: string | null;
  seller_name?: string | null;
  seller_org_id?: string | null;
  terms?: string | null;
}

/** Order matters — alphabetical, matches the SQL helper. */
const CANONICAL_KEYS: ReadonlyArray<keyof CanonicalTermsInput> = [
  "buyer_id",
  "buyer_name",
  "buyer_org_id",
  "commodity",
  "destination_country",
  "match_type",
  "origin_country",
  "price_amount",
  "price_currency",
  "quantity_amount",
  "quantity_unit",
  "seller_id",
  "seller_name",
  "seller_org_id",
  "terms",
];

const NUMERIC_KEYS = new Set<keyof CanonicalTermsInput>([
  "price_amount",
  "quantity_amount",
]);

function renderValue(key: keyof CanonicalTermsInput, value: unknown): string {
  if (value === null || value === undefined) return "";
  if (NUMERIC_KEYS.has(key)) {
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(n)) return "";
    // Number→String strips trailing zeros: 100.00 → "100", matching
    // Postgres numeric::text behaviour for canonicalised numerics.
    return String(n);
  }
  return String(value).trim();
}

export function buildCanonicalTermsString(input: CanonicalTermsInput): string {
  return CANONICAL_KEYS
    .map((k) => `${k}=${renderValue(k, input[k])}`)
    .join("|");
}

/** Browser SHA-256 hex via SubtleCrypto. */
export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Compute the canonical terms_hash for a match row (client side). */
export async function computeMatchTermsHash(
  input: CanonicalTermsInput,
): Promise<string> {
  return sha256Hex(buildCanonicalTermsString(input));
}
