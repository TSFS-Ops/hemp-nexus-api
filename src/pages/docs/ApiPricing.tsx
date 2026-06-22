/**
 * Point 6 — API Endpoint Pricing Reference.
 *
 * Linked from the client and admin API-usage screens. Explains how
 * endpoint pricing works, separately from the usage ledger. The usage
 * ledger continues to show ACTUAL credits burned per request; this
 * page is read-only reference content sourced from the existing
 * browser SSOT at `src/lib/registry-api-artefact-pricing.ts`.
 *
 * Out of scope (deliberately, per David's Point 6 instruction):
 *   - no per-row pricing inside the usage table
 *   - no admin price editing
 *   - no change to credit-burn logic, default burn rule, or ledger
 *   - no change to token/payment/Payfast/Paystack/refund/POI/WaD/key logic
 */
import { useMemo } from "react";
import { DocsLayout } from "./DocsLayout";
import { DocEyebrow, DocH1, DocH2, DocLede, DocP, Callout, InlineCode } from "./_shared";
import {
  ARTEFACT_PRICE_BOOK,
  ARTEFACT_CATEGORIES,
  USD_PER_CREDIT,
  type ArtefactCategory,
} from "@/lib/registry-api-artefact-pricing";

const CATEGORY_LABELS: Record<ArtefactCategory, string> = {
  trading_spine: "Trading spine",
  counterparty: "Counterparty",
  poi: "Proof of Intent (POI)",
  wad: "Without a Doubt (WaD)",
  governance_compliance: "Governance & compliance",
  bankability: "Bankability",
  execution: "Execution",
  entry_exit: "Entry / exit",
  finality: "Finality",
  memory: "Memory",
};

function fmtUsd(n: number): string {
  return `$${n.toLocaleString("en-US")}`;
}

function fmtCredits(usd: number): string {
  const c = usd / USD_PER_CREDIT;
  return Number.isInteger(c) ? `${c}` : c.toFixed(2);
}

export default function ApiPricing() {
  const grouped = useMemo(() => {
    const out: Record<ArtefactCategory, typeof ARTEFACT_PRICE_BOOK[number][]> =
      Object.fromEntries(ARTEFACT_CATEGORIES.map((c) => [c, []])) as never;
    for (const row of ARTEFACT_PRICE_BOOK) out[row.category].push(row);
    return out;
  }, []);

  return (
    <DocsLayout>
      <article className="max-w-3xl" data-testid="api-pricing-reference">
        <DocEyebrow>Reference</DocEyebrow>
        <DocH1>API endpoint pricing</DocH1>
        <DocLede>
          What an API call costs when it creates, returns, updates or confirms a
          governed commercial artefact. Your usage screens show the actual
          credits burned per request; this page is the reference catalogue.
        </DocLede>

        <Callout>
          <strong>Rule.</strong> Production API calls burn credits only when
          they create, return, update or confirm a governed commercial
          artefact. <InlineCode>1 credit = USD ${USD_PER_CREDIT}.00</InlineCode>{" "}
          The base unit is one Basic POI = USD ${USD_PER_CREDIT} = 1 credit.
        </Callout>

        <DocH2 id="how-it-works">How endpoint pricing works</DocH2>
        <DocP>
          The usage screens show the actual credits burned per request, not the
          catalogue price. Non-chargeable calls (authentication, health checks,
          documentation, balance checks, sandbox calls, failed technical calls,
          unauthorised, revoked-key, invalid-scope, malformed-request, and
          no-result-no-artefact responses) are recorded as{" "}
          <InlineCode>non_billable</InlineCode> with a reason and burn zero
          credits.
        </DocP>
        <DocP>
          Variable-range artefacts (for example Authority-backed POI{" "}
          $75&ndash;$150) require an admin-resolved exact price. Out-of-range
          or unresolved variable artefacts fail closed with HTTP 409{" "}
          <InlineCode>VARIABLE_PRICE_UNRESOLVED</InlineCode> and never burn
          credits.
        </DocP>
        <DocP>
          When a production call has insufficient credits, the API returns HTTP
          402 <InlineCode>INSUFFICIENT_CREDITS</InlineCode>, no work is
          performed, no credits are burned, and the attempt is logged as
          non-chargeable with reason <InlineCode>insufficient_credits</InlineCode>.
          Negative balances are not permitted.
        </DocP>

        <DocH2 id="catalogue">Artefact catalogue</DocH2>
        <DocP>
          Prices below are the catalogue values from the Izenzo USD Artefact
          Price Book. The figure your usage ledger records for any specific
          request is the value actually burned at the moment of execution.
        </DocP>

        {ARTEFACT_CATEGORIES.map((cat) => {
          const rows = grouped[cat];
          if (!rows || rows.length === 0) return null;
          return (
            <section key={cat} className="mt-8" data-testid={`pricing-category-${cat}`}>
              <h3 className="text-[15px] font-semibold tracking-tight text-foreground mb-2">
                {CATEGORY_LABELS[cat]}
              </h3>
              <div className="border border-border rounded-md overflow-hidden">
                <table className="w-full text-[13px]">
                  <thead className="bg-muted/50">
                    <tr className="text-left text-muted-foreground">
                      <th className="px-3 py-2 font-medium">Artefact</th>
                      <th className="px-3 py-2 font-medium">Code</th>
                      <th className="px-3 py-2 font-medium text-right">USD</th>
                      <th className="px-3 py-2 font-medium text-right">Credits</th>
                      <th className="px-3 py-2 font-medium">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const usdLabel = r.variable && r.usd_price_upper
                        ? `${fmtUsd(r.usd_price)}–${fmtUsd(r.usd_price_upper)}`
                        : fmtUsd(r.usd_price);
                      const creditsLabel = r.variable && r.usd_price_upper
                        ? `${fmtCredits(r.usd_price)}–${fmtCredits(r.usd_price_upper)}`
                        : fmtCredits(r.usd_price);
                      return (
                        <tr key={r.code} className="border-t border-border align-top">
                          <td className="px-3 py-2 text-foreground">{r.label}</td>
                          <td className="px-3 py-2 font-mono text-[12px] text-muted-foreground">{r.code}</td>
                          <td className="px-3 py-2 text-right font-mono">{r.chargeable ? usdLabel : "—"}</td>
                          <td className="px-3 py-2 text-right font-mono">{r.chargeable ? creditsLabel : "—"}</td>
                          <td className="px-3 py-2 text-muted-foreground text-[12.5px]">
                            {!r.chargeable ? "Non-chargeable" : r.variable ? "Variable (admin-resolved)" : (r.notes ?? "")}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })}

        <DocH2 id="reference">Authoritative sources</DocH2>
        <DocP>
          Browser SSOT:{" "}
          <InlineCode>src/lib/registry-api-artefact-pricing.ts</InlineCode>.
          Edge mirror:{" "}
          <InlineCode>
            supabase/functions/_shared/registry-api-artefact-pricing.ts
          </InlineCode>{" "}
          (parity enforced by{" "}
          <InlineCode>
            scripts/check-registry-api-artefact-pricing-parity.mjs
          </InlineCode>
          ). This page is read-only reference content — it does not change
          burn, ledger, payment, refund, POI, WaD or key behaviour.
        </DocP>
      </article>
    </DocsLayout>
  );
}
