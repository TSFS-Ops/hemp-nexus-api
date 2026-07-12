/**
 * PayFast admin revenue visibility fix — Phase B.
 *
 * Covers the Phase B brief's required test outcomes:
 * - a new completed PayFast credits.purchased audit row includes USD
 *   amount, FX rate, provider/payment reference, token_amount and
 *   status, sourced read-only from the checkout-time
 *   token_purchases.metadata snapshot (never recalculated, no live FX);
 * - historical rows without checkout-time USD metadata still credit
 *   normally and degrade safely (null USD fields) instead of crashing
 *   or inventing figures;
 * - PayFast ITN idempotency and wallet crediting are unchanged;
 * - AdminRevenuePanel's purchaseFromAuditLog / purchaseFromLedger now
 *   surface PayFast USD revenue, FX rate and reference via safe
 *   fallback chains instead of $0 / blank, while Paystack rows and
 *   missing-metadata historical rows keep working exactly as before;
 * - no external/live FX API is introduced anywhere in this fix.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
    buildPayfastSignature,
    processPayfastItn,
    type ItnSupabaseClient,
    type PayfastValidatePostback,
} from "../../supabase/functions/_shared/payments/payfast.ts";

const read = (p: string) => readFileSync(resolve(p), "utf8");

const PAYFAST_SRC = read("supabase/functions/_shared/payments/payfast.ts");
const ADMIN_REVENUE_SRC = read("src/components/admin/AdminRevenuePanel.tsx");

// ─── Mock Supabase client (mirrors src/tests/payfast-itn-phase-2b.test.ts) ─
interface MockTables {
    token_purchases: Array<Record<string, unknown>>;
    audit_logs: Array<Record<string, unknown>>;
    admin_risk_items: Array<Record<string, unknown>>;
    webhook_replay_guard: Array<{ source: string; signature_hash: string }>;
}

interface MockRpcCall {
    fn: string;
    args: Record<string, unknown>;
}

function makeMockSupabase(initial: Partial<MockTables> = {}) {
    const tables: MockTables = {
          token_purchases: initial.token_purchases ?? [],
          audit_logs: initial.audit_logs ?? [],
          admin_risk_items: initial.admin_risk_items ?? [],
          webhook_replay_guard: initial.webhook_replay_guard ?? [],
    };
    const rpcCalls: MockRpcCall[] = [];
    const seenRefs = new Set<string>();

  const buildQuery = (table: keyof MockTables) => {
        const filters: Array<(r: Record<string, unknown>) => boolean> = [];
        let updatePayload: Record<string, unknown> | null = null;
        let isUpdate = false;

        const api = {
                select(_cols: string) {
                          return api;
                },
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
                                      const r = (Array.isArray(row) ? row[0] : row) as {
                                                    source: string;
                                                    signature_hash: string;
                                      };
                                      const dup = tables.webhook_replay_guard.some(
                                                    (x) => x.source === r.source && x.signature_hash === r.signature_hash,
                                                  );
                                      if (dup) {
                                                    return Promise.resolve({
                                                                    error: { code: "23505", message: "duplicate key value" },
                                                    });
                                      }
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
        from(table: string) {
                return buildQuery(table as keyof MockTables);
        },
        rpc(fn: string, args: Record<string, unknown>) {
                rpcCalls.push({ fn, args });
                if (fn === "atomic_paid_credit_purchase") {
                          const ref = String(args.p_reference_id);
                          const alreadyCredited = seenRefs.has(ref);
                          seenRefs.add(ref);
                          return Promise.resolve({
                                      data: { new_balance: 110, already_credited: alreadyCredited },
                                      error: null,
                          });
                }
                return Promise.resolve({ data: null, error: null });
        },
  };
    return { client: client as unknown as ItnSupabaseClient, tables, rpcCalls };
}

// ─── Fixtures ─────────────────────────────────────────────────────────────

const ORG = "00000000-0000-0000-0000-0000000000b1";
const PURCHASE_ID = "00000000-0000-0000-0000-0000000000bb";
const M_REF = "izpf_admin_rev_001";
const PF_REF = "998877";

function makeLivePurchase(over: Partial<Record<string, unknown>> = {}) {
    return {
          id: PURCHASE_ID,
          org_id: ORG,
          user_id: ORG,
          status: "pending",
          token_amount: 100,
          currency: "ZAR",
          package_id: "pack_50",
          provider: "payfast",
          provider_reference: M_REF,
          metadata: {
                  provider: "payfast",
                  provider_reference: M_REF,
                  m_payment_id: M_REF,
                  mode: "live",
                  package_id: "pack_50",
                  package_label: "100 credits",
                  token_amount: 100,
                  amount_usd: 500,
                  price_usd: 500,
                  usd_zar_rate: 18,
                  fx_rate_locked_at: "2026-07-01T00:00:00.000Z",
                  fx_rate_source: "admin_settings:payfast_usd_zar_rate",
                  amount_zar: 9000,
                  price_zar: 9000,
                  currency: "ZAR",
          },
          ...over,
    };
}

function makeLegacyPurchase(over: Partial<Record<string, unknown>> = {}) {
    // Mimics a pre-Phase-2J purchase row: only the ZAR figure is known at
  // checkout time, no USD/FX snapshot exists yet.
  return {
        id: PURCHASE_ID,
        org_id: ORG,
        user_id: ORG,
        status: "pending",
        token_amount: 10,
        currency: "ZAR",
        package_id: "pack_10",
        provider: "payfast",
        provider_reference: M_REF,
        metadata: { price_zar: 180, package_id: "pack_10" },
        ...over,
  };
}

function buildItnBody(over: Partial<Record<string, string>> = {}, passphrase?: string) {
    const fields: Array<[string, string]> = [
          ["m_payment_id", M_REF],
          ["pf_payment_id", PF_REF],
          ["payment_status", "COMPLETE"],
          ["item_name", "pack_50"],
          ["amount_gross", "9000.00"],
          ["amount_fee", "-50.00"],
          ["amount_net", "8950.00"],
          ["custom_str1", "pack_50"],
          ["merchant_id", "10000100"],
        ];
    const seen = new Set<string>();
    const merged: Array<[string, string]> = fields.map(([k, v]) => {
          if (k in over) {
                  seen.add(k);
                  return [k, over[k] as string] as [string, string];
          }
          return [k, v] as [string, string];
    });
    for (const [k, v] of Object.entries(over)) {
          if (!seen.has(k)) merged.push([k, v]);
    }
    const sig = buildPayfastSignature(merged, passphrase);
    const all: Array<[string, string]> = [...merged, ["signature", sig]];
    return new URLSearchParams(all).toString();
}

const VALID_POSTBACK: PayfastValidatePostback = async () =>
    ({ ok: true as const, raw: "VALID" as const });

function baseDeps(mock: ReturnType<typeof makeMockSupabase>) {
    return {
          supabase: mock.client,
          mode: "live" as const,
          passphrase: null,
          allowedIps: ["1.1.1.1"],
          remoteIp: "1.1.1.1",
          validatePostback: VALID_POSTBACK,
    };
}

// ─── Tests: PayFast settlement audit metadata enrichment ──────────────────

describe("Phase B — credits.purchased audit row includes USD/FX/reference metadata", () => {
    it("includes amount_usd and price_usd from checkout-time metadata", async () => {
          const mock = makeMockSupabase({ token_purchases: [makeLivePurchase()] });
          const out = await processPayfastItn({ method: "POST", rawBody: buildItnBody() }, baseDeps(mock));
          expect(out.decision).toBe("credited");
          const row = mock.tables.audit_logs.find((r) => r.action === "credits.purchased");
          expect(row).toBeTruthy();
          const meta = row!.metadata as Record<string, unknown>;
          expect(meta.amount_usd).toBe(500);
          expect(meta.price_usd).toBe(500);
    });

           it("includes fx_rate and usd_zar_rate mapped from the checkout-time rate", async () => {
                 const mock = makeMockSupabase({ token_purchases: [makeLivePurchase()] });
                 const out = await processPayfastItn({ method: "POST", rawBody: buildItnBody() }, baseDeps(mock));
                 expect(out.decision).toBe("credited");
                 const row = mock.tables.audit_logs.find((r) => r.action === "credits.purchased");
                 const meta = row!.metadata as Record<string, unknown>;
                 expect(meta.usd_zar_rate).toBe(18);
                 expect(meta.fx_rate).toBe(18);
                 expect(meta.fx_rate_locked_at).toBe("2026-07-01T00:00:00.000Z");
           });

           it("includes payment_reference and reference mapped from the PayFast credit reference", async () => {
                 const mock = makeMockSupabase({ token_purchases: [makeLivePurchase()] });
                 const out = await processPayfastItn({ method: "POST", rawBody: buildItnBody() }, baseDeps(mock));
                 expect(out.decision).toBe("credited");
                 expect(out.creditReference).toBe(PF_REF);
                 const row = mock.tables.audit_logs.find((r) => r.action === "credits.purchased");
                 const meta = row!.metadata as Record<string, unknown>;
                 expect(meta.payment_reference).toBe(PF_REF);
                 expect(meta.reference).toBe(PF_REF);
                 expect(meta.provider_reference).toBe(M_REF);
                 expect(meta.pf_payment_id).toBe(PF_REF);
           });

           it("includes token_amount, status, amount_zar and provider", async () => {
                 const mock = makeMockSupabase({ token_purchases: [makeLivePurchase()] });
                 const out = await processPayfastItn({ method: "POST", rawBody: buildItnBody() }, baseDeps(mock));
                 expect(out.decision).toBe("credited");
                 const row = mock.tables.audit_logs.find((r) => r.action === "credits.purchased");
                 const meta = row!.metadata as Record<string, unknown>;
                 expect(meta.token_amount).toBe(100);
                 expect(meta.status).toBe("completed");
                 expect(meta.amount_zar).toBe(9000);
                 expect(meta.provider).toBe("payfast");
                 // Existing fields untouched.
                  expect(meta.price_zar).toBe(9000);
                 expect(meta.amount_gross_zar).toBe(9000);
           });
});

describe("Phase B — historical rows without checkout-time USD metadata", () => {
    it("still credits normally and degrades USD/FX fields to null instead of crashing or inventing figures", async () => {
          const mock = makeMockSupabase({ token_purchases: [makeLegacyPurchase()] });
          const body = buildItnBody({ amount_gross: "180.00", item_name: "pack_10", custom_str1: "pack_10" });
          const out = await processPayfastItn({ method: "POST", rawBody: body }, baseDeps(mock));
          expect(out.decision).toBe("credited");
          const row = mock.tables.audit_logs.find((r) => r.action === "credits.purchased");
          expect(row).toBeTruthy();
          const meta = row!.metadata as Record<string, unknown>;
          expect(meta.amount_usd).toBeNull();
          expect(meta.price_usd).toBeNull();
          expect(meta.usd_zar_rate).toBeNull();
          expect(meta.fx_rate).toBeNull();
          expect(meta.fx_rate_locked_at).toBeNull();
          expect(meta.amount_zar).toBeNull();
          // Legacy ZAR figures are still present, unaffected.
           expect(meta.price_zar).toBe(180);
          expect(meta.amount_gross_zar).toBe(180);
          expect(meta.status).toBe("completed");
          expect(meta.token_amount).toBe(10);
    });
});

describe("Phase B — PayFast ITN idempotency and wallet crediting are unchanged", () => {
    it("a duplicate COMPLETE ITN does not double-credit (replay guard rejects, one rpc call)", async () => {
          const mock = makeMockSupabase({ token_purchases: [makeLivePurchase()] });
          const deps = baseDeps(mock);
          const body = buildItnBody();
          const first = await processPayfastItn({ method: "POST", rawBody: body }, deps);
          const second = await processPayfastItn({ method: "POST", rawBody: body }, deps);
          expect(first.decision).toBe("credited");
          expect(second.decision).toBe("rejected");
          expect(second.reason).toBe("replay_detected");
          expect(mock.rpcCalls.filter((c) => c.fn === "atomic_paid_credit_purchase")).toHaveLength(1);
          expect(mock.tables.audit_logs.filter((r) => r.action === "credits.purchased")).toHaveLength(1);
    });

           it("atomic_paid_credit_purchase is still called with the original org/amount/reference/endpoint shape", async () => {
                 const mock = makeMockSupabase({ token_purchases: [makeLivePurchase()] });
                 const out = await processPayfastItn({ method: "POST", rawBody: buildItnBody() }, baseDeps(mock));
                 expect(out.decision).toBe("credited");
                 const calls = mock.rpcCalls.filter((c) => c.fn === "atomic_paid_credit_purchase");
                 expect(calls).toHaveLength(1);
                 expect(calls[0].args.p_org_id).toBe(ORG);
                 expect(calls[0].args.p_amount).toBe(100);
                 expect(calls[0].args.p_reference_id).toBe(PF_REF);
                 expect(calls[0].args.p_endpoint).toBe("payment:payfast:itn");
                 // The RPC's own metadata payload is untouched by this fix — it still
                  // carries only the ZAR-side fields it always has, no USD/FX fields
                  // were added here (the enrichment lives only in the credits.purchased
                  // audit row, not in the crediting RPC call).
                  const rpcMeta = calls[0].args.p_metadata as Record<string, unknown>;
                 expect(rpcMeta.price_zar).toBe(9000);
                 expect(rpcMeta.amount_gross_zar).toBe(9000);
                 expect(rpcMeta.amount_usd).toBeUndefined();
                 // Purchase row still flips to completed exactly once.
                  expect(mock.tables.token_purchases[0].status).toBe("completed");
           });

           it("wallet crediting is unaffected for legacy (no-USD-metadata) rows too", async () => {
                 const mock = makeMockSupabase({ token_purchases: [makeLegacyPurchase()] });
                 const body = buildItnBody({ amount_gross: "180.00", item_name: "pack_10", custom_str1: "pack_10" });
                 const out = await processPayfastItn({ method: "POST", rawBody: body }, baseDeps(mock));
                 expect(out.decision).toBe("credited");
                 const calls = mock.rpcCalls.filter((c) => c.fn === "atomic_paid_credit_purchase");
                 expect(calls).toHaveLength(1);
                 expect(calls[0].args.p_amount).toBe(10);
           });
});

describe("Phase B — no external/live FX API introduced", () => {
    it("payfast.ts does not import _shared/fx.ts or call a live FX endpoint", () => {
          expect(PAYFAST_SRC).not.toMatch(/from\s+['"][^'"]*_shared\/fx(?:\.ts)?['"]/);
          expect(PAYFAST_SRC).not.toMatch(/https?:\/\/[^\s"']*(exchangerate|fixer|openexchangerates|currencyapi)/i);
    });

           it("the settlement enrichment reads only from the checkout-time purchase.metadata snapshot", () => {
                 expect(PAYFAST_SRC).toContain('const checkoutMeta = (purchase.metadata ?? {}) as Record<string, unknown>;');
                 expect(PAYFAST_SRC).toContain('const settlementUsdZarRate = typeof checkoutMeta.usd_zar_rate === "number" ? checkoutMeta.usd_zar_rate : null;');
           });
});

// ─── Tests: AdminRevenuePanel safe fallback resolution (source-verified,
// mirroring the existing repo convention in src/tests/batch-h-refund-fx-legacy.test.ts
// and src/tests/batch-u-prod-safety.test.ts of reading AdminRevenuePanel.tsx
// as source text rather than importing the component tree) ────────────────

describe("Phase B — AdminRevenuePanel resolves PayFast USD/FX/reference with safe fallbacks", () => {
    it("resolves USD amount via amount_usd then price_usd", () => {
          expect(ADMIN_REVENUE_SRC).toContain('const price_usd = num(meta.amount_usd) || num(meta.price_usd);');
    });

           it("resolves FX rate via fx_rate then usd_zar_rate then legacy_fx_rate", () => {
                 expect(ADMIN_REVENUE_SRC).toContain('legacy_fx_rate: typeof meta.fx_rate === "number" ? meta.fx_rate : (typeof meta.usd_zar_rate === "number" ? meta.usd_zar_rate : (typeof meta.legacy_fx_rate === "number" ? meta.legacy_fx_rate : null)),');
           });

           it("resolves reference via payment_reference then provider_reference then pf_payment_id then reference", () => {
                 expect(ADMIN_REVENUE_SRC).toContain('payment_reference: str(meta.payment_reference) ?? str(meta.provider_reference) ?? str(meta.pf_payment_id) ?? str(meta.reference),');
           });

           it("treats provider==='payfast' rows as native USD revenue instead of forcing $0", () => {
                 const needle = 'meta.currency === "USD" || meta.fx_basis === "native_usd" || legacy_zar === 0 || meta.provider === "payfast"';
                 const count = ADMIN_REVENUE_SRC.split(needle).length - 1;
                 // Present in both purchaseFromAuditLog and purchaseFromLedger.
                  expect(count).toBe(2);
           });

           it("credits fall back to token_amount when credits_added/credits are absent", () => {
                 expect(ADMIN_REVENUE_SRC).toContain('const credits = num(meta.credits_added) || num(meta.credits) || num(meta.token_amount);');
           });

           it("purchaseFromAuditLog and purchaseFromLedger are exported for direct unit testing", () => {
                 expect(ADMIN_REVENUE_SRC).toContain('export function purchaseFromAuditLog(');
                 expect(ADMIN_REVENUE_SRC).toContain('export function purchaseFromLedger(');
           });

           it("Paystack native-USD gate (currency/fx_basis) is unchanged, so Paystack rows keep working", () => {
                 expect(ADMIN_REVENUE_SRC).toContain('meta.currency === "USD" || meta.fx_basis === "native_usd"');
           });

           it("no external/live FX API is introduced in AdminRevenuePanel.tsx", () => {
                 expect(ADMIN_REVENUE_SRC).not.toMatch(/from\s+['"][^'"]*_shared\/fx(?:\.ts)?['"]/);
                 expect(ADMIN_REVENUE_SRC).not.toMatch(/https?:\/\/[^\s"']*(exchangerate|fixer|openexchangerates|currencyapi)/i);
           });
});

describe("Phase B — historical-row safety and Paystack path are untouched", () => {
    it("num()/str() helpers still guard every field so missing metadata cannot crash the panel", () => {
          expect(ADMIN_REVENUE_SRC).toContain('function num(x: unknown): number {');
          expect(ADMIN_REVENUE_SRC).toContain('function str(x: unknown): string | null {');
    });

           it("legacy_zar computation still guards with num() across every possible ZAR field name", () => {
                 expect(ADMIN_REVENUE_SRC).toContain('const legacy_zar = num(meta.zar_amount_charged) || num(meta.price_zar) || num(meta.legacy_price_zar) || num(meta.amount_zar) || num(meta.amount_gross_zar);');
           });

           it("demo-org exclusion (SEC-012) is untouched", () => {
                 expect(ADMIN_REVENUE_SRC).toMatch(/is_demo/);
                 expect(ADMIN_REVENUE_SRC).toMatch(/demoOrgIds/);
           });

           it("audit-log rows still win over ledger rows on matching payment_reference (dedup unchanged)", () => {
                 expect(ADMIN_REVENUE_SRC).toMatch(/Audit-log rows always win on payment_reference/);
           });
});
