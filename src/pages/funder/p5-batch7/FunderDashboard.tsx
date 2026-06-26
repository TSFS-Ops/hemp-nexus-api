/**
 * P-5 Batch 7 — Phase 4
 * Funder Dashboard (funder surface, read-only).
 *
 * Visibility model (Phase 4):
 *   - Route-gated via RequireAuth. The Phase 3 RPC enforces the coarse
 *     server-side scope (funder_status IS NOT NULL on the projection).
 *   - This is an explicit interim limitation: a per-case funder grant
 *     table does not yet exist, so the UI assumes the projection has
 *     already filtered the case set to funder-visible cases.
 *   - Internal notes, raw provider payloads, Memory internals, other
 *     funders' decisions and other organisations' records are never
 *     rendered here (enforced by the Phase 3 projection + Phase 4 guard).
 *
 * This limitation is documented in the Batch 7 evidence README and MUST
 * be tightened in Phase 5/6 once per-case funder grants are modelled.
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

export default function P5Batch7FunderDashboard() {
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

  return (
    <P5B7DashboardShell
      dashboard="funder_dashboard"
      banner={
        <div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
          Released for authorised funder review only. Visibility is coarse during
          Phase 4 (funder-tagged cases only) and will be tightened to per-case
          grants in a later phase. Other organisations' records, internal notes,
          raw evidence and Memory internals are not shown here.
        </div>
      }
    >
      <P5B7StaleDataBanner dashboard="funder_dashboard" asOf={env?.as_of ?? null} isStale={env?.is_stale ?? false} />
      <P5B7SummaryCards
        cards={[
          { label: "Visible cases", value: rows.length },
          {
            label: "In review",
            value: rows.filter((r) => r.case_status === "in_review").length,
          },
          {
            label: "On hold",
            value: rows.filter((r) => r.case_status === "on_hold").length,
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
        placeholder="Filter funder cases…"
        rightSlot={<P5B7SavedViewSelector views={[]} value={view} onChange={setView} disabled />}
      />
      <P5B7DetailSection title="Funder-visible cases" description="Scoped server-side by the v1 API projection.">
        {loading ? (
          <P5B7Loading />
        ) : env?.error ? (
          <P5B7ErrorState message={env.error.message} />
        ) : rows.length === 0 ? (
          <P5B7Empty label="No cases currently shared with your funding workflow." />
        ) : (
          <ul className="space-y-1 text-sm">
            {rows.map((r, i) => (
              <li key={String(r.case_id ?? i)} className="border-t py-1 flex justify-between">
                <span className="font-mono text-xs">{String(r.case_reference ?? r.case_id)}</span>
                <span className="text-muted-foreground">
                  {String(r.case_status ?? "—")} · funder {String(r.funder_access_status ?? "—")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </P5B7DetailSection>
    </P5B7DashboardShell>
  );
}
