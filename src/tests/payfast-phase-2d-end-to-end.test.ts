/**
 * Phase 2D — PayFast sandbox end-to-end wiring tests.
 *
 * Stitches Phase 2C (sandbox checkout initiation) and Phase 2B (ITN
 * orchestrator) together in one in-memory loop:
 *
 *   buildPayfastSandboxCheckout()  →  token_purchases row (pending)
 *                                  →  processPayfastItn(COMPLETE)
 *                                  →  wallet credited exactly once
 *
 * Also verifies:
 *   • Duplicate ITN does NOT double-credit (replay guard).
 *   • Mismatched ITN (wrong amount) does NOT credit and IS risk-logged.
 *   • The admin/client purchase history component renders PayFast rows
 *     correctly (provider label, provider_reference fallback chain).
 *
 * No HTTP, no Deno, no Supabase — all in-memory mocks of the same
 * shape used by the Phase 2B and 2C suites.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  buildPayfastSandboxCheckout,
  PAYFAST_SANDBOX_PACKAGES,
  type BuildCheckoutDeps,
} from "../../supabase/functions/_shared/payments/payfast-checkout.ts";
import {
  buildPayfastSignature,
  processPayfastItn,
  type ItnSupabaseClient,
  type PayfastValidatePostback,
} from "../../supabase/functions/_shared/payments/payfast.ts";
import { PurchasesList } from "@/components/desk/billing/PurchasesList";

// ─── Mocks (shared shape with 2B/2C suites) ──────────────────────────────

interface InsertCall {
  table: string;
  payload: Record<string, unknown>;
}

function makeCheckoutSupabase(insertedPurchaseId = "purchase_uuid_e2e") {
  const calls: InsertCall[] = [];
  const client = {
    from(table: string) {
      return {
        insert(payload: Record<string, unknown>) {
          calls.push({ table, payload });
          if (table === "token_purchases") {
            return {
              select: () => ({
                single: async () => ({
                  data: { id: insertedPurchaseId },
                  error: null,
                }),
              }),
            };
          }
          return Promise.resolve({ data: null, error: null });
        },
      };
    },
  };
  return { client, calls };
}

interface MockTables {
  token_purchases: Array<Record<string, unknown>>;
  audit_logs: Array<Record<string, unknown>>;
  admin_risk_items: Array<Record<string, unknown>>;
  webhook_replay_guard: Array<{ source: string; signature_hash: string }>;
}

function makeItnSupabase(initial: Partial<MockTables> = {}) {
  const tables: MockTables = {
    token_purchases: initial.token_purchases ?? [],
    audit_logs: initial.audit_logs ?? [],
    admin_risk_items: initial.admin_risk_items ?? [],
    webhook_replay_guard: initial.webhook_replay_guard ?? [],
  };
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const seenRefs = new Set<string>();

  const buildQuery = (table: keyof MockTables) => {
    const filters: Array<(r: Record<string, unknown>) => boolean> = [];
    let updatePayload: Record<string, unknown> | null = null;
    let isUpdate = false;
    const api = {
      select(_cols: string) { return api; },
      eq(col: string, val: unknown) {
        filters.push((r) => r[col] === val);
        return api;
      },
      in(col: string, vals: unknown[]) {
        filters.push((r) => vals.includes(r[col]));
        return api;
      },
      update(payload: Record<string, unknown>) {
        isUpdate = true;
        updatePayload = payload;
        return api;
      },
      maybeSingle() {
        const rows = tables[table].filter((r) => filters.every((f) => f(r)));
        return Promise.resolve({ data: rows[0] ?? null, error: null });
      },
      insert(row: Record<string, unknown> | Record<string, unknown>[]) {
        if (table === "webhook_replay_guard") {
          const r = (Array.isArray(row) ? row[0] : row) as { source: string; signature_hash: string };
          const dup = tables.webhook_replay_guard.some(
            (x) => x.source === r.source && x.signature_hash === r.signature_hash,
          );
          if (dup) return Promise.resolve({ error: { code: "23505", message: "dup" } });
          tables.webhook_replay_guard.push(r);
          return Promise.resolve({ error: null });
        }
        const arr = Array.isArray(row) ? row : [row];
        tables[table].push(...arr);
        return Promise.resolve({ error: null });
      },
      then(onF: (v: { error: null }) => unknown) {
        if (isUpdate) {
          for (const r of tables[table]) {
            if (filters.every((f) => f(r))) Object.assign(r, updatePayload);
          }
        }
        return Promise.resolve({ error: null }).then(onF);
      },
    };
    return api;
  };

  const client = {
    from(table: string) { return buildQuery(table as keyof MockTables); },
    rpc(fn: string, args: Record<string, unknown>) {
      rpcCalls.push({ fn, args });
      if (fn === "atomic_paid_credit_purchase") {
        const ref = String(args.p_reference_id);
        const alreadyCredited = seenRefs.has(ref);
        seenRefs.add(ref);
        return Promise.resolve({
          data: { new_balance: 10, already_credited: alreadyCredited },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    },
  };
  return { client: client as unknown as ItnSupabaseClient, tables, rpcCalls };
}

// ─── Helpers ──────────────────────────────────────────────────────────────

const ORG = "00000000-0000-0000-0000-0000000000e2";

function checkoutDeps(over: Partial<BuildCheckoutDeps> = {}): BuildCheckoutDeps {
  const { client } = makeCheckoutSupabase();
  return {
    supabase: client,
    userId: "user-e2e",
    orgId: ORG,
    isPlatformAdmin: true,
    gateEnabled: true,
    merchantId: "10000100",
    merchantKey: "46f0cd694581a",
    passphrase: null,
    notifyUrl: "https://x.example/functions/v1/payfast-itn",
    defaultReturnUrl: "https://x.example/return",
    defaultCancelUrl: "https://x.example/cancel",
    now: () => new Date("2026-06-27T12:00:00.000Z"),
    mintMPaymentId: () => "izpf_e2e_001",
    ...over,
  };
}

/** Build a token_purchases row for the ITN mock from the 2C insert payload. */
function bridgePurchaseRow(insertPayload: Record<string, unknown>) {
  return {
    id: "purchase_uuid_e2e",
    org_id: insertPayload.org_id,
    user_id: insertPayload.user_id,
    status: "pending",
    credits: insertPayload.token_amount,
    currency: insertPayload.currency,
    package_id: insertPayload.package_id,
    provider: insertPayload.provider,
    provider_reference: insertPayload.provider_reference,
    metadata: insertPayload.metadata,
  };
}

function buildItnBody(
  mPaymentId: string,
  packageId: string,
  amountGross: string,
  passphrase: string | null = null,
  statusOverride?: string,
) {
  const fields: Array<[string, string]> = [
    ["m_payment_id", mPaymentId],
    ["pf_payment_id", "9999001"],
    ["payment_status", statusOverride ?? "COMPLETE"],
    ["item_name", packageId],
    ["amount_gross", amountGross],
    ["amount_fee", "-2.00"],
    ["amount_net", (Number(amountGross) - 2).toFixed(2)],
    ["custom_str1", packageId],
    ["merchant_id", "10000100"],
  ];
  const sig = buildPayfastSignature(fields, passphrase);
  return new URLSearchParams([...fields, ["signature", sig]]).toString();
}

const VALID_POSTBACK: PayfastValidatePostback = async () =>
  ({ ok: true as const, raw: "VALID" as const });

// ─── End-to-end tests ─────────────────────────────────────────────────────

describe("Phase 2D: full sandbox checkout → ITN → credit loop", () => {
  it("creates a pending PayFast purchase and credits the wallet exactly once on COMPLETE", async () => {
    // ── Step 1: Sandbox checkout initiation (Phase 2C surface) ──
    const checkoutMock = makeCheckoutSupabase();
    const out = await buildPayfastSandboxCheckout(
      { provider: "payfast", mode: "sandbox", packageId: "pack_10" },
      checkoutDeps({ supabase: checkoutMock.client }),
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.status_text).toBe("pending");
    expect(out.providerReference).toBe("izpf_e2e_001");

    const insert = checkoutMock.calls.find((c) => c.table === "token_purchases")!;
    const row = bridgePurchaseRow(insert.payload);
    expect(row.status).toBe("pending");
    expect(row.provider).toBe("payfast");
    expect(row.currency).toBe("ZAR");

    // ── Step 2: ITN delivery for that same provider_reference ──
    const itnMock = makeItnSupabase({ token_purchases: [row] });
    const body = buildItnBody(
      out.providerReference,
      "pack_10",
      PAYFAST_SANDBOX_PACKAGES.pack_10.price_zar.toFixed(2),
    );
    const itnOut = await processPayfastItn(
      { method: "POST", rawBody: body },
      {
        supabase: itnMock.client,
        mode: "sandbox",
        passphrase: null,
        allowedIps: ["1.1.1.1"],
        remoteIp: "1.1.1.1",
        validatePostback: VALID_POSTBACK,
      },
    );

    expect(itnOut.decision).toBe("credited");
    const credits = itnMock.rpcCalls.filter(
      (c) => c.fn === "atomic_paid_credit_purchase",
    );
    expect(credits).toHaveLength(1);
    expect(credits[0].args.p_amount).toBe(10);
    expect(credits[0].args.p_org_id).toBe(ORG);
    // Purchase row updated to completed.
    expect(itnMock.tables.token_purchases[0].status).toBe("completed");
    // Audit log carries the success row.
    expect(
      itnMock.tables.audit_logs.some((r) => r.action === "credits.purchased"),
    ).toBe(true);
  });

  it("does NOT double-credit when the same COMPLETE ITN is re-delivered", async () => {
    const checkoutMock = makeCheckoutSupabase();
    const out = await buildPayfastSandboxCheckout(
      { provider: "payfast", mode: "sandbox", packageId: "single" },
      checkoutDeps({ supabase: checkoutMock.client }),
    );
    if (!out.ok) throw new Error("checkout rejected");
    const row = bridgePurchaseRow(
      checkoutMock.calls.find((c) => c.table === "token_purchases")!.payload,
    );

    const itnMock = makeItnSupabase({ token_purchases: [row] });
    const body = buildItnBody(
      out.providerReference,
      "single",
      PAYFAST_SANDBOX_PACKAGES.single.price_zar.toFixed(2),
    );
    const deps = {
      supabase: itnMock.client,
      mode: "sandbox" as const,
      passphrase: null,
      allowedIps: ["1.1.1.1"],
      remoteIp: "1.1.1.1",
      validatePostback: VALID_POSTBACK,
    };
    const first = await processPayfastItn({ method: "POST", rawBody: body }, deps);
    const second = await processPayfastItn({ method: "POST", rawBody: body }, deps);

    expect(first.decision).toBe("credited");
    expect(second.decision).toBe("rejected");
    expect(second.reason).toBe("replay_detected");
    expect(
      itnMock.rpcCalls.filter((c) => c.fn === "atomic_paid_credit_purchase"),
    ).toHaveLength(1);
  });

  it("does NOT credit when ITN amount_gross does not match the pending purchase, and risk-logs it", async () => {
    const checkoutMock = makeCheckoutSupabase();
    const out = await buildPayfastSandboxCheckout(
      { provider: "payfast", mode: "sandbox", packageId: "pack_10" },
      checkoutDeps({ supabase: checkoutMock.client }),
    );
    if (!out.ok) throw new Error("checkout rejected");
    const row = bridgePurchaseRow(
      checkoutMock.calls.find((c) => c.table === "token_purchases")!.payload,
    );

    const itnMock = makeItnSupabase({ token_purchases: [row] });
    const body = buildItnBody(
      out.providerReference,
      "pack_10",
      "1.00", // wrong — expected 180.00
    );
    const itnOut = await processPayfastItn(
      { method: "POST", rawBody: body },
      {
        supabase: itnMock.client,
        mode: "sandbox",
        passphrase: null,
        allowedIps: ["1.1.1.1"],
        remoteIp: "1.1.1.1",
        validatePostback: VALID_POSTBACK,
      },
    );

    expect(itnOut.decision).toBe("rejected");
    expect(itnOut.reason).toBe("amount_mismatch");
    expect(
      itnMock.rpcCalls.some((c) => c.fn === "atomic_paid_credit_purchase"),
    ).toBe(false);
    expect(
      itnMock.tables.admin_risk_items.some(
        (r) => r.kind === "payfast_itn_rejected",
      ),
    ).toBe(true);
    // Purchase row remains pending — never marked completed.
    expect(itnMock.tables.token_purchases[0].status).toBe("pending");
  });
});

// ─── UI: purchase history renders PayFast rows correctly ─────────────────

function renderWithQuery(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: {
      invoke: async () => ({
        data: {
          success: true,
          purchases: [
            {
              id: "p_pf_1",
              package_id: "pack_10",
              token_amount: 10,
              amount_usd: 0,
              status: "completed",
              created_at: "2026-06-27T12:00:00.000Z",
              paystack_reference: "payfast_sandbox::izpf_e2e_001",
              provider: "payfast",
              provider_reference: "izpf_e2e_001",
            },
            {
              id: "p_ps_1",
              package_id: "single",
              token_amount: 1,
              amount_usd: 1,
              status: "completed",
              created_at: "2026-06-26T10:00:00.000Z",
              paystack_reference: "ps_ref_abc123",
              provider: "paystack",
              provider_reference: "ps_ref_abc123",
            },
          ],
          pending_refunds: [],
          blocked_refunds: [],
          resolved_refunds: [],
        },
        error: null,
      }),
    },
  },
}));

import { vi } from "vitest";

describe("Phase 2D: PurchasesList renders PayFast and Paystack rows side-by-side", () => {
  it("shows the PayFast row using provider_reference (no paystack_reference leak)", async () => {
    renderWithQuery(<PurchasesList orgId={ORG} />);
    const pfRef = await screen.findByTestId("billing-purchase-ref-p_pf_1");
    expect(pfRef.textContent).toBe("izpf_e2e_001");
    expect(pfRef.getAttribute("title")).toContain("payfast");

    const psRef = await screen.findByTestId("billing-purchase-ref-p_ps_1");
    expect(psRef.textContent).toBe("ps_ref_abc123");
    expect(psRef.getAttribute("title")).toContain("paystack");
  });
});
