/**
 * Marketing-mockup fixtures.
 *
 * High-fidelity static data for rendering MatchCompiler and EvidencePackView
 * in demo/preview mode (e.g. landing pages, screenshots, marketing visuals)
 * WITHOUT touching the live database, edge functions, or auth session.
 *
 * Keep values realistic — these surfaces are user-facing in marketing.
 */

export const DEMO_MATCH_ID = "a1b2c3d4-demo-4f5e-9c2a-7d3e8f1a2b3c";

export const DEMO_COMPILER_TERMS = {
  counterparty: "Glencore Singapore Pte Ltd",
  commodity: "Copper Cathode · LME Grade A",
  volume: "500",
  price: "9,420",
  incoterms: "CIF Rotterdam",
  notes: "Inspection by SGS at load port. Payment via L/C at sight, confirmed by ABN AMRO.",
} as const;

export const DEMO_COMPILER_DOCS = [
  {
    name: "Sale_Contract_GLN-IZN-2025-0418.pdf",
    size: 248_320,
    hash: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
  },
  {
    name: "SGS_Quality_Certificate_LME-A.pdf",
    size: 184_117,
    hash: "2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae",
  },
  {
    name: "BL_Maersk_MAEU-7842910.pdf",
    size: 92_854,
    hash: "fcde2b2edba56bf408601fb721fe9b5c338d10ee429ea04fae5511b68fbf8fb9",
  },
] as const;

export const DEMO_COMPILER_SEAL =
  "7c1a3d8e9b4f2a6c5d8e1f0b3c7a9d2e4f6b8a1c3d5e7f9a2b4c6d8e0f1a3b5c";

/* ─────────────────────────────────────────────────────────────────── */

export const DEMO_EVIDENCE_PACK = {
  metadata: {
    packId: "pack_2025_04_18_glencore_iz_004",
    generatedAt: "2025-04-18T09:42:17.000Z",
    format: "WaD/A v1.2",
  },
  packHash:
    "a3f5b8d2c4e7f1a9b6d8e2c5f7a4b1d9e6c3f8a2b5d7e1c4f9a6b3d8e2c5f7a4",
  hashAlgorithm: "SHA-256",
  signatureValidation: {
    hasCollapseRecord: true,
    signatureValid: true,
    signatureKeyId: "izenzo-gov-key-2025-q2-01",
  },
  timestampMetadata: {
    serverTimestampUtc: "2025-04-18T09:42:17Z",
    matchCreatedAt: "2025-04-15T14:08:33Z",
    matchSettledAt: "2025-04-18T09:41:58Z",
    collapseClientTimestamp: "2025-04-18T09:41:55Z",
    collapseServerTimestamp: "2025-04-18T09:41:58Z",
    timestampSource: "NTP · time.cloudflare.com (drift 4ms)",
  },
  chainVerification: { valid: true, eventCount: 12 },
  canonical: {
    match: {
      commodity: "Copper Cathode · LME Grade A",
      quantity_amount: 500,
      quantity_unit: "MT",
      price_amount: 9420,
      price_currency: "USD",
      incoterms: "CIF Rotterdam",
      payment_terms: "L/C at sight (ABN AMRO confirmed)",
      buyer_name: "Aurubis AG",
      seller_name: "Glencore Singapore Pte Ltd",
      settled_at: "2025-04-18T09:41:58Z",
      status: "settled",
      state: "completed",
    },
    documents: [
      {
        sha256_hash:
          "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
        filename: "Sale_Contract_GLN-IZN-2025-0418.pdf",
      },
      {
        sha256_hash:
          "2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae",
        filename: "SGS_Quality_Certificate_LME-A.pdf",
      },
      {
        sha256_hash:
          "fcde2b2edba56bf408601fb721fe9b5c338d10ee429ea04fae5511b68fbf8fb9",
        filename: "BL_Maersk_MAEU-7842910.pdf",
      },
    ],
    events: [
      { event_type: "match_created", payload_hash: "11aa22bb33cc44dd55ee66ff7788990011aa22bb33cc44dd55ee66ff77889900", created_at: "2025-04-15T14:08:33Z" },
      { event_type: "kyc_verified", payload_hash: "22bb33cc44dd55ee66ff7788990011aa22bb33cc44dd55ee66ff7788990011aa", created_at: "2025-04-15T15:22:01Z" },
      { event_type: "sanctions_screened", payload_hash: "33cc44dd55ee66ff7788990011aa22bb33cc44dd55ee66ff7788990011aa22bb", created_at: "2025-04-15T15:22:18Z" },
      { event_type: "jurisdiction_resolved", payload_hash: "44dd55ee66ff7788990011aa22bb33cc44dd55ee66ff7788990011aa22bb33cc", created_at: "2025-04-15T15:23:02Z" },
      { event_type: "ubo_verified", payload_hash: "55ee66ff7788990011aa22bb33cc44dd55ee66ff7788990011aa22bb33cc44dd", created_at: "2025-04-16T08:14:55Z" },
      { event_type: "authority_bound", payload_hash: "66ff7788990011aa22bb33cc44dd55ee66ff7788990011aa22bb33cc44dd55ee", created_at: "2025-04-16T08:15:11Z" },
      { event_type: "terms_locked", payload_hash: "778899aabbccddeeff00112233445566778899aabbccddeeff0011223344556a", created_at: "2025-04-17T11:02:44Z" },
      { event_type: "documents_attached", payload_hash: "8899aabbccddeeff00112233445566778899aabbccddeeff00112233445566aa", created_at: "2025-04-17T11:18:09Z" },
      { event_type: "poi_generated", payload_hash: "99aabbccddeeff00112233445566778899aabbccddeeff00112233445566aabb", created_at: "2025-04-18T09:40:12Z" },
      { event_type: "collapse_signed_a", payload_hash: "aabbccddeeff00112233445566778899aabbccddeeff00112233445566aabbcc", created_at: "2025-04-18T09:41:33Z" },
      { event_type: "collapse_signed_b", payload_hash: "bbccddeeff00112233445566778899aabbccddeeff00112233445566aabbccdd", created_at: "2025-04-18T09:41:50Z" },
      { event_type: "wad_certificate_issued", payload_hash: "ccddeeff00112233445566778899aabbccddeeff00112233445566aabbccddee", created_at: "2025-04-18T09:41:58Z" },
    ],
    collapse: {
      payload_hash:
        "aabbccddeeff00112233445566778899aabbccddeeff00112233445566aabbcc",
    },
  },
} as const;
