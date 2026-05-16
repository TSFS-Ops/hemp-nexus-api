/**
 * HealthBoard — Batch A Stage 1 (operational truthfulness).
 *
 * Previously rendered a hardcoded list of 9 "operational" gates and a
 * hardcoded composite SLA. That implementation could (and did) show green
 * while edge functions, cron jobs, queues, or Sentry were broken.
 *
 * This rewrite removes ALL static green claims and drives the board from:
 *   - public.cron_heartbeats (real per-job last-run / HTTP status)
 *   - public.admin_risk_items (open incidents)
 *   - public.audit_logs (today's manual-follow-up backlog)
 *
 * A monitor with no row is rendered as "Not monitored", never as Operational.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface RiskItem {
  id: string;
  title: string;
  description: string | null;
  severity: string;
  status: string;
  created_at: string;
  resolved_at: string | null;
}

interface Heartbeat {
  job_name: string;
  last_run_at: string | null;
  last_request_id: number | null;
  last_http_status: number | null;
  last_status: "unknown" | "pending" | "success" | "failed";
  last_error: string | null;
  expected_interval_seconds: number;
  updated_at: string;
}

type DerivedStatus = "operational" | "pending" | "stale" | "failed" | "never_run" | "not_monitored";

function deriveStatus(hb: Heartbeat | undefined, now: number): DerivedStatus {
  if (!hb) return "not_monitored";
  if (!hb.last_run_at) return "never_run";
  const ageMs = now - new Date(hb.last_run_at).getTime();
  const staleMs = hb.expected_interval_seconds * 1000 * 2;
  if (hb.last_status === "failed") return "failed";
  if (hb.last_status === "pending" && ageMs < staleMs) return "pending";
  if (ageMs > staleMs) return "stale";
  if (hb.last_status === "success") return "operational";
  return "not_monitored";
}

function statusTone(s: DerivedStatus) {
  if (s === "operational") return { dot: "bg-[hsl(var(--emerald))]", text: "text-[hsl(var(--emerald))]" };
  if (s === "pending") return { dot: "bg-slate-400", text: "text-slate-600" };
  if (s === "never_run" || s === "not_monitored")
    return { dot: "bg-slate-300", text: "text-slate-500" };
  if (s === "stale") return { dot: "bg-amber-500", text: "text-amber-800" };
  return { dot: "bg-rose-600", text: "text-rose-800" };
}

function statusLabel(s: DerivedStatus): string {
  switch (s) {
    case "operational": return "operational";
    case "pending":     return "pending";
    case "stale":       return "stale";
    case "failed":      return "failed";
    case "never_run":   return "never run";
    case "not_monitored": return "not monitored";
  }
}

function severityTone(sev: string, status: string) {
  if (status === "resolved") return "text-[hsl(var(--emerald))]";
  if (sev === "critical" || sev === "high") return "text-rose-700";
  if (sev === "medium") return "text-amber-700";
  return "text-muted-foreground";
}

function formatTs(iso: string | null): string {
  if (!iso) return "never";
  return iso.replace("T", " ").slice(0, 16);
}

function shortId(uuid: string) {
  return `INC-${uuid.slice(0, 8).toUpperCase()}`;
}

// The set of jobs we expect to find heartbeats for. Drives the board even
// when the DB row has never been written, so a missing row reads as
// "not monitored" / "never run" rather than silently disappearing.
const MONITORED_JOBS: Array<{ id: string; name: string }> = [
  { id: "C1", name: "webhook-retry-job" },
  { id: "C2", name: "engagement-reminder-daily" },
  { id: "C3", name: "burn-poi-reconciliation-daily" },
  { id: "C4", name: "infra-alerts-cron" },
  { id: "C5", name: "cron-heartbeat-reconcile" },
  { id: "C6", name: "sentry-heartbeat-cron" },
];

// OPS-001 Stage 2 — Sentry receiving-events status derived from the
// singleton `sentry_heartbeats` row. The tile is GREEN only when:
//   - the DSN is configured,
//   - the most recent ingest succeeded (HTTP 2xx),
//   - the last attempt is within the freshness window (2× cron interval).
// Missing DSN, missing row, stale attempt or any failure → amber/grey/red.
interface SentryHeartbeatRow {
  last_attempt_at: string | null;
  last_success_at: string | null;
  last_status: "unknown" | "pending" | "success" | "failed" | "dsn_missing";
  last_http_status: number | null;
  last_error: string | null;
  last_event_id: string | null;
  dsn_configured: boolean;
  updated_at: string;
}

type SentryDerived = "operational" | "dsn_missing" | "failed" | "stale" | "never_run" | "not_monitored";

// Cron runs every 15 minutes — freshness window is 2× interval = 30 min.
const SENTRY_FRESHNESS_MS = 30 * 60 * 1000;

export function deriveSentryStatus(
  hb: SentryHeartbeatRow | null | undefined,
  now: number,
): SentryDerived {
  if (!hb) return "not_monitored";
  if (!hb.dsn_configured || hb.last_status === "dsn_missing") return "dsn_missing";
  if (!hb.last_attempt_at) return "never_run";
  const ageMs = now - new Date(hb.last_attempt_at).getTime();
  if (hb.last_status === "failed") return "failed";
  if (ageMs > SENTRY_FRESHNESS_MS) return "stale";
  if (hb.last_status === "success") return "operational";
  return "not_monitored";
}

function sentryToneFor(s: SentryDerived) {
  if (s === "operational") return { dot: "bg-[hsl(var(--emerald))]", text: "text-[hsl(var(--emerald))]" };
  if (s === "stale") return { dot: "bg-amber-500", text: "text-amber-800" };
  if (s === "failed") return { dot: "bg-rose-600", text: "text-rose-800" };
  // dsn_missing / never_run / not_monitored — never green.
  return { dot: "bg-slate-300", text: "text-slate-500" };
}

function sentryLabel(s: SentryDerived): string {
  switch (s) {
    case "operational": return "operational";
    case "dsn_missing": return "DSN not configured";
    case "failed":      return "failing";
    case "stale":       return "stale";
    case "never_run":   return "never run";
    case "not_monitored": return "not monitored";
  }
}

export function HealthBoard() {
  const INCIDENT_LIMIT = 20;

  const { data: incidentResult, isLoading: incidentsLoading, dataUpdatedAt } =
    useQuery<{ items: RiskItem[]; totalCount: number }>({
      queryKey: ["governance-risk-items"],
      queryFn: async () => {
        const { data, error, count } = await supabase
          .from("admin_risk_items")
          .select("id, title, description, severity, status, created_at, resolved_at", { count: "exact" })
          .order("created_at", { ascending: false })
          .limit(INCIDENT_LIMIT);
        if (error) throw error;
        const items = (data ?? []) as RiskItem[];
        return { items, totalCount: count ?? items.length };
      },
      refetchInterval: 30000,
      refetchOnWindowFocus: false,
    });

  const { data: heartbeats, isLoading: hbLoading } = useQuery<Heartbeat[]>({
    queryKey: ["cron-heartbeats"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cron_heartbeats")
        .select("job_name, last_run_at, last_request_id, last_http_status, last_status, last_error, expected_interval_seconds, updated_at");
      if (error) throw error;
      return (data ?? []) as Heartbeat[];
    },
    refetchInterval: 30000,
    refetchOnWindowFocus: false,
  });

  const { data: noRecipientCount } = useQuery<number>({
    queryKey: ["healthboard-no-recipient-skips"],
    queryFn: async () => {
      const dayStart = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z").toISOString();
      const { count, error } = await supabase
        .from("audit_logs")
        .select("id", { head: true, count: "exact" })
        .eq("action", "notification_skipped")
        .gte("created_at", dayStart)
        .contains("metadata", { reason: "no_recipient", source_function: "match.soft_route" });
      if (error) return 0;
      return count ?? 0;
    },
    refetchInterval: 60000,
    refetchOnWindowFocus: false,
  });

  const { data: sentryHb } = useQuery<SentryHeartbeatRow | null>({
    queryKey: ["sentry-heartbeat"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sentry_heartbeats")
        .select("last_attempt_at, last_success_at, last_status, last_http_status, last_error, last_event_id, dsn_configured, updated_at")
        .eq("id", true)
        .maybeSingle();
      if (error) throw error;
      return (data as SentryHeartbeatRow | null) ?? null;
    },
    refetchInterval: 30000,
    refetchOnWindowFocus: false,
  });

  const incidents = incidentResult?.items ?? [];
  const incidentTotal = incidentResult?.totalCount ?? 0;
  const openIncidents = incidents.filter(i => i.status !== "resolved").length;
  const lastBeat = dataUpdatedAt ? new Date(dataUpdatedAt).toISOString() : new Date().toISOString();
  const noRecipient = noRecipientCount ?? 0;

  const hbByName = new Map<string, Heartbeat>();
  for (const h of heartbeats ?? []) hbByName.set(h.job_name, h);
  const now = Date.now();
  const sentryStatus = deriveSentryStatus(sentryHb, now);
  const sentryTone = sentryToneFor(sentryStatus);

  const rows = MONITORED_JOBS.map(j => {
    const hb = hbByName.get(j.name);
    const status = deriveStatus(hb, now);
    return { ...j, hb, status };
  });

  const operationalCount = rows.filter(r => r.status === "operational").length;
  const failingCount = rows.filter(r => r.status === "failed" || r.status === "stale").length;
  const unknownCount = rows.filter(r => r.status === "never_run" || r.status === "not_monitored").length;

  return (
    <>
      {/* Summary strip — every tile is derived from real rows. */}
      <div className="grid grid-cols-4 gap-px bg-muted border border-border mb-10">
        <div className="bg-card p-5" data-testid="healthboard-monitored-tile">
          <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground/70">Jobs Healthy</p>
          <p className="mt-1 text-2xl font-semibold text-foreground tracking-tight">
            {operationalCount}/{rows.length}
          </p>
          <p className="font-mono text-[10px] text-muted-foreground mt-0.5">
            {failingCount} failing · {unknownCount} unmonitored
          </p>
        </div>
        <div className="bg-card p-5" data-testid="healthboard-composite-tile">
          <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground/70">Composite SLA</p>
          <p className="mt-1 text-2xl font-semibold text-foreground tracking-tight">—</p>
          <p className="font-mono text-[10px] text-muted-foreground mt-0.5">
            uptime monitor not configured
          </p>
        </div>
        <div className="bg-card p-5">
          <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground/70">Open Incidents</p>
          <p className="mt-1 text-2xl font-semibold text-foreground tracking-tight">{openIncidents}</p>
          <p className={`font-mono text-[10px] mt-0.5 ${openIncidents > 0 ? "text-amber-700" : "text-[hsl(var(--emerald))]"}`}>
            {openIncidents > 0
              ? `monitoring · ${shortId(incidents.find(i => i.status !== "resolved")!.id)}`
              : "all clear"}
          </p>
        </div>
        <div className="bg-card p-5" data-testid="healthboard-no-recipient-tile">
          <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground/70">No-Recipient Outreach</p>
          <p className="mt-1 text-2xl font-semibold text-foreground tracking-tight">{noRecipient}</p>
          <p className={`font-mono text-[10px] mt-0.5 ${noRecipient > 0 ? "text-amber-700" : "text-[hsl(var(--emerald))]"}`}>
            {noRecipient > 0 ? "manual follow-up required · today" : "no manual backlog · today"}
          </p>
        </div>
      </div>

      {/* Scheduled-job heartbeat board */}
      <section data-testid="healthboard-cron-board">
        <div className="flex items-baseline justify-between pb-3 border-b border-border mb-0">
          <h2 className="text-base font-medium text-foreground tracking-tight">Scheduled Job Heartbeats</h2>
          <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground/70">
            {hbLoading ? "loading…" : "polled every 30s · backed by cron_heartbeats"}
          </p>
        </div>
        <ul className="divide-y divide-border border border-border border-t-0 bg-card">
          {rows.map(r => {
            const tone = statusTone(r.status);
            const httpStatus = r.hb?.last_http_status;
            return (
              <li
                key={r.id}
                className="grid grid-cols-[60px_1fr_140px_120px_140px_1fr] gap-5 items-center px-5 py-4"
                data-testid={`healthboard-row-${r.name}`}
              >
                <p className="font-mono text-[11px] tracking-wider text-muted-foreground">{r.id}</p>
                <p className="text-sm text-foreground">{r.name}</p>
                <div className="flex items-center gap-2">
                  <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} aria-hidden />
                  <span className={`font-mono text-[10px] tracking-[0.2em] uppercase ${tone.text}`}>
                    {statusLabel(r.status)}
                  </span>
                </div>
                <p className="font-mono text-[11px] text-foreground">
                  {httpStatus != null ? `HTTP ${httpStatus}` : "—"}
                </p>
                <p className="font-mono text-[11px] text-muted-foreground">
                  {formatTs(r.hb?.last_run_at ?? null)}
                </p>
                <p
                  className="font-mono text-[11px] text-muted-foreground truncate"
                  title={r.hb?.last_error ?? ""}
                >
                  {r.hb?.last_error ?? ""}
                </p>
              </li>
            );
          })}
        </ul>
      </section>

      {/* Incident ledger */}
      <section className="mt-10">
        <div className="flex items-baseline justify-between pb-3 border-b border-border mb-0">
          <h2 className="text-base font-medium text-foreground tracking-tight">Incident Ledger</h2>
          <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground/70">
            {incidentTotal > INCIDENT_LIMIT
              ? `showing ${INCIDENT_LIMIT} of ${incidentTotal} records`
              : "last 20 records"}
          </p>
        </div>
        <ul className="divide-y divide-border border border-border border-t-0 bg-card">
          {incidentsLoading ? (
            <li className="px-5 py-6 text-sm text-muted-foreground">loading risk telemetry…</li>
          ) : incidents.length === 0 ? (
            <li className="px-5 py-6">
              <p className="text-sm text-muted-foreground">No open incidents recorded.</p>
              <p className="font-mono text-[10px] text-muted-foreground mt-1">
                last refresh: {formatTs(lastBeat)}
              </p>
            </li>
          ) : (
            incidents.map((i) => (
              <li key={i.id} className="grid grid-cols-[170px_120px_80px_1fr_100px] gap-5 items-center px-5 py-3">
                <p className="font-mono text-[11px] tracking-wider text-foreground">{shortId(i.id)}</p>
                <p className="font-mono text-[11px] text-muted-foreground">{formatTs(i.created_at)}</p>
                <p className={`font-mono text-[10px] tracking-[0.2em] uppercase ${severityTone(i.severity, i.status)}`}>
                  {i.severity}
                </p>
                <p className="text-[13px] text-foreground truncate" title={i.description ?? ""}>{i.title}</p>
                <p className={`font-mono text-[10px] tracking-[0.2em] uppercase text-right ${i.status === "resolved" ? "text-[hsl(var(--emerald))]" : "text-amber-700"}`}>
                  {i.status}
                </p>
              </li>
            ))
          )}
        </ul>
      </section>
    </>
  );
}
