/**
 * P-5 Batch 7 — Phase 4
 * Organisation Dashboard (tenant surface, read-only).
 * Scoped server-side by the Phase 3 RPC to the caller's linked organisation.
 */
import { useEffect, useState } from "react";
import {
  P5B7DashboardShell,
  P5B7SummaryCards,
  P5B7FilterBar,
  P5B7SavedViewSelector,
  P5B7DetailSection,
  P5B7StaleDataBanner,
  P5B7Loading,
  P5B7Empty,
  P5B7ErrorState,
} from "@/components/p5-batch7/DashboardShell";
import { p5b7ApiV1ListCases, type P5Batch7ApiV1Envelope, type P5Batch7ApiV1Row } from "@/lib/p5-batch7/api-v1";

export default function P5Batch7OrgDashboard() {
  const [q, setQ] = useState("");
  const [view, setView] = useState<string | null>(null);
  const [env, setEnv] = useState<P5Batch7ApiV1Envelope<P5Batch7ApiV1Row> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    p5b7ApiV1ListCases({ limit: 50 })
      .then((e) => { if (!cancelled) setEnv(e); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const rows = (env?.data ?? []).filter((r) =>
    q ? JSON.stringify(r).toLowerCase().includes(q.toLowerCase()) : true,
  );
  const outstanding = rows.reduce(
    (n, r) => n + (typeof r.evidence_outstanding_count === "number" ? r.evidence_outstanding_count : 0),
    0,
  );

  return (
    <P5B7DashboardShell
      dashboard="org_dashboard"
      banner={
        <div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
          You are viewing only cases linked to your organisation. Other organisations'
          records, internal notes and raw evidence are not shown.
        </div>
      }
    >
      <P5B7StaleDataBanner dashboard="org_dashboard" asOf={env?.as_of ?? null} isStale={env?.is_stale ?? false} />
      <P5B7SummaryCards
        cards={[
          { label: "My cases", value: rows.length },
          { label: "Outstanding evidence", value: outstanding },
          {
            label: "Awaiting evidence",
            value: rows.filter((r) => r.case_status === "awaiting_evidence").length,
          },
          {
            label: "Resolved",
            value: rows.filter((r) => r.case_status === "resolved").length,
          },
        ]}
      />
      <P5B7FilterBar
        query={q}
        onQueryChange={setQ}
        placeholder="Filter my cases…"
        rightSlot={<P5B7SavedViewSelector views={[]} value={view} onChange={setView} disabled />}
      />
      <P5B7DetailSection title="My cases" description="Scoped to your organisation by the v1 API projection.">
        {loading ? (
          <P5B7Loading />
        ) : env?.error ? (
          <P5B7ErrorState message={env.error.message} />
        ) : rows.length === 0 ? (
          <P5B7Empty label="No cases linked to your organisation." />
        ) : (
          <ul className="space-y-1 text-sm">
            {rows.map((r, i) => (
              <li key={String(r.case_id ?? i)} className="border-t py-1 flex justify-between">
                <span className="font-mono text-xs">{String(r.case_reference ?? r.case_id)}</span>
                <span className="text-muted-foreground">{String(r.case_status ?? "—")}</span>
              </li>
            ))}
          </ul>
        )}
      </P5B7DetailSection>
    </P5B7DashboardShell>
  );
}
