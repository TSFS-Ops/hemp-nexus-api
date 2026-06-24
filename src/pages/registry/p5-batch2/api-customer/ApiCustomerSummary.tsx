/**
 * P-5 Batch 2 — Stage 5: API-customer surface.
 *
 * Mirrors the safe API JSON shape. No raw files; no full ID/passport, bank,
 * tax or personal address values; no reviewer notes; no fraud/suspicion
 * flags; no internal risk scores; no provider raw responses; no other party
 * private evidence. Read-only. No mutation actions.
 *
 * Consumes only the Stage 3 scoped summary edge function via summary-client.
 */
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  fetchP5B2ReadinessSummary,
  type P5B2ReadinessSummary,
} from "@/lib/p5-batch2/summary-client";

export default function ApiCustomerSummary() {
  const [params] = useSearchParams();
  const itemIds = useMemo(() => params.getAll("item").filter(Boolean), [params]);
  const [rows, setRows] = useState<P5B2ReadinessSummary[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const out: P5B2ReadinessSummary[] = [];
      for (const id of itemIds) {
        const r = await fetchP5B2ReadinessSummary({ evidence_item_id: id, viewer: "api_user" });
        if (cancelled) return;
        if (r.data) out.push(r.data);
        if (r.error) setErr(r.error);
      }
      if (!cancelled) setRows(out);
    })();
    return () => { cancelled = true; };
  }, [itemIds]);

  // Build the exact safe API JSON shape from the summary rows.
  const safeJson = rows.map((s) => ({
    record_id: s.record_id,
    record_type: s.record_type,
    evidence_status: s.evidence_status,
    evidence_rating: s.evidence_rating,
    readiness_impact: s.readiness_impact,
    blocker_count: s.blocker_count,
    warning_count: s.warning_count,
    expiry_warning: s.expiry_warning,
    expires_at: s.expires_at,
    provider_dependency: s.provider_dependency,
    provider_status: s.provider_status,
    provider_live: s.provider_live,
    verified_by_live_provider: s.provider_live === true && !!s.provider_result_reference,
    reason_code: s.reason_code,
    next_action: s.next_action,
    last_updated_at: s.last_updated_at,
    audit_reference: s.audit_reference,
  }));

  return (
    <main className="container mx-auto py-8 space-y-6" data-testid="api-customer-summary">
      <header>
        <h1 className="text-2xl font-semibold">API readiness summary</h1>
        <p className="text-slate-600 mt-1">
          Metadata-only view. No raw files, no full ID/bank/tax values, no
          reviewer notes, no internal risk scores, no provider raw responses.
          provider_dependency=true with provider_live=false means external
          verification has not yet completed.
        </p>
      </header>

      {err && <p className="text-sm text-red-600">{err}</p>}

      <section data-testid="api-customer-gap-output" className="border border-slate-200 rounded p-3 text-sm">
        Gaps: {rows.filter((r) => r.readiness_impact === "blocking").length}
        {" · "}Warnings: {rows.filter((r) => r.readiness_impact === "warning").length}
        {" · "}Provider-dependent: {rows.filter((r) => r.provider_dependency).length}
      </section>

      <pre
        data-testid="api-customer-safe-json"
        className="text-xs bg-slate-50 border border-slate-200 rounded p-3 overflow-auto"
      >
{JSON.stringify(safeJson, null, 2)}
      </pre>
    </main>
  );
}
