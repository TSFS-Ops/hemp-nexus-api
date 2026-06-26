/**
 * P-5 Batch 7 — Phase 4
 * Control Dashboard (admin surface, read-only).
 * Data via Phase 3 API v1 projection only.
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

export default function P5Batch7ControlDashboard() {
  const [q, setQ] = useState("");
  const [view, setView] = useState<string | null>(null);
  const [env, setEnv] = useState<P5Batch7ApiV1Envelope<P5Batch7ApiV1Row> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    p5b7ApiV1ListCases({ limit: 50 })
      .then((e) => { if (!cancelled) setEnv(e); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const rows = (env?.data ?? []).filter((r) =>
    q ? JSON.stringify(r).toLowerCase().includes(q.toLowerCase()) : true,
  );
  const open = rows.filter((r) => r.case_status === "in_progress").length;
  const blocked = rows.filter((r) => r.case_status === "blocked" || r.case_status === "on_hold").length;
  const resolved = rows.filter((r) => r.case_status === "resolved" || r.case_status === "closed").length;

  return (
    <P5B7DashboardShell dashboard="control_dashboard">
      <P5B7StaleDataBanner dashboard="control_dashboard" asOf={env?.as_of ?? null} isStale={env?.is_stale ?? false} />
      <P5B7SummaryCards
        cards={[
          { label: "Total cases", value: rows.length },
          { label: "In progress", value: open },
          { label: "On hold / blocked", value: blocked },
          { label: "Resolved / closed", value: resolved },
        ]}
      />
      <P5B7FilterBar
        query={q}
        onQueryChange={setQ}
        placeholder="Filter cases…"
        rightSlot={<P5B7SavedViewSelector views={[]} value={view} onChange={setView} disabled />}
      />
      <P5B7DetailSection title="Recent cases" description="Read-only snapshot from the v1 API projection.">
        {loading ? (
          <P5B7Loading />
        ) : env?.error ? (
          <P5B7ErrorState message={env.error.message} />
        ) : rows.length === 0 ? (
          <P5B7Empty />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="text-left py-1">Reference</th>
                  <th className="text-left py-1">Status</th>
                  <th className="text-left py-1">Stage</th>
                  <th className="text-left py-1">Updated</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={String(r.case_id ?? i)} className="border-t">
                    <td className="py-1 font-mono text-xs">{String(r.case_reference ?? r.case_id ?? "—")}</td>
                    <td className="py-1">{String(r.case_status ?? "—")}</td>
                    <td className="py-1">{String(r.case_stage ?? "—")}</td>
                    <td className="py-1 text-xs text-muted-foreground">{String(r.case_updated_at ?? "—")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </P5B7DetailSection>
    </P5B7DashboardShell>
  );
}
