/**
 * P-5 Batch 7 — Phase 4
 * Compliance Dashboard (admin surface, read-only).
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

export default function P5Batch7ComplianceDashboard() {
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
  const blockedFinality = rows.filter((r) => r.finality_is_blocked === true).length;
  const inReview = rows.filter((r) => r.case_status === "in_review").length;
  const onHold = rows.filter((r) => r.case_status === "on_hold").length;
  const outstandingEvidence = rows.reduce(
    (n, r) => n + (typeof r.evidence_outstanding_count === "number" ? r.evidence_outstanding_count : 0),
    0,
  );

  return (
    <P5B7DashboardShell dashboard="compliance_dashboard">
      <P5B7StaleDataBanner dashboard="compliance_dashboard" asOf={env?.as_of ?? null} isStale={env?.is_stale ?? false} />
      <P5B7SummaryCards
        cards={[
          { label: "Finality blocked", value: blockedFinality },
          { label: "In review", value: inReview },
          { label: "On hold", value: onHold },
          { label: "Outstanding evidence", value: outstandingEvidence },
        ]}
      />
      <P5B7FilterBar
        query={q}
        onQueryChange={setQ}
        placeholder="Filter compliance cases…"
        rightSlot={<P5B7SavedViewSelector views={[]} value={view} onChange={setView} disabled />}
      />
      <P5B7DetailSection title="Compliance review queue" description="Cases currently in compliance scope (read-only).">
        {loading ? (
          <P5B7Loading />
        ) : env?.error ? (
          <P5B7ErrorState message={env.error.message} />
        ) : rows.length === 0 ? (
          <P5B7Empty />
        ) : (
          <ul className="space-y-1 text-sm">
            {rows.map((r, i) => (
              <li key={String(r.case_id ?? i)} className="border-t py-1 flex justify-between">
                <span className="font-mono text-xs">{String(r.case_reference ?? r.case_id)}</span>
                <span className="text-muted-foreground">
                  {String(r.case_status ?? "—")} · finality {String(r.finality_status ?? "—")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </P5B7DetailSection>
    </P5B7DashboardShell>
  );
}
