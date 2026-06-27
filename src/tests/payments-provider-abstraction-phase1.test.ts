/**
 * Payment provider abstraction — Phase 1 unit tests.
 *
 * Exercises the shared scaffolding under
 * `supabase/functions/_shared/payments/`:
 *   - provider.ts       (PaymentProvider type)
 *   - paystack.ts       (Paystack descriptor + HMAC verifier)
 *   - select.ts         (registry / selector)
 *   - reference.ts      (provider-agnostic metadata helpers)
 *
 * Scope: pure-function behaviour only. No edge-function runtime, no
 * Supabase, no Paystack, no PayFast. These tests must remain green
 * regardless of which provider is live, because nothing here calls
 * the live payment path.
 */
import { describe, it, expect } from "vitest";
import {
  PAYSTACK_PROVIDER,
  verifyPaystackSignature,
} from "../../supabase/functions/_shared/payments/paystack.ts";
import {
  selectProvider,
  defaultProvider,
  listLiveProviders,
} from "../../supabase/functions/_shared/payments/select.ts";
import {
  buildProviderMetadata,
  readProviderReference,
  readProviderId,
  PROVIDER_METADATA_KEYS,
} from "../../supabase/functions/_shared/payments/reference.ts";

describe("Paystack provider descriptor", () => {
  it("uses the historical column name and USD-native settlement", () => {
    expect(PAYSTACK_PROVIDER.id).toBe("paystack");
    expect(PAYSTACK_PROVIDER.currency).toBe("USD");
    expect(PAYSTACK_PROVIDER.liveEnabled).toBe(true);
    expect(PAYSTACK_PROVIDER.referenceColumn).toBe("paystack_reference");
  });
});

describe("Provider registry / selector", () => {
  it("returns Paystack as the default provider", () => {
    expect(defaultProvider().id).toBe("paystack");
  });

  it("resolves the Paystack provider by id", () => {
    expect(selectProvider("paystack").id).toBe("paystack");
  });

  it("THROWS when PayFast is requested — PayFast is NOT live in Phase 1", () => {
    expect(() => selectProvider("payfast")).toThrow(/not registered/i);
  });

  it("lists only Paystack as a live provider in Phase 1", () => {
    const live = listLiveProviders().map((p) => p.id);
    expect(live).toEqual(["paystack"]);
    expect(live).not.toContain("payfast");
  });
});

describe("Provider-agnostic reference helpers", () => {
  it("buildProviderMetadata emits canonical keys", () => {
    const md = buildProviderMetadata("paystack", "ref_abc123");
    expect(md[PROVIDER_METADATA_KEYS.provider]).toBe("paystack");
    expect(md[PROVIDER_METADATA_KEYS.providerReference]).toBe("ref_abc123");
  });

  it("buildProviderMetadata rejects an empty reference", () => {
    expect(() => buildProviderMetadata("paystack", "")).toThrow();
  });

  it("readProviderReference prefers provider_reference but falls back to legacy keys", () => {
    expect(readProviderReference({ provider_reference: "new_ref" })).toBe("new_ref");
    expect(readProviderReference({ payment_reference: "legacy_ref" })).toBe("legacy_ref");
    expect(readProviderReference({ reference: "older_ref" })).toBe("older_ref");
    expect(readProviderReference({})).toBeNull();
    expect(readProviderReference(null)).toBeNull();
  });

  it("readProviderId defaults to paystack for historical rows with no provider field", () => {
    // Historical Paystack rows predate the explicit provider field —
    // they MUST continue to resolve as Paystack, never as PayFast.
    expect(readProviderId({})).toBe("paystack");
    expect(readProviderId(null)).toBe("paystack");
    expect(readProviderId({ provider: "paystack" })).toBe("paystack");
    expect(readProviderId({ provider: "payfast" })).toBe("payfast");
    // Unknown providers default to paystack — defensive against typos.
    expect(readProviderId({ provider: "stripe" as unknown as string })).toBe("paystack");
  });
});

describe("Paystack HMAC-SHA512 verifier (shared helper)", () => {
  // Known-good vector computed from the same algorithm used inline in
  // token-purchase/index.ts and paystack-webhook/index.ts.
  const SECRET = "sk_test_dummy_phase1";
  const BODY = JSON.stringify({ event: "charge.success", data: { reference: "ref_1" } });

  async function expectedSig(body: string, secret: string): Promise<string> {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(secret),
      { name: "HMAC", hash: "SHA-512" },
      false,
      ["sign"],
    );
    const buf = await crypto.subtle.sign("HMAC", key, enc.encode(body));
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  it("accepts a valid HMAC-SHA512 signature", async () => {
    const sig = await expectedSig(BODY, SECRET);
    expect(await verifyPaystackSignature(BODY, sig, SECRET)).toBe(true);
  });

  it("rejects a tampered body", async () => {
    const sig = await expectedSig(BODY, SECRET);
    expect(await verifyPaystackSignature(BODY + "x", sig, SECRET)).toBe(false);
  });

  it("rejects a wrong secret", async () => {
    const sig = await expectedSig(BODY, SECRET);
    expect(await verifyPaystackSignature(BODY, sig, "sk_test_wrong")).toBe(false);
  });

  it("rejects empty inputs without throwing", async () => {
    expect(await verifyPaystackSignature("", "abc", SECRET)).toBe(false);
    expect(await verifyPaystackSignature(BODY, "", SECRET)).toBe(false);
    expect(await verifyPaystackSignature(BODY, "abc", "")).toBe(false);
  });
});
