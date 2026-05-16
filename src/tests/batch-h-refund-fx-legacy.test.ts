/**
 * Batch H — Refund hardening, FX retirement guard, legacy-row separation.
 *
 * Static / source-level verification (mirrors Batch C/D/G patterns). Covers
 * the 16 acceptance items in the Batch H brief:
 *
 *   1.  Paystack init posts currency USD.
 *   2.  Paystack init amount = price_usd * 100.
 *   3.  /packages returns currency USD and fxBasis native_usd.
 *   4.  No live payment function imports _shared/fx.ts.
 *   5.  _shared/fx.ts is deprecated if retained.
 *   6.  Pricing page does not show ZAR for current packages.
 *   7.  charge.success rejects currency mismatch.
 *   8.  charge.success rejects amount mismatch.
 *   9.  refund.processed writes one credit_refund ledger row for a full refund.
 *  10.  refund.processed writes one credits.refunded audit row.
 *  11.  Duplicate refund (same signature/replay) does not deduct twice.
 *  12.  Duplicate refund (same reference / new signature) returns idempotent success.
 *  13.  Unmatched refund creates risk item and does not mutate balance.
 *  14.  Partial refund creates manual-review risk item and does not mutate balance.
 *  15.  AdminRevenuePanel excludes legacy ZAR from USD totals.
 *  16.  HQ label says USD revenue · legacy ZAR preserved.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

const read = (p: string) => readFileSync(resolve(p), "utf8");

const TOKEN_PURCHASE = read("supabase/functions/token-purchase/index.ts");
const FX = read("supabase/functions/_shared/fx.ts");
const REVENUE_NOTIFY = read("supabase/functions/_shared/revenue-notify.ts");
const PRICING = read("src/pages/Pricing.tsx");
const HQ = read("src/pages/HQ.tsx");
const ADMIN_REVENUE = read("src/components/admin/AdminRevenuePanel.tsx");
const PACKAGE_JSON = JSON.parse(read("package.json"));

function walkFunctions(): string[] {
  const root = resolve("supabase/functions");
  const out: string[] = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      const s = statSync(p);
      if (s.isDirectory()) stack.push(p);
      else if (/\.(ts|tsx|js|mjs)$/.test(e)) out.push(p);
    }
  }
  return out;
}

describe("Batch H — Paystack USD-native checkout", () => {
  it("1. Paystack init posts currency:'USD'", () => {
    // The initialize POST body must declare USD.
    const initBlockStart = TOKEN_PURCHASE.indexOf("transaction/initialize");
    expect(initBlockStart).toBeGreaterThan(0);
    const block = TOKEN_PURCHASE.slice(initBlockStart, initBlockStart + 1500);
    expect(block).toMatch(/currency:\s*["']USD["']/);
  });

  it("2. Paystack init amount = price_usd * 100 (USD cents)", () => {
    // The function computes `usdCents` from `pkg.price_usd` and sends it as `amount`.
    expect(TOKEN_PURCHASE).toMatch(/usdCents\s*=\s*Math\.round\(\s*pkg\.price_usd\s*\*\s*100\s*\)/);
    const initBlockStart = TOKEN_PURCHASE.indexOf("transaction/initialize");
    const block = TOKEN_PURCHASE.slice(initBlockStart, initBlockStart + 1500);
    expect(block).toMatch(/amount:\s*usdCents/);
  });

  it("3. /packages returns currency:'USD' and fxBasis:'native_usd'", () => {
    const handler = TOKEN_PURCHASE.slice(TOKEN_PURCHASE.indexOf("handleGetPackages"));
    expect(handler).toMatch(/currency:\s*["']USD["']/);
    expect(handler).toMatch(/fxBasis:\s*["']native_usd["']/);
    expect(handler).toMatch(/settlementCurrency:\s*["']USD["']/);
  });
});

describe("Batch H — FX retirement / drift guard", () => {
  it("4. No live payment function imports _shared/fx.ts (excluding the module itself)", () => {
    const importers = walkFunctions().filter((p) => {
      if (p.endsWith("/_shared/fx.ts")) return false;
      const src = readFileSync(p, "utf8");
      return /from\s+['"][^'"]*_shared\/fx(?:\.ts)?['"]/.test(src);
    });
    expect(importers).toEqual([]);
    // The token-purchase function in particular must not import fx.
    expect(TOKEN_PURCHASE).not.toMatch(/from\s+['"][^'"]*_shared\/fx/);
  });

  it("5. _shared/fx.ts is clearly marked @deprecated", () => {
    expect(FX).toMatch(/@deprecated/);
    expect(FX).toMatch(/Do NOT call these from any new payment/i);
  });

  it("5b. prebuild wires check-fx-no-importers", () => {
    const prebuild: string = PACKAGE_JSON.scripts?.prebuild ?? "";
    expect(prebuild).toMatch(/check-fx-no-importers\.mjs/);
  });
});

describe("Batch H — Pricing UI is USD-only for current packages", () => {
  it("6. Pricing page does not present ZAR/Rand pricing for credit packages", () => {
    // We allow trade-option quote currencies but the credit packages must be USD.
    expect(PRICING).toMatch(/USD/);
    expect(PRICING).not.toMatch(/\bZAR\b/);
    // No "R 1,000 per credit"-style billing strings.
    expect(PRICING).not.toMatch(/R\s?\d[\d,]*\s*(?:per|\/)?\s*credit/i);
  });
});

describe("Batch H — charge.success settlement validation", () => {
  it("7. charge.success rejects on currency mismatch", () => {
    expect(TOKEN_PURCHASE).toMatch(/expectedCurrency\.toUpperCase\(\)\s*!==\s*settledCurrency\.toUpperCase\(\)/);
    expect(TOKEN_PURCHASE).toMatch(/credits\.purchase_rejected/);
  });

  it("8. charge.success rejects on amount mismatch (>$0.01)", () => {
    expect(TOKEN_PURCHASE).toMatch(/Math\.abs\(expectedUsd\s*-\s*settledUsd\)\s*>\s*0\.01/);
  });
});

describe("Batch H — refund.processed correctness", () => {
  const REFUND = (() => {
    const start = TOKEN_PURCHASE.indexOf("async function handleRefundProcessed");
    expect(start).toBeGreaterThan(0);
    const end = TOKEN_PURCHASE.indexOf("\n// ===", start + 50);
    return TOKEN_PURCHASE.slice(start, end > 0 ? end : start + 12000);
  })();

  it("9. Full refund: promotes a single credit_refund ledger row keyed on request_id=refund_ref", () => {
    // Promotion path (canonical settlement row, mirrors credit_purchase).
    expect(REFUND).toMatch(/action_type:\s*["']credit_refund["']/);
    expect(REFUND).toMatch(/\.eq\("request_id",\s*refundRef\)/);
    expect(REFUND).toMatch(/\.eq\("action_type",\s*"credit"\)/);
  });

  it("10. Writes exactly one credits.refunded audit row (23505 tolerated)", () => {
    expect(REFUND).toMatch(/action:\s*["']credits\.refunded["']/);
    // Audit insert must be guarded — duplicate is tolerated as success, not thrown.
    expect(REFUND).toMatch(/auditErr\.code\s*!==\s*["']23505["']/);
  });

  it("11. Duplicate refund (replay) short-circuits before any deduction", () => {
    // Soft idempotency guard: SELECT credit_refund row, return early on hit.
    expect(REFUND).toMatch(/\.eq\("action_type",\s*"credit_refund"\)/);
    expect(REFUND).toMatch(/already processed.*idempotent skip/i);
    // The early-return MUST appear before the atomic_token_credit RPC call.
    const guardIdx = REFUND.search(/already processed.*idempotent skip/i);
    const rpcIdx = REFUND.indexOf('rpc("atomic_token_credit"');
    expect(guardIdx).toBeGreaterThan(0);
    expect(rpcIdx).toBeGreaterThan(guardIdx);
  });

  it("12. Duplicate refund (same reference / new signature) returns idempotent success without throwing", () => {
    // Hard guard (UNIQUE(request_id)) — caught error must NOT be re-thrown when
    // a concurrent delivery already wrote the credit_refund row.
    expect(REFUND).toMatch(/raceWinner/);
    expect(REFUND).toMatch(/concurrent delivery/i);
  });

  it("13. Unmatched refund (no matching credit_purchase) creates risk item, no balance mutation", () => {
    expect(REFUND).toMatch(/no_matching_purchase/);
    expect(REFUND).toMatch(/credits\.refund_rejected/);
    expect(REFUND).toMatch(/admin_risk_items/);
    // Validation block runs BEFORE the atomic_token_credit RPC.
    const validationIdx = REFUND.indexOf("no_matching_purchase");
    const rpcIdx = REFUND.indexOf('rpc("atomic_token_credit"');
    expect(validationIdx).toBeGreaterThan(0);
    expect(rpcIdx).toBeGreaterThan(validationIdx);
  });

  it("13b. Org mismatch on a known purchase also rejects and risk-items", () => {
    expect(REFUND).toMatch(/org_mismatch/);
  });

  it("14. Partial refund creates refund.partial_manual_review risk item, no balance mutation", () => {
    expect(REFUND).toMatch(/refund\.partial_manual_review/);
    expect(REFUND).toMatch(/credits\.refund_partial_parked/);
    // The partial-refund branch must return BEFORE atomic_token_credit.
    const partialIdx = REFUND.indexOf("refund_partial_parked");
    const rpcIdx = REFUND.indexOf('rpc("atomic_token_credit"');
    expect(partialIdx).toBeGreaterThan(0);
    expect(rpcIdx).toBeGreaterThan(partialIdx);
    // The amount comparison must use refundUsd + 0.01 < originalPriceUsd.
    expect(REFUND).toMatch(/refundUsd\s*\+\s*0\.01\s*<\s*originalPriceUsd/);
  });

  it("14b. emits credits_refunded revenue notification (idempotent by refund ref)", () => {
    expect(REFUND).toMatch(/eventType:\s*["']credits_refunded["']/);
    expect(REFUND).toMatch(/revenue-credits-refunded-\$\{refundRef\}/);
    // RevenueEventType union must include credits_refunded.
    expect(REVENUE_NOTIFY).toMatch(/credits_refunded/);
  });
});

describe("Batch H — Revenue UI legacy-row separation", () => {
  it("15. AdminRevenuePanel sets amount_usd to 0 for legacy ZAR-only rows (excludes from USD totals)", () => {
    // The deriver returns amount_usd: isNativeUsd ? price_usd : 0
    expect(ADMIN_REVENUE).toMatch(/amount_usd:\s*isNativeUsd\s*\?\s*price_usd\s*:\s*0/);
    // And the totals aggregator simply sums amount_usd.
    expect(ADMIN_REVENUE).toMatch(/out\.revenue\s*\+=\s*r\.amount_usd/);
    // settlement_currency badge distinguishes USD vs ZAR.
    expect(ADMIN_REVENUE).toMatch(/settlement_currency:\s*isNativeUsd\s*\?\s*["']USD["']\s*:\s*["']ZAR["']/);
  });

  it("16. HQ Revenue Surface label reads 'USD revenue · legacy ZAR preserved'", () => {
    expect(HQ).toMatch(/USD revenue · legacy ZAR preserved/);
    expect(HQ).not.toMatch(/· ZAR revenue,/);
  });
});
