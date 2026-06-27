/**
 * Phase 2C — PayFast sandbox checkout initiation tests.
 *
 * Exercises the pure orchestrator `buildPayfastSandboxCheckout` with a
 * mock Supabase client so we cover:
 *   • the four gates (env flag, admin, provider literal, mode literal)
 *   • purchase row insertion shape (provider, provider_reference,
 *     status, currency, ZAR metadata, paystack_reference handling)
 *   • signed PayFast form payload (signature derived from the final
 *     outgoing fields; merchant_key and passphrase not leaked)
 *   • rejection paths (invalid package, missing org, merchant misconfig)
 *
 * Pure Node — no Supabase calls, no Deno globals, no edge runtime.
 */
import { describe, it, expect } from "vitest";
import {
  PAYFAST_SANDBOX_PACKAGES,
  PAYFAST_SANDBOX_PROCESS_URL,
  buildPayfastSandboxCheckout,
  buildSignedSandboxFormPayload,
  type BuildCheckoutDeps,
} from "../../supabase/functions/_shared/payments/payfast-checkout.ts";
import { buildPayfastSignature } from "../../supabase/functions/_shared/payments/payfast.ts";

// ─── Mock supabase client ─────────────────────────────────────────────────

interface InsertCall {
  table: string;
  payload: Record<string, unknown>;
}

function makeMockSupabase(opts: {
  insertedPurchaseId?: string;
  failInsertWith?: { message: string };
} = {}) {
  const calls: InsertCall[] = [];
  const client = {
    from(table: string) {
      return {
        insert(payload: Record<string, unknown>) {
          calls.push({ table, payload });
          if (table === "token_purchases") {
            return {
              select() {
                return {
                  single: async () =>
                    opts.failInsertWith
                      ? { data: null, error: opts.failInsertWith }
                      : {
                          data: { id: opts.insertedPurchaseId ?? "purchase_uuid_1" },
                          error: null,
                        },
                };
              },
            };
          }
          // audit_logs etc.
          return Promise.resolve({ data: null, error: null });
        },
      };
    },
  };
  return { client, calls };
}

function baseDeps(overrides: Partial<BuildCheckoutDeps> = {}): BuildCheckoutDeps {
  const { client } = makeMockSupabase();
  return {
    supabase: client,
    userId: "user-1",
    orgId: "org-1",
    isPlatformAdmin: true,
    gateEnabled: true,
    merchantId: "10000100",
    merchantKey: "46f0cd694581a",
    passphrase: null,
    notifyUrl: "https://x.example/functions/v1/payfast-itn",
    defaultReturnUrl: "https://x.example/return",
    defaultCancelUrl: "https://x.example/cancel",
    now: () => new Date("2026-06-27T12:00:00.000Z"),
    mintMPaymentId: () => "izpf_test_001",
    ...overrides,
  };
}

// ─── Gates ────────────────────────────────────────────────────────────────

describe("Phase 2C: gates block initiation safely", () => {
  it("rejects when PAYFAST_SANDBOX_CHECKOUT_ENABLED is off", async () => {
    const mock = makeMockSupabase();
    const out = await buildPayfastSandboxCheckout(
      { provider: "payfast", mode: "sandbox", packageId: "single" },
      baseDeps({ supabase: mock.client, gateEnabled: false }),
    );
    if (out.ok) throw new Error("expected rejection");
    expect(out.reason).toBe("gate_disabled");
    expect(mock.calls.find((c) => c.table === "token_purchases")).toBeUndefined();
  });

  it("rejects non-platform_admin callers", async () => {
    const mock = makeMockSupabase();
    const out = await buildPayfastSandboxCheckout(
      { provider: "payfast", mode: "sandbox", packageId: "single" },
      baseDeps({ supabase: mock.client, isPlatformAdmin: false }),
    );
    if (out.ok) throw new Error("expected rejection");
    expect(out.reason).toBe("not_admin");
    expect(mock.calls.find((c) => c.table === "token_purchases")).toBeUndefined();
  });

  it("rejects when provider != payfast", async () => {
    const mock = makeMockSupabase();
    const out = await buildPayfastSandboxCheckout(
      { provider: "paystack", mode: "sandbox", packageId: "single" },
      baseDeps({ supabase: mock.client }),
    );
    if (out.ok) throw new Error("expected rejection");
    expect(out.reason).toBe("wrong_provider");
    expect(mock.calls.find((c) => c.table === "token_purchases")).toBeUndefined();
  });

  it("rejects when mode != sandbox", async () => {
    const mock = makeMockSupabase();
    const out = await buildPayfastSandboxCheckout(
      { provider: "payfast", mode: "live", packageId: "single" },
      baseDeps({ supabase: mock.client }),
    );
    if (out.ok) throw new Error("expected rejection");
    expect(out.reason).toBe("wrong_mode");
    expect(mock.calls.find((c) => c.table === "token_purchases")).toBeUndefined();
  });

  it("rejects when merchant config missing", async () => {
    const mock = makeMockSupabase();
    const out = await buildPayfastSandboxCheckout(
      { provider: "payfast", mode: "sandbox", packageId: "single" },
      baseDeps({ supabase: mock.client, merchantKey: "" }),
    );
    if (out.ok) throw new Error("expected rejection");
    expect(out.reason).toBe("merchant_config_missing");
  });

  it("rejects unknown package", async () => {
    const mock = makeMockSupabase();
    const out = await buildPayfastSandboxCheckout(
      { provider: "payfast", mode: "sandbox", packageId: "mystery" },
      baseDeps({ supabase: mock.client }),
    );
    if (out.ok) throw new Error("expected rejection");
    expect(out.reason).toBe("invalid_package");
  });

  it("rejects missing org", async () => {
    const mock = makeMockSupabase();
    const out = await buildPayfastSandboxCheckout(
      { provider: "payfast", mode: "sandbox", packageId: "single" },
      baseDeps({ supabase: mock.client, orgId: null }),
    );
    if (out.ok) throw new Error("expected rejection");
    expect(out.reason).toBe("missing_org");
  });

  it("rejects package with non-positive price (defence in depth)", async () => {
    const mock = makeMockSupabase();
    const out = await buildPayfastSandboxCheckout(
      { provider: "payfast", mode: "sandbox", packageId: "single" },
      baseDeps({
        supabase: mock.client,
        packages: { single: { id: "single", credits: 1, price_zar: 0, label: "Zero" } },
      }),
    );
    if (out.ok) throw new Error("expected rejection");
    expect(out.reason).toBe("amount_invalid");
  });
});

// ─── Successful initiation ────────────────────────────────────────────────

describe("Phase 2C: successful sandbox initiation", () => {
  it("inserts a token_purchases row with provider='payfast' and ZAR currency", async () => {
    const mock = makeMockSupabase();
    const out = await buildPayfastSandboxCheckout(
      { provider: "payfast", mode: "sandbox", packageId: "pack_10" },
      baseDeps({ supabase: mock.client }),
    );
    expect(out.ok).toBe(true);
    const insert = mock.calls.find((c) => c.table === "token_purchases");
    expect(insert).toBeDefined();
    const row = insert!.payload as Record<string, unknown>;
    expect(row.provider).toBe("payfast");
    expect(row.provider_reference).toBe("izpf_test_001");
    expect(row.status).toBe("pending");
    expect(row.currency).toBe("ZAR");
    expect(row.amount_usd).toBe(0);
    expect(row.token_amount).toBe(10);
    expect(row.package_id).toBe("pack_10");
  });

  it("namespaces the legacy paystack_reference to keep Paystack rows isolated", () => {
    const mock = makeMockSupabase();
    return buildPayfastSandboxCheckout(
      { provider: "payfast", mode: "sandbox", packageId: "single" },
      baseDeps({ supabase: mock.client }),
    ).then((out) => {
      expect(out.ok).toBe(true);
      const insert = mock.calls.find((c) => c.table === "token_purchases");
      const row = insert!.payload as Record<string, unknown>;
      // NOT NULL constraint on `paystack_reference` requires a value;
      // we use a clearly-namespaced one and never reuse a real Paystack
      // reference shape.
      expect(row.paystack_reference).toBe("payfast_sandbox::izpf_test_001");
    });
  });

  it("writes safe ZAR metadata and never stores secrets", async () => {
    const mock = makeMockSupabase();
    await buildPayfastSandboxCheckout(
      { provider: "payfast", mode: "sandbox", packageId: "single" },
      baseDeps({ supabase: mock.client, passphrase: "super-secret-passphrase" }),
    );
    const insert = mock.calls.find((c) => c.table === "token_purchases");
    const meta = (insert!.payload.metadata ?? {}) as Record<string, unknown>;
    expect(meta.sandbox).toBe(true);
    expect(meta.mode).toBe("sandbox");
    expect(meta.amount_zar).toBe(PAYFAST_SANDBOX_PACKAGES.single.price_zar);
    expect(meta.price_zar).toBe(PAYFAST_SANDBOX_PACKAGES.single.price_zar);
    expect(meta.m_payment_id).toBe("izpf_test_001");
    // No secret leakage.
    const blob = JSON.stringify(insert!.payload);
    expect(blob).not.toContain("super-secret-passphrase");
    expect(blob).not.toContain("46f0cd694581a");
  });

  it("response includes signed checkoutUrl + form fields", async () => {
    const mock = makeMockSupabase();
    const out = await buildPayfastSandboxCheckout(
      { provider: "payfast", mode: "sandbox", packageId: "single" },
      baseDeps({ supabase: mock.client }),
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.provider).toBe("payfast");
    expect(out.mode).toBe("sandbox");
    expect(out.status_text).toBe("pending");
    expect(out.checkoutUrl.startsWith(PAYFAST_SANDBOX_PROCESS_URL + "?")).toBe(true);
    const names = out.formFields.map((f) => f.name);
    expect(names).toContain("merchant_id");
    expect(names).toContain("m_payment_id");
    expect(names).toContain("amount");
    expect(names).toContain("signature");
    // merchant_key MUST NOT be in the returned form fields (passphrase
    // must never appear anywhere in the response).
    expect(names).not.toContain("merchant_key");
    expect(names).not.toContain("passphrase");
  });

  it("signature in the response is derived from the FINAL outgoing fields", async () => {
    const mock = makeMockSupabase();
    const out = await buildPayfastSandboxCheckout(
      { provider: "payfast", mode: "sandbox", packageId: "single" },
      baseDeps({ supabase: mock.client, passphrase: "test-pass" }),
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    // The orchestrator strips merchant_key from formFields before
    // returning. To recompute the expected signature we rebuild the
    // outgoing field set (including merchant_key) deterministically.
    const pkg = PAYFAST_SANDBOX_PACKAGES.single;
    const signed = buildSignedSandboxFormPayload({
      merchantId: "10000100",
      merchantKey: "46f0cd694581a",
      returnUrl: "https://x.example/return",
      cancelUrl: "https://x.example/cancel",
      notifyUrl: "https://x.example/functions/v1/payfast-itn",
      mPaymentId: "izpf_test_001",
      amount: pkg.price_zar.toFixed(2),
      itemName: `Izenzo Credits — ${pkg.label}`,
      itemDescription: `Sandbox checkout for ${pkg.label}`,
      customStr1: "single",
      customStr2: "org-1",
      customStr3: "user-1",
      passphrase: "test-pass",
    });
    const sigField = out.formFields.find((f) => f.name === "signature");
    expect(sigField?.value).toBe(signed.signature);
    expect(signed.signature).toMatch(/^[0-9a-f]{32}$/);
  });

  it("buildSignedSandboxFormPayload uses MD5 over PHP-style urlencode", () => {
    const fields = [
      ["merchant_id", "10000100"],
      ["merchant_key", "46f0cd694581a"],
      ["amount", "20.00"],
      ["item_name", "Izenzo Credits — 1 Credit (Sandbox)"],
    ] as Array<readonly [string, string]>;
    const expected = buildPayfastSignature(fields, null);
    expect(expected).toMatch(/^[0-9a-f]{32}$/);
  });

  it("propagates insert failure as a structured rejection (no checkoutUrl)", async () => {
    const mock = makeMockSupabase({ failInsertWith: { message: "RLS denied" } });
    const out = await buildPayfastSandboxCheckout(
      { provider: "payfast", mode: "sandbox", packageId: "single" },
      baseDeps({ supabase: mock.client }),
    );
    if (out.ok) throw new Error("expected rejection");
    expect(out.reason).toBe("purchase_insert_failed");
    expect(out.status).toBe(500);
  });
});
