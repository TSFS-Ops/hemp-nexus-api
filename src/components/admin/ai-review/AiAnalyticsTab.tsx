/**
 * AI Light-Intel — Phase 6 Analytics tab.
 *
 * Admin-only operational analytics for the AI review workspace.
 *
 * Data sources (read-only, existing tables — no new schema):
 *   - ai_proposed_matches   → searches/found/approved/rejected/reasons/confidence
 *   - ai_outreach_drafts_v2 → drafts/sent/outcomes/bounce/reply rates
 *   - ai_intel_tasks        → failed searches (kind=provider_failure_review)
 *   - ai_call_meter         → provider calls per day & call_type
 *   - ai_provider_state     → cooldown / last error state
 *
 * Guardrails:
 *   - No raw AI payloads / source snippets / internal notes shown.
 *   - Confidence wording is "Discovery Confidence" / "AI Intel Confidence".
 *     Never "Verified".
 *   - Provider $ cost: "Not configured" unless an admin setting exists.
 *     We do NOT hard-code per-call pricing.
 *   - Operational analytics only. Not compliance analytics.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Info, AlertTriangle } from "lucide-react";

type ProposedRow = {
  id: string;
  status: string;
  confidence_level: string | null;
  confidence_override: string | null;
  feedback_reason: string | null;
  rejection_reason: string | null;
  client_visible: boolean | null;
  created_at: string;
  trade_request_id: string | null;
  suggested_country: string | null;
};

type DraftRow = {
  id: string;
  draft_status: string;
  outcome: string | null;
  sent_at: string | null;
  created_at: string;
};

type TaskRow = {
  id: string;
  status: string;
  description: string | null;
  created_at: string;
};

type MeterRow = { call_type: string; day: string; count: number };
type ProviderStateRow = {
  provider: string;
  last_status: string | null;
  last_status_code: number | null;
  last_error: string | null;
  cooldown_until: string | null;
  updated_at: string;
};

const CONFIDENCE_TO_SCORE: Record<string, number> = {
  low: 25,
  medium: 50,
  high: 80,
  very_high: 95,
};

export function AiAnalyticsTab() {
  const today = new Date();
  const defaultFrom = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const defaultTo = today.toISOString().slice(0, 10);
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);

  const fromIso = useMemo(() => new Date(from + "T00:00:00Z").toISOString(), [from]);
  const toIso = useMemo(() => new Date(to + "T23:59:59Z").toISOString(), [to]);

  const proposedQ = useQuery({
    queryKey: ["ai-analytics-proposed", from, to],
    queryFn: async (): Promise<ProposedRow[]> => {
      const { data, error } = await supabase
        .from("ai_proposed_matches")
        .select(
          "id, status, confidence_level, confidence_override, feedback_reason, rejection_reason, client_visible, created_at, trade_request_id, suggested_country",
        )
        .gte("created_at", fromIso)
        .lte("created_at", toIso)
        .order("created_at", { ascending: false })
        .limit(2000);
      if (error) throw error;
      return (data ?? []) as ProposedRow[];
    },
  });

  const draftsQ = useQuery({
    queryKey: ["ai-analytics-drafts", from, to],
    queryFn: async (): Promise<DraftRow[]> => {
      const { data, error } = await supabase
        .from("ai_outreach_drafts_v2")
        .select("id, draft_status, outcome, sent_at, created_at")
        .gte("created_at", fromIso)
        .lte("created_at", toIso)
        .order("created_at", { ascending: false })
        .limit(2000);
      if (error) throw error;
      return (data ?? []) as DraftRow[];
    },
  });

  const tasksQ = useQuery({
    queryKey: ["ai-analytics-failed", from, to],
    queryFn: async (): Promise<TaskRow[]> => {
      const { data, error } = await supabase
        .from("ai_intel_tasks")
        .select("id, status, description, created_at")
        .eq("kind", "provider_failure_review")
        .gte("created_at", fromIso)
        .lte("created_at", toIso)
        .order("created_at", { ascending: false })
        .limit(2000);
      if (error) throw error;
      return (data ?? []) as TaskRow[];
    },
  });

  const meterQ = useQuery({
    queryKey: ["ai-analytics-meter", from, to],
    queryFn: async (): Promise<MeterRow[]> => {
      const { data, error } = await supabase
        .from("ai_call_meter")
        .select("call_type, day, count")
        .gte("day", from)
        .lte("day", to)
        .order("day", { ascending: false })
        .limit(2000);
      if (error) throw error;
      return (data ?? []) as MeterRow[];
    },
  });

  const providerQ = useQuery({
    queryKey: ["ai-analytics-provider-state"],
    queryFn: async (): Promise<ProviderStateRow[]> => {
      const { data, error } = await supabase
        .from("ai_provider_state")
        .select("provider, last_status, last_status_code, last_error, cooldown_until, updated_at")
        .order("updated_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as ProviderStateRow[];
    },
  });

  // ─── Derive metrics ────────────────────────────────────────────────────
  const proposed = proposedQ.data ?? [];
  const drafts = draftsQ.data ?? [];
  const tasks = tasksQ.data ?? [];
  const meter = meterQ.data ?? [];
  const providers = providerQ.data ?? [];

  const searchesRun = new Set(proposed.map((p) => p.trade_request_id).filter(Boolean)).size;
  const counterpartiesFound = proposed.length;
  const approved = proposed.filter(
    (p) => p.status === "approved_client_view" || p.status === "approved_internal",
  ).length;
  const rejected = proposed.filter((p) => p.status === "rejected").length;

  const rejectionReasons = countBy(
    proposed
      .filter((p) => p.status === "rejected")
      .map((p) => p.feedback_reason || p.rejection_reason || "unspecified"),
  );

  const outreachCreated = drafts.length;
  const outreachSent = drafts.filter((d) => !!d.sent_at).length;
  const bounced = drafts.filter((d) => d.outcome === "bounced").length;
  const replies = drafts.filter(
    (d) => d.outcome && ["replied_positive", "replied_negative", "replied_neutral"].includes(d.outcome),
  ).length;
  const positiveReplies = drafts.filter((d) => d.outcome === "replied_positive").length;
  const negativeReplies = drafts.filter((d) => d.outcome === "replied_negative").length;
  const poiCreated = drafts.filter((d) => d.outcome === "poi_created").length;
  const convertedMatches = drafts.filter((d) => d.outcome === "match_created").length;

  const bounceRate = outreachSent > 0 ? Math.round((bounced / outreachSent) * 100) : null;
  const replyRate = outreachSent > 0 ? Math.round((replies / outreachSent) * 100) : null;

  const failedSearches = tasks.length;

  const confidenceScores = proposed
    .map((p) => {
      const label = (p.confidence_override || p.confidence_level || "").toLowerCase();
      return CONFIDENCE_TO_SCORE[label];
    })
    .filter((n): n is number => typeof n === "number");
  const avgConfidence =
    confidenceScores.length > 0
      ? Math.round(confidenceScores.reduce((a, b) => a + b, 0) / confidenceScores.length)
      : null;

  const outcomeCounts = countBy(drafts.map((d) => d.outcome).filter(Boolean) as string[]);

  // Provider usage aggregation
  const callsByType = countSum(meter, (r) => r.call_type, (r) => r.count);
  const totalCalls = Object.values(callsByType).reduce((a, b) => a + b, 0);
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  const monthStartStr = monthStart.toISOString().slice(0, 10);
  const monthlyUsage = meter
    .filter((m) => m.day >= monthStartStr)
    .reduce((a, b) => a + b.count, 0);

  const loading =
    proposedQ.isLoading ||
    draftsQ.isLoading ||
    tasksQ.isLoading ||
    meterQ.isLoading ||
    providerQ.isLoading;

  return (
    <div className="space-y-4">
      {/* Operational disclaimer */}
      <div className="border border-slate-200 bg-slate-50 rounded-sm p-3 flex gap-3">
        <Info className="h-4 w-4 text-slate-700 mt-0.5 shrink-0" strokeWidth={1.75} />
        <div className="text-[12.5px] leading-relaxed text-slate-800">
          <p className="font-medium">Operational analytics — not compliance analytics.</p>
          <p>
            Counts reflect AI Light-Intel discovery activity only. AI confidence is shown as
            <b> Discovery Confidence</b> / <b>AI Intel Confidence</b> and is advisory.
            Nothing here is a verified counterparty signal.
          </p>
        </div>
      </div>

      {/* Date range */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label htmlFor="ai-an-from" className="text-[11px] uppercase tracking-wider text-muted-foreground">
            From
          </Label>
          <Input
            id="ai-an-from"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="h-8 w-[150px]"
          />
        </div>
        <div>
          <Label htmlFor="ai-an-to" className="text-[11px] uppercase tracking-wider text-muted-foreground">
            To
          </Label>
          <Input
            id="ai-an-to"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="h-8 w-[150px]"
          />
        </div>
        {loading ? <span className="text-[11px] text-muted-foreground pb-2">Loading…</span> : null}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="ai-analytics-summary">
        <SummaryCard label="Searches run" value={searchesRun} />
        <SummaryCard label="Counterparties found" value={counterpartiesFound} />
        <SummaryCard label="Approved" value={approved} />
        <SummaryCard label="Rejected" value={rejected} />
        <SummaryCard label="Outreach drafts" value={outreachCreated} />
        <SummaryCard label="Outreach sent" value={outreachSent} />
        <SummaryCard label="Bounce rate" value={bounceRate === null ? "—" : `${bounceRate}%`} />
        <SummaryCard label="Reply rate" value={replyRate === null ? "—" : `${replyRate}%`} />
        <SummaryCard label="Positive replies" value={positiveReplies} />
        <SummaryCard label="Negative replies" value={negativeReplies} />
        <SummaryCard label="POIs created" value={poiCreated} />
        <SummaryCard label="Converted matches" value={convertedMatches} />
        <SummaryCard label="Failed searches" value={failedSearches} />
        <SummaryCard
          label="Avg AI Intel Confidence"
          value={avgConfidence === null ? "—" : `${avgConfidence} / 100`}
          hint="Discovery Confidence average. Advisory only."
        />
        <SummaryCard label="Total AI calls" value={totalCalls} />
        <SummaryCard label="Monthly usage" value={monthlyUsage} />
      </div>

      {/* Rejection reasons */}
      <Panel title="Rejection reasons" subtitle="ai_proposed_matches.feedback_reason / rejection_reason">
        {Object.keys(rejectionReasons).length === 0 ? (
          <Empty>No rejected items in range.</Empty>
        ) : (
          <SimpleTable
            headers={["Reason", "Count"]}
            rows={Object.entries(rejectionReasons)
              .sort((a, b) => b[1] - a[1])
              .map(([reason, count]) => [
                <span className="text-foreground">{reason}</span>,
                <span className="font-mono">{count}</span>,
              ])}
          />
        )}
      </Panel>

      {/* Outreach outcomes */}
      <Panel title="Outreach outcomes" subtitle="ai_outreach_drafts_v2.outcome">
        {Object.keys(outcomeCounts).length === 0 ? (
          <Empty>No outreach outcomes recorded in range.</Empty>
        ) : (
          <SimpleTable
            headers={["Outcome", "Count"]}
            rows={Object.entries(outcomeCounts)
              .sort((a, b) => b[1] - a[1])
              .map(([outcome, count]) => [
                <Badge variant="outline">{outcome}</Badge>,
                <span className="font-mono">{count}</span>,
              ])}
          />
        )}
      </Panel>

      {/* Provider usage */}
      <Panel
        title="Provider usage"
        subtitle="ai_call_meter · operational counts · no payload shown"
      >
        {meter.length === 0 ? (
          <Empty>No provider calls recorded in range.</Empty>
        ) : (
          <SimpleTable
            headers={["Call type", "Calls", "Est. cost"]}
            rows={Object.entries(callsByType)
              .sort((a, b) => b[1] - a[1])
              .map(([callType, count]) => [
                <span className="text-foreground">{callType}</span>,
                <span className="font-mono">{count}</span>,
                <span className="text-muted-foreground italic" data-testid="provider-cost-cell">
                  Not configured
                </span>,
              ])}
          />
        )}
      </Panel>

      {/* Provider performance / state */}
      <Panel title="Provider performance" subtitle="ai_provider_state · admin only">
        {providers.length === 0 ? (
          <Empty>No provider state recorded.</Empty>
        ) : (
          <SimpleTable
            headers={["Provider", "Last status", "Cooldown until", "Updated"]}
            rows={providers.map((p) => [
              <span className="font-medium">{p.provider}</span>,
              <div className="flex items-center gap-1.5">
                <Badge variant="outline">{p.last_status ?? "—"}</Badge>
                {p.last_status_code ? (
                  <span className="font-mono text-[11px] text-muted-foreground">{p.last_status_code}</span>
                ) : null}
              </div>,
              <span className="font-mono text-[11px] text-muted-foreground">
                {p.cooldown_until ? new Date(p.cooldown_until).toLocaleString() : "—"}
              </span>,
              <span className="text-muted-foreground text-[11.5px]">
                {new Date(p.updated_at).toLocaleString()}
              </span>,
            ])}
          />
        )}
        <p className="mt-3 text-[11.5px] text-muted-foreground">
          Monthly limit: <span className="italic">Not configured</span>. No usage-cap warning shown until a limit is set.
        </p>
      </Panel>

      {/* Failed searches */}
      <Panel
        title="Failed searches / provider failures"
        subtitle="ai_intel_tasks · kind=provider_failure_review"
      >
        <p className="text-[12px] text-amber-900 bg-amber-50 border border-amber-200 rounded-sm p-2 mb-3 inline-flex items-start gap-2">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5" strokeWidth={1.75} />
          Internal admin items only. Never exposed externally.
        </p>
        {tasks.length === 0 ? (
          <Empty>No provider failures recorded in range.</Empty>
        ) : (
          <SimpleTable
            headers={["Status", "Description", "Opened"]}
            rows={tasks.slice(0, 50).map((t) => [
              <Badge variant="outline">{t.status}</Badge>,
              <span className="text-muted-foreground line-clamp-2">{t.description ?? "—"}</span>,
              <span className="text-muted-foreground text-[11.5px]">
                {new Date(t.created_at).toLocaleString()}
              </span>,
            ])}
          />
        )}
      </Panel>
    </div>
  );
}

// ─── helpers ──────────────────────────────────────────────────────────────
function countBy(items: (string | null | undefined)[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of items) {
    if (!k) continue;
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

function countSum<T>(items: T[], keyFn: (t: T) => string, valFn: (t: T) => number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const it of items) {
    const k = keyFn(it);
    out[k] = (out[k] ?? 0) + valFn(it);
  }
  return out;
}

function SummaryCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="border border-border rounded-sm bg-card p-3">
      <p className="font-mono text-[10px] tracking-[0.15em] uppercase text-muted-foreground">{label}</p>
      <p className="text-[18px] font-medium text-foreground mt-1 tabular-nums">{value}</p>
      {hint ? <p className="text-[10.5px] text-muted-foreground mt-1">{hint}</p> : null}
    </div>
  );
}

function Panel({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <section className="bg-card border border-border rounded-sm overflow-hidden">
      <header className="px-4 sm:px-5 py-3 border-b border-border bg-muted/50">
        <p className="text-[13px] font-medium text-foreground">{title}</p>
        <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground mt-0.5">{subtitle}</p>
      </header>
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-[12.5px] text-muted-foreground italic">{children}</p>;
}

function SimpleTable({ headers, rows }: { headers: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="border border-border rounded-sm overflow-hidden">
      <table className="w-full text-[13px]">
        <thead className="bg-muted/40 text-muted-foreground">
          <tr className="text-left">
            {headers.map((h) => (
              <th key={h} className="px-3 py-2 font-mono text-[10px] tracking-[0.15em] uppercase font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((cells, i) => (
            <tr key={i} className="border-t border-border hover:bg-muted/30">
              {cells.map((c, j) => (
                <td key={j} className="px-3 py-2 align-top">{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
