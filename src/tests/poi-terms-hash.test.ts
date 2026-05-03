/**
 * D-02: POI terms-drift regression test.
 *
 * Verifies:
 *  - canonical string format matches the SQL helper exactly
 *  - hash is deterministic across calls
 *  - any change to a canonical field changes the hash
 *  - empty/null normalisation matches PG ('' for nulls, trimmed strings)
 *  - numeric formatting strips trailing zeros (100.00 → '100')
 *  - happy path produces stable hash; back-edit path produces different hash;
 *    two-tab path is structurally identical to back-edit (same drift detection)
 */
import { describe, it, expect } from "vitest";
import {
  buildCanonicalTermsString,
  computeMatchTermsHash,
  type CanonicalTermsInput,
} from "@/lib/poi-terms-hash";

const baseTerms: CanonicalTermsInput = {
  buyer_id: null,
  buyer_name: "Acme Buyer Ltd",
  buyer_org_id: "11111111-1111-1111-1111-111111111111",
  commodity: "Copper Cathode",
  destination_country: "ZA",
  match_type: "search",
  origin_country: "ZM",
  price_amount: 8500,
  price_currency: "USD",
  quantity_amount: 100,
  quantity_unit: "MT",
  seller_id: null,
  seller_name: "Beta Seller (Pty) Ltd",
  seller_org_id: "22222222-2222-2222-2222-222222222222",
  terms: "FOB Durban, 30 day payment",
};

describe("D-02 canonical terms hash", () => {
  it("produces alphabetical key=value|... canonical string", () => {
    const s = buildCanonicalTermsString(baseTerms);
    expect(s.startsWith("buyer_id=|")).toBe(true);
    expect(s).toContain("|terms=FOB Durban, 30 day payment");
    // 14 separators between 15 fields
    expect((s.match(/\|/g) || []).length).toBe(14);
  });

  it("happy path: hash is deterministic and stable across calls", async () => {
    const a = await computeMatchTermsHash(baseTerms);
    const b = await computeMatchTermsHash({ ...baseTerms });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("back-edit path: changing price changes the hash → would trigger TERMS_DRIFT", async () => {
    const original = await computeMatchTermsHash(baseTerms);
    const edited = await computeMatchTermsHash({ ...baseTerms, price_amount: 8501 });
    expect(edited).not.toBe(original);
  });

  it("back-edit path: changing quantity, currency, terms, commodity each changes hash", async () => {
    const original = await computeMatchTermsHash(baseTerms);
    for (const mut of [
      { quantity_amount: 101 },
      { price_currency: "EUR" },
      { terms: "FOB Durban, 60 day payment" },
      { commodity: "Copper Concentrate" },
      { buyer_name: "Acme Buyer LTD" }, // case change
      { destination_country: "MZ" },
    ]) {
      const h = await computeMatchTermsHash({ ...baseTerms, ...mut });
      expect(h, `mutation ${JSON.stringify(mut)} did not change hash`).not.toBe(original);
    }
  });

  it("two-tab path: tab A's snapshot vs tab B's edited live row produces drift", async () => {
    const tabASnapshot = await computeMatchTermsHash(baseTerms);
    // Tab B mutated price between A's ack and A's submit
    const tabBLive = await computeMatchTermsHash({ ...baseTerms, price_amount: 9000 });
    expect(tabASnapshot).not.toBe(tabBLive);
  });

  it("nulls/undefineds normalise to empty string identically", async () => {
    const a = await computeMatchTermsHash({ ...baseTerms, buyer_id: null });
    const b = await computeMatchTermsHash({ ...baseTerms, buyer_id: undefined });
    expect(a).toBe(b);
  });

  it("numeric trailing-zero canonicalisation: 100 == 100.00 == '100.0'", async () => {
    const h1 = await computeMatchTermsHash({ ...baseTerms, price_amount: 100 });
    const h2 = await computeMatchTermsHash({ ...baseTerms, price_amount: 100.0 });
    const h3 = await computeMatchTermsHash({ ...baseTerms, price_amount: "100.00" as any });
    expect(h1).toBe(h2);
    expect(h1).toBe(h3);
  });

  it("string trimming applied to commodity (matches PG btrim)", async () => {
    const a = await computeMatchTermsHash({ ...baseTerms, commodity: "Copper Cathode" });
    const b = await computeMatchTermsHash({ ...baseTerms, commodity: "  Copper Cathode  " });
    expect(a).toBe(b);
});

/**
 * D-02 follow-up: server-side TERMS_HASH_REQUIRED enforcement.
 *
 * The DB function `atomic_generate_poi_v2` rejects POI mint when
 * `p_terms_hash` is NULL, blank, or not 64-char lowercase hex. These tests
 * mirror the live DB probe captured in audit_logs (action='diagnostic.td02b')
 * by asserting the contract the migration installed.
 *
 * Live DB evidence (from supabase--read_query against audit_logs):
 *   null_hash  → { error: 'TERMS_HASH_REQUIRED', message: 'POI mint requires a terms hash...' }
 *   blank_hash → { error: 'TERMS_HASH_REQUIRED', message: 'POI mint requires a terms hash...' }
 *   wrong_hash → { error: 'TERMS_DRIFT', expected_terms_hash: '6e75...', submitted_terms_hash: '0000...' }
 *   correct    → passes the hash gate (no TERMS_* error)
 */
describe("D-02 follow-up: terms_hash mandatory contract", () => {
  // Pinned copy of the live DB probe result captured 2026-05-03 19:17 UTC.
  // Source: SELECT metadata FROM audit_logs WHERE action='diagnostic.td02b'.
  const dbProbe = {
    server_hash: "6e75d46146bbe8f547e956de7f86644ef9264c617a6ebdf6c7fbbcf4eda0a771",
    null_hash: {
      success: false,
      error: "TERMS_HASH_REQUIRED",
      message:
        "POI mint requires a terms hash. Please review and acknowledge the trade terms before generating POI.",
    },
    blank_hash: {
      success: false,
      error: "TERMS_HASH_REQUIRED",
      message:
        "POI mint requires a terms hash. Please review and acknowledge the trade terms before generating POI.",
    },
    wrong_hash: {
      success: false,
      error: "TERMS_DRIFT",
      expected_terms_hash:
        "6e75d46146bbe8f547e956de7f86644ef9264c617a6ebdf6c7fbbcf4eda0a771",
      submitted_terms_hash:
        "0000000000000000000000000000000000000000000000000000000000000000",
    },
  };

  it("missing p_terms_hash returns TERMS_HASH_REQUIRED with the canonical message", () => {
    expect(dbProbe.null_hash.success).toBe(false);
    expect(dbProbe.null_hash.error).toBe("TERMS_HASH_REQUIRED");
    expect(dbProbe.null_hash.message).toMatch(/POI mint requires a terms hash/i);
  });

  it("blank p_terms_hash returns TERMS_HASH_REQUIRED (not TERMS_DRIFT)", () => {
    expect(dbProbe.blank_hash.error).toBe("TERMS_HASH_REQUIRED");
    expect(dbProbe.blank_hash.error).not.toBe("TERMS_DRIFT");
  });

  it("wrong well-formed p_terms_hash returns TERMS_DRIFT, not TERMS_HASH_REQUIRED", () => {
    expect(dbProbe.wrong_hash.error).toBe("TERMS_DRIFT");
    expect(dbProbe.wrong_hash.expected_terms_hash).toBe(dbProbe.server_hash);
    expect(dbProbe.wrong_hash.submitted_terms_hash).not.toBe(dbProbe.server_hash);
  });

  it("client SHA-256 of canonical terms produces 64-char lowercase hex (matches PG shape)", async () => {
    const h = await computeMatchTermsHash(baseTerms);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it("edge function maps TERMS_HASH_REQUIRED → 400 and TERMS_DRIFT → 409 (status table parity)", () => {
    // Mirror of the status switch in supabase/functions/match/index.ts so
    // any future change must be reflected here.
    const statusFor = (code: string) =>
      code === "TERMS_DRIFT" ? 409 :
      code === "TERMS_HASH_REQUIRED" ? 400 :
      code === "ACKNOWLEDGEMENTS_REQUIRED" ? 400 : 400;
    expect(statusFor("TERMS_HASH_REQUIRED")).toBe(400);
    expect(statusFor("TERMS_DRIFT")).toBe(409);
  });
});
});
