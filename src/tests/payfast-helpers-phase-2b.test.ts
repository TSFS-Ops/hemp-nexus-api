/**
 * PayFast helper unit tests — Phase 2B.
 *
 * Pure-function coverage of the helpers in
 * `supabase/functions/_shared/payments/payfast.ts`:
 *   • pfUrlEncode (PHP-style)
 *   • parseFormEncodedOrdered / fieldsToRecord
 *   • buildPayfastSignature / verifyPayfastSignature (with & without passphrase)
 *   • mapPayfastStatus
 *   • extractPayfastProviderReference
 *   • isAllowedPayfastIp
 *
 * No Supabase, no HTTP, no Deno globals. These tests pin the cryptography
 * and parsing contracts that the ITN orchestrator depends on.
 */
import { describe, it, expect } from "vitest";
import {
  PAYFAST_PROVIDER,
  pfUrlEncode,
  parseFormEncodedOrdered,
  fieldsToRecord,
  buildPayfastSignature,
  buildPayfastSignatureBase,
  verifyPayfastSignature,
  mapPayfastStatus,
  extractPayfastProviderReference,
  isAllowedPayfastIp,
  PAYFAST_VALIDATE_URLS,
} from "../../supabase/functions/_shared/payments/payfast.ts";

describe("PAYFAST_PROVIDER descriptor", () => {
  it("is ZAR-native and NOT live-enabled (Phase 2B sandbox-only)", () => {
    expect(PAYFAST_PROVIDER.id).toBe("payfast");
    expect(PAYFAST_PROVIDER.currency).toBe("ZAR");
    expect(PAYFAST_PROVIDER.liveEnabled).toBe(false);
    expect(PAYFAST_PROVIDER.referenceColumn).toBe("provider_reference");
  });
});

describe("pfUrlEncode (PHP-style)", () => {
  it("encodes spaces as + (not %20)", () => {
    expect(pfUrlEncode("hello world")).toBe("hello+world");
  });
  it("uses uppercase percent escapes", () => {
    expect(pfUrlEncode("a/b")).toBe("a%2Fb");
  });
  it("encodes !'()* which encodeURIComponent leaves alone", () => {
    expect(pfUrlEncode("a!b'c(d)e*f")).toBe("a%21b%27c%28d%29e%2Af");
  });
});

describe("parseFormEncodedOrdered preserves POST order", () => {
  it("returns fields in insertion order", () => {
    const ordered = parseFormEncodedOrdered("c=3&a=1&b=2");
    expect(ordered.map(([k]) => k)).toEqual(["c", "a", "b"]);
  });
  it("decodes + as space and %xx", () => {
    const ordered = parseFormEncodedOrdered("name=John+Doe&path=%2Fx");
    expect(fieldsToRecord(ordered)).toEqual({ name: "John Doe", path: "/x" });
  });
  it("returns empty array on empty body", () => {
    expect(parseFormEncodedOrdered("")).toEqual([]);
  });
});

describe("PayFast signature: build + verify", () => {
  // Realistic ITN field order (subset).
  const ITN_FIELDS: Array<readonly [string, string]> = [
    ["m_payment_id", "pf_test_001"],
    ["pf_payment_id", "1234567"],
    ["payment_status", "COMPLETE"],
    ["item_name", "pack_10"],
    ["amount_gross", "180.00"],
    ["amount_fee", "-5.00"],
    ["amount_net", "175.00"],
    ["custom_str1", "pack_10"],
    ["merchant_id", "10000100"],
  ];

  it("builds a deterministic signature base string in field order, skipping empties", () => {
    const fieldsWithEmpty: Array<readonly [string, string]> = [
      ...ITN_FIELDS,
      ["empty_thing", ""],
    ];
    const base = buildPayfastSignatureBase(fieldsWithEmpty);
    // Order preserved, empty skipped, no `signature=` itself.
    expect(base.startsWith("m_payment_id=pf_test_001&pf_payment_id=1234567")).toBe(true);
    expect(base.includes("empty_thing")).toBe(false);
    expect(base.includes("signature=")).toBe(false);
  });

  it("verifies a self-built signature (no passphrase)", () => {
    const sig = buildPayfastSignature(ITN_FIELDS);
    expect(sig).toMatch(/^[0-9a-f]{32}$/);
    expect(verifyPayfastSignature(ITN_FIELDS, sig)).toBe(true);
  });

  it("verifies a self-built signature WITH passphrase", () => {
    const pass = "my-secret-pass";
    const sig = buildPayfastSignature(ITN_FIELDS, pass);
    expect(verifyPayfastSignature(ITN_FIELDS, sig, pass)).toBe(true);
    // Without the passphrase the same signature must NOT verify.
    expect(verifyPayfastSignature(ITN_FIELDS, sig)).toBe(false);
  });

  it("rejects a tampered amount", () => {
    const sig = buildPayfastSignature(ITN_FIELDS);
    const tampered: Array<readonly [string, string]> = ITN_FIELDS.map(([k, v]) =>
      k === "amount_gross" ? [k, "1.00"] as const : [k, v] as const,
    );
    expect(verifyPayfastSignature(tampered, sig)).toBe(false);
  });

  it("rejects a missing/empty signature", () => {
    expect(verifyPayfastSignature(ITN_FIELDS, "")).toBe(false);
    expect(verifyPayfastSignature(ITN_FIELDS, null)).toBe(false);
    expect(verifyPayfastSignature(ITN_FIELDS, undefined)).toBe(false);
  });

  it("verification is case-insensitive on the provided hex", () => {
    const sig = buildPayfastSignature(ITN_FIELDS);
    expect(verifyPayfastSignature(ITN_FIELDS, sig.toUpperCase())).toBe(true);
  });
});

describe("mapPayfastStatus", () => {
  it("maps the four documented statuses", () => {
    expect(mapPayfastStatus("COMPLETE")).toBe("completed");
    expect(mapPayfastStatus("FAILED")).toBe("failed");
    expect(mapPayfastStatus("CANCELLED")).toBe("cancelled");
    expect(mapPayfastStatus("PENDING")).toBe("pending");
  });
  it("is case-insensitive", () => {
    expect(mapPayfastStatus("complete")).toBe("completed");
  });
  it("returns 'unknown' for anything else (and for null/undefined)", () => {
    expect(mapPayfastStatus(null)).toBe("unknown");
    expect(mapPayfastStatus(undefined)).toBe("unknown");
    expect(mapPayfastStatus("WHATEVER")).toBe("unknown");
  });
});

describe("extractPayfastProviderReference", () => {
  it("prefers pf_payment_id for credit allocation and m_payment_id for lookup", () => {
    expect(
      extractPayfastProviderReference({ m_payment_id: "m_1", pf_payment_id: "pf_9" }),
    ).toEqual({ lookupRef: "m_1", creditRef: "pf_9" });
  });
  it("falls back to m_payment_id when pf_payment_id is missing", () => {
    expect(extractPayfastProviderReference({ m_payment_id: "m_1" })).toEqual({
      lookupRef: "m_1",
      creditRef: "m_1",
    });
  });
  it("returns null lookupRef when m_payment_id is missing", () => {
    expect(extractPayfastProviderReference({ pf_payment_id: "pf_9" })).toEqual({
      lookupRef: null,
      creditRef: "pf_9",
    });
  });
});

describe("isAllowedPayfastIp", () => {
  it("accepts an IP present in the allowlist", () => {
    expect(isAllowedPayfastIp({ remoteIp: "1.2.3.4", allowedIps: ["1.2.3.4"] })).toBe(true);
  });
  it("rejects an IP NOT in the allowlist", () => {
    expect(isAllowedPayfastIp({ remoteIp: "9.9.9.9", allowedIps: ["1.2.3.4"] })).toBe(false);
  });
  it("rejects when remoteIp is null", () => {
    expect(isAllowedPayfastIp({ remoteIp: null, allowedIps: ["1.2.3.4"] })).toBe(false);
  });
  it("honours sandboxBypass ONLY when explicitly set", () => {
    expect(
      isAllowedPayfastIp({ remoteIp: null, allowedIps: [], sandboxBypass: true }),
    ).toBe(true);
    expect(isAllowedPayfastIp({ remoteIp: null, allowedIps: [] })).toBe(false);
  });
});

describe("PAYFAST_VALIDATE_URLS", () => {
  it("points sandbox and live at PayFast's published endpoints", () => {
    expect(PAYFAST_VALIDATE_URLS.sandbox).toBe(
      "https://sandbox.payfast.co.za/eng/query/validate",
    );
    expect(PAYFAST_VALIDATE_URLS.live).toBe(
      "https://www.payfast.co.za/eng/query/validate",
    );
  });
});
