/**
 * AI Review Workspace — Phase 3B.
 *
 * Wraps the existing `AiSuggestionsQueuePanel` with the full V1 tab navigation
 * required by the AI Light-Intel completion path:
 *
 *   Pending Review · Approved Shortlists · Draft Outreach · Ready to Send
 *   Sent Outreach · Responses · Failed Searches · Stale Intel · Analytics
 *
 * Notes:
 *   - platform_admin only (the route and underlying RLS already gate this).
 *   - Reuses existing tables: `ai_proposed_matches`, `ai_outreach_drafts_v2`,
 *     `ai_intel_tasks`. No new schema.
 *   - Tabs filter by status group only; the queue panel itself is unchanged.
 *   - The Analytics tab is a placeholder. Full analytics arrives in Phase 6.
 *   - Confidence is labelled "Discovery Confidence" / "AI Intel Confidence" —
 *     never "Verified".
 */
import { useQuery } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Info, Clock, AlertTriangle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import {
  AiSuggestionsQueuePanel,
  DoNotContactPanel,
} from "./AiSuggestionsQueuePanel";

const STALE_AFTER_DAYS = 30;

type DraftRow = {
  id: string;
  proposed_match_id: string;
  trade_request_id: string;
  draft_subject: string;
  draft_status: string;
  recipient_name: string | null;
  recipient_organisation: string | null;
  recipient_email_if_known: string | null;
  approved_at: string | null;
  sent_at: string | null;
  updated_at: string;
  created_at: string;
};

type TaskRow = {
  id: string;
  kind: string;
  status: string;
  description: string | null;
  proposed_match_id: string | null;
  match_id: string | null;
  trade_request_id: string | null;
  due_at: string | null;
  created_at: string;
};

type ProposedStaleRow = {
  id: string;
  suggested_counterparty_name: string;
  status: string;
  confidence_level: string;
  confidence_override: string | null;
  fit_label: string;
  created_at: string;
  stale_at: string | null;
  expires_at: string | null;
  client_visible: boolean;
};

export function AiReviewWorkspace() {
  return (
    <div className="space-y-3">
      <div className="border border-amber-200 bg-amber-50/70 rounded-sm p-3 flex gap-3">
        <Info className="h-4 w-4 text-amber-700 mt-0.5 shrink-0" strokeWidth={1.75} />
        <div className="text-[12.5px] leading-relaxed text-amber-900">
          <p className="font-medium">AI Light-Intel review workspace. Advisory only.</p>
          <p>
            Nothing on this surface contacts a counterparty, creates a POI, WaD, or formal match,
            or asserts that an organisation is verified. AI confidence is shown as
            <b> Discovery Confidence</b> / <b>AI Intel Confidence</b> and remains advisory.
          </p>
        </div>
      </div>

      <Tabs defaultValue="pending" className="w-full">
        <TabsList className="flex flex-wrap h-auto justify-start gap-1 bg-muted/40 p-1">
          <TabsTrigger value="pending">Pending Review</TabsTrigger>
          <TabsTrigger value="approved">Approved Shortlists</TabsTrigger>
          <TabsTrigger value="drafts">Draft Outreach</TabsTrigger>
          <TabsTrigger value="ready">Ready to Send</TabsTrigger>
          <TabsTrigger value="sent">Sent Outreach</TabsTrigger>
          <TabsTrigger value="responses">Responses</TabsTrigger>
          <TabsTrigger value="failed">Failed Searches</TabsTrigger>
          <TabsTrigger value="stale">Stale Intel</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        <TabsContent value="pending" className="mt-3">
          <AiSuggestionsQueuePanel initialStatusGroup="pending" hideDoNotContact />
        </TabsContent>
        <TabsContent value="approved" className="mt-3">
          <AiSuggestionsQueuePanel initialStatusGroup="approved" hideDoNotContact hideLauncher />
        </TabsContent>
        <TabsContent value="drafts" className="mt-3">
          <OutreachDraftsTab statuses={["draft", "ai_draft", "in_review", "needs_edit"]} title="Draft outreach" />
        </TabsContent>
        <TabsContent value="ready" className="mt-3">
          <OutreachDraftsTab statuses={["approved", "ready", "ready_to_send", "approved_for_send"]} title="Ready to send" />
        </TabsContent>
        <TabsContent value="sent" className="mt-3">
          <OutreachDraftsTab statuses={["sent"]} title="Sent outreach" requireSentAt />
        </TabsContent>
        <TabsContent value="responses" className="mt-3">
          <OutreachDraftsTab statuses={["responded", "bounced", "no_response", "declined"]} title="Responses" />
        </TabsContent>
        <TabsContent value="failed" className="mt-3">
          <FailedSearchesTab />
        </TabsContent>
        <TabsContent value="stale" className="mt-3">
          <StaleIntelTab />
        </TabsContent>
        <TabsContent value="analytics" className="mt-3">
          <AnalyticsPlaceholder />
        </TabsContent>
      </Tabs>

      <div className="border border-border rounded-sm bg-card">
        <DoNotContactPanel />
      </div>
    </div>
  );
}

function OutreachDraftsTab({
  statuses,
  title,
  requireSentAt = false,
}: {
  statuses: string[];
  title: string;
  requireSentAt?: boolean;
}) {
  const q = useQuery({
    queryKey: ["ai-outreach-drafts-v2", title, statuses.join(",")],
    queryFn: async (): Promise<DraftRow[]> => {
      let query = supabase
        .from("ai_outreach_drafts_v2")
        .select(
          "id, proposed_match_id, trade_request_id, draft_subject, draft_status, recipient_name, recipient_organisation, recipient_email_if_known, approved_at, sent_at, updated_at, created_at",
        )
        .in("draft_status", statuses)
        .order("updated_at", { ascending: false })
        .limit(200);
      if (requireSentAt) query = query.not("sent_at", "is", null);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as DraftRow[];
    },
  });

  return (
    <Panel title={title} subtitle="ai_outreach_drafts_v2 · platform_admin only · manual outreach only">
      {q.isLoading ? (
        <Empty>Loading…</Empty>
      ) : q.error ? (
        <Error msg={(q.error as Error).message} />
      ) : (q.data ?? []).length === 0 ? (
        <Empty>No drafts in this state.</Empty>
      ) : (
        <SimpleTable
          headers={["Subject", "Recipient", "Status", "Updated"]}
          rows={(q.data ?? []).map((d) => [
            <span className="font-medium">{d.draft_subject}</span>,
            <span className="text-muted-foreground">
              {d.recipient_name || d.recipient_organisation || d.recipient_email_if_known || "—"}
            </span>,
            <Badge variant="outline">{d.draft_status}</Badge>,
            <span className="text-muted-foreground">
              {formatDistanceToNow(new Date(d.updated_at), { addSuffix: true })}
            </span>,
          ])}
        />
      )}
    </Panel>
  );
}

function FailedSearchesTab() {
  const q = useQuery({
    queryKey: ["ai-intel-tasks-failed"],
    queryFn: async (): Promise<TaskRow[]> => {
      const { data, error } = await supabase
        .from("ai_intel_tasks")
        .select("id, kind, status, description, proposed_match_id, match_id, trade_request_id, due_at, created_at")
        .eq("kind", "provider_failure_review")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as TaskRow[];
    },
  });

  return (
    <Panel
      title="Failed searches"
      subtitle="ai_intel_tasks · kind=provider_failure_review · internal admin items"
    >
      <p className="text-[12px] text-amber-900 bg-amber-50 border border-amber-200 rounded-sm p-2 mb-3 inline-flex items-start gap-2">
        <AlertTriangle className="h-3.5 w-3.5 mt-0.5" strokeWidth={1.75} />
        Provider failure reviews are internal admin items. They are not shown to external users.
      </p>
      {q.isLoading ? (
        <Empty>Loading…</Empty>
      ) : q.error ? (
        <Error msg={(q.error as Error).message} />
      ) : (q.data ?? []).length === 0 ? (
        <Empty>No failed AI searches recorded.</Empty>
      ) : (
        <SimpleTable
          headers={["Title", "Status", "Trade request", "Opened"]}
          rows={(q.data ?? []).map((t) => [
            <div>
              <div className="font-medium">{t.title ?? "Provider failure review"}</div>
              {t.description ? (
                <div className="text-[11.5px] text-muted-foreground line-clamp-2">{t.description}</div>
              ) : null}
            </div>,
            <Badge variant="outline">{t.status}</Badge>,
            <span className="font-mono text-[11px] text-muted-foreground break-all">
              {t.trade_request_id ?? "—"}
            </span>,
            <span className="text-muted-foreground">
              {formatDistanceToNow(new Date(t.created_at), { addSuffix: true })}
            </span>,
          ])}
        />
      )}
    </Panel>
  );
}

function StaleIntelTab() {
  const q = useQuery({
    queryKey: ["ai-proposed-matches-stale"],
    queryFn: async (): Promise<ProposedStaleRow[]> => {
      const nowIso = new Date().toISOString();
      const cutoff = new Date(Date.now() - STALE_AFTER_DAYS * 24 * 60 * 60 * 1000).toISOString();
      // Either explicitly stale, or status==stale, or stale_at has passed.
      const { data, error } = await supabase
        .from("ai_proposed_matches")
        .select(
          "id, suggested_counterparty_name, status, confidence_level, confidence_override, fit_label, created_at, stale_at, expires_at, client_visible",
        )
        .or(`status.eq.stale,stale_at.lte.${nowIso},created_at.lte.${cutoff}`)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as ProposedStaleRow[];
    },
  });

  return (
    <Panel title="Stale Intel" subtitle="ai_proposed_matches · stale or > 30 days · advisory only">
      {q.isLoading ? (
        <Empty>Loading…</Empty>
      ) : q.error ? (
        <Error msg={(q.error as Error).message} />
      ) : (q.data ?? []).length === 0 ? (
        <Empty>No stale AI intel.</Empty>
      ) : (
        <SimpleTable
          headers={["Counterparty", "Status", "Discovery Confidence", "Age"]}
          rows={(q.data ?? []).map((r) => {
            const expired = r.expires_at && new Date(r.expires_at).getTime() < Date.now();
            return [
              <span className="font-medium">{r.suggested_counterparty_name}</span>,
              <div className="flex items-center gap-1.5">
                <Badge variant="outline">{r.status}</Badge>
                {expired ? <Badge variant="outline" className="bg-amber-50 text-amber-800 border-amber-200">expired</Badge> : null}
              </div>,
              <Badge variant="outline">{r.confidence_override ?? r.confidence_level}</Badge>,
              <span className="text-muted-foreground inline-flex items-center gap-1">
                <Clock className="h-3 w-3" strokeWidth={1.75} />
                {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
              </span>,
            ];
          })}
        />
      )}
    </Panel>
  );
}

function AnalyticsPlaceholder() {
  return (
    <Panel title="Analytics" subtitle="Placeholder · platform_admin">
      <div className="text-[12.5px] text-muted-foreground space-y-2">
        <p>Full AI Light-Intel analytics arrives in Phase 6.</p>
        <p>
          Planned views: run counts per trade request, hit-rate of Approved Shortlists,
          outreach response rates, feedback-reason distribution, provider-failure trends,
          and Discovery Confidence calibration. None of these are wired yet.
        </p>
      </div>
    </Panel>
  );
}

// ─── tiny shared primitives ────────────────────────────────────────────────
function Panel({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <section className="bg-card border border-border rounded-sm overflow-hidden">
      <header className="px-4 sm:px-5 py-3 border-b border-border bg-muted/50">
        <p className="text-[13px] font-medium text-foreground">{title}</p>
        <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground mt-0.5">
          {subtitle}
        </p>
      </header>
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-[12.5px] text-muted-foreground italic">{children}</p>;
}

function Error({ msg }: { msg: string }) {
  return (
    <p className="text-[12.5px] text-rose-700 border border-rose-200 bg-rose-50 rounded-sm p-2">
      Failed to load: {msg}
    </p>
  );
}

function SimpleTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: React.ReactNode[][];
}) {
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
