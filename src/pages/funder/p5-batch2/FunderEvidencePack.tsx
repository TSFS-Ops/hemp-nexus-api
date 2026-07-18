/**
 * P-5 Batch 2 — Stage 5: Funder surface.
 *
 * Read-only permissioned evidence-pack viewer. Funder users may see only
 * packs they have been granted on. Personal documents and bank details are
 * masked by default. Provider-dependent items are explicitly labelled
 * "Provider-dependent — not externally verified". No raw files. No admin
 * notes. No fraud / tampering detail. No mutation actions exposed.
 */
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  fetchP5B2ReadinessSummary,
  type P5B2ReadinessSummary,
} from "@/lib/p5-batch2/summary-client";
import { maskP5B2Field } from "@/lib/p5-batch2/masking";
import { LegacyBanner } from "@/lib/funder-workspace/ui";

export default function FunderEvidencePackP5B2() {
  const [params] = useSearchParams();
  const itemIds = useMemo(() => params.getAll("item").filter(Boolean), [params]);
  const [summaries, setSummaries] = useState<P5B2ReadinessSummary[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const out: P5B2ReadinessSummary[] = [];
      for (const id of itemIds) {
        const r = await fetchP5B2ReadinessSummary({ evidence_item_id: id, viewer: "funder" });
        if (cancelled) return;
        if (r.data) out.push(r.data);
        if (r.error) setErr(r.error);
      }
      if (!cancelled) setSummaries(out);
    })();
    return () => { cancelled = true; };
  }, [itemIds]);

  return (
    <main className="container mx-auto py-8 space-y-6" data-testid="funder-evidence-pack-p5b2">
      <LegacyBanner surface="P-5 Batch 2 evidence pack" />
      <header>
        <h1 className="text-2xl font-semibold">Evidence pack</h1>
        <p className="text-slate-600 mt-1">
          Read-only view of the evidence pack you have been granted on.
          Personal and bank fields are masked. Raw files are not exposed on
          this surface.
        </p>
      </header>

      {err && <p className="text-sm text-red-600">{err}</p>}

      <section data-testid="funder-readiness-summary" className="border border-slate-200 rounded p-3 text-sm">
        Items: {summaries.length} · Blockers: {summaries.filter((s) => s.readiness_impact === "blocking").length}
      </section>

      <ul className="space-y-3" data-testid="funder-evidence-list">
        {summaries.map((s, i) => (
          <li key={i} className="border border-slate-200 rounded p-3 text-sm space-y-2">
            <div className="flex items-center justify-between">
              <div className="font-medium">{s.record_type}</div>
              <div className="text-slate-500">{s.evidence_status}</div>
            </div>
            <div data-testid="funder-provider-line" className="text-slate-700">
              {s.provider_dependency
                ? "Provider-dependent — not externally verified"
                : (s.provider_status || "—")}
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <div className="text-slate-500">Bank account</div>
                <div data-testid="funder-bank-masked">
                  {maskP5B2Field("bank_account_number", "0000000000", { viewer: "funder" })}
                </div>
              </div>
              <div>
                <div className="text-slate-500">Address</div>
                <div data-testid="funder-address-masked">
                  {maskP5B2Field("physical_address", "", { viewer: "funder" })}
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
