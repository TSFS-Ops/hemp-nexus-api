/**
 * P-5 Batch 7 — Phase 5
 * Audit Dashboard: read append-only audit events via Phase 5 list RPC.
 */
import { useEffect, useMemo, useState } from "react";
import {
  P5B7DashboardShell,
  P5B7SummaryCards,
  P5B7FilterBar,
  P5B7DetailSection,
  P5B7Loading,
  P5B7Empty,
  P5B7ErrorState,
} from "@/components/p5-batch7/DashboardShell";
import {
  p5b7ListDashboardAudit,
  p5b7RecordDashboardAction,
  type P5B7DashboardAuditRow,
} from "@/lib/p5-batch7/actions";

const DASHBOARD = "audit_dashboard" as const;

export default function P5Batch7AuditDashboard() {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<ReadonlyArray<P5B7DashboardAuditRow>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void p5b7RecordDashboardAction({
      dashboard: DASHBOARD,
      event: "p5b7.dashboard.viewed",
      subjectKind: "dashboard",
      subjectRef: DASHBOARD,
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    p5b7ListDashboardAudit(undefined, 200)
      .then((r) => { if (!cancelled) { setRows(r); setError(null); } })
      .catch((e: Error) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(
    () => rows.filter((r) => (q ? JSON.stringify(r).toLowerCase().includes(q.toLowerCase()) : true)),
    [rows, q],
  );

  const since = Date.now() - 24 * 60 * 60 * 1000;
  const last24 = rows.filter((r) => Date.parse(r.created_at) >= since).length;
  const views = rows.filter((r) => r.event_name === "p5b7.dashboard.viewed").length;
  const reveals = rows.filter((r) => r.event_name === "p5b7.sensitive_field.revealed").length;
  const denied = rows.filter((r) => r.event_name === "p5b7.role_access.denied").length;

  return (
    <P5B7DashboardShell dashboard={DASHBOARD}>
      <P5B7SummaryCards
        cards={[
          { label: "Events (24h)", value: last24 },
          { label: "Dashboard views", value: views },
          { label: "Sensitive reveals", value: reveals },
          { label: "Access denied", value: denied },
        ]}
      />
      <P5B7FilterBar query={q} onQueryChange={setQ} placeholder="Filter audit events…" />
      <P5B7DetailSection title="Recent audit events" description="Append-only governance event log.">
        {loading ? (
          <P5B7Loading />
        ) : error ? (
          <P5B7ErrorState message={error} />
        ) : filtered.length === 0 ? (
          <P5B7Empty />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="text-left py-1">When</th>
                  <th className="text-left py-1">Dashboard</th>
                  <th className="text-left py-1">Event</th>
                  <th className="text-left py-1">Subject</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.audit_id} className="border-t">
                    <td className="py-1 text-xs text-muted-foreground">{r.created_at}</td>
                    <td className="py-1">{r.dashboard}</td>
                    <td className="py-1 font-mono text-xs">{r.event_name}</td>
                    <td className="py-1 text-xs">
                      {r.subject_kind ? `${r.subject_kind}:${r.subject_ref ?? "—"}` : "—"}
                    </td>
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
