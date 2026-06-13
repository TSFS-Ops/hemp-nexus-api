/**
 * HQ → AI Suggestions queue (Batch 3).
 *
 * Scope:
 *   - platform_admin only (route + RLS already gate this; UI adds no privilege).
 *   - Lists `ai_proposed_matches` with filters (status / confidence / fit / risk / stale).
 *   - Detail drawer: full proposal, source references (with fallback copy), risk
 *     flags, audit history from `audit_logs` filtered to `ai_review.*` actions.
 *   - Mandatory advisory banner: AI does not contact counterparties; nothing here
 *     creates a POI, WaD, formal match, or outreach. No "verified" wording.
 *
 * Batch 3 mutations (all routed through edge functions, never direct table writes):
 *   - approve / reject (with reason) / archive / escalate (with reason)
 *     / needs_more_research / under_review / assign / reviewer_note
 *     / confidence_override → `ai-proposed-match-decision`
 *   - Do-not-contact rule create / deactivate → `ai-do-not-contact-rules`
 *
 * Stale = active status + age > 30 days. UI-derived only — nothing persists,
 * auto-archives, or auto-deletes.
 */

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertTriangle, Info, Clock, Filter as FilterIcon, Ban, Loader2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";

const ROW_LIMIT = 200;
const STALE_AFTER_DAYS = 30;
// Active statuses eligible for the stale badge. Stale = active + age > 30 days.
// UI-derived only — nothing here persists, auto-archives, or auto-deletes.
const STALE_ACTIVE_STATUSES = new Set<string>([
  "new",
  "pending",
  "under_review",
  "needs_more_research",
  "approved",
  "escalated",
]);

type ProposedRow = {
  id: string;
  trade_request_id: string;
  interpretation_id: string | null;
  suggested_counterparty_name: string;
  suggested_counterparty_org_id: string | null;
  counterparty_role: string | null;
  jurisdiction: string | null;
  rank_position: number | null;
  confidence_level: string;
  confidence_override: string | null;
  fit_label: string;
  status: string;
  escalation_required: boolean;
  escalation_reason: string | null;
  match_rationale: string | null;
  sector_or_product_fit: string | null;
  capacity_indicator: string | null;
  prior_activity_summary: string | null;
  source_summary: string | null;
  source_references: unknown;
  risk_flags: unknown;
  reviewer_note: string | null;
  created_at: string;
  updated_at: string;
};

type AuditRow = {
  id: string;
  action: string;
  created_at: string;
  metadata: unknown;
  actor_user_id: string | null;
};

const STATUS_OPTIONS = [
  { id: "all", label: "All statuses" },
  { id: "pending", label: "Pending" },
  { id: "approved", label: "Approved" },
  { id: "rejected", label: "Rejected" },
  { id: "archived", label: "Archived" },
  { id: "escalated", label: "Escalated" },
  { id: "needs_more_research", label: "Needs more research" },
] as const;

const CONFIDENCE_OPTIONS = [
  { id: "all", label: "All confidence" },
  { id: "high", label: "High" },
  { id: "medium", label: "Medium" },
  { id: "low", label: "Low" },
] as const;

const FIT_OPTIONS = [
  { id: "all", label: "All fit" },
  { id: "strong", label: "Strong" },
  { id: "plausible", label: "Plausible" },
  { id: "weak", label: "Weak" },
] as const;

const RISK_OPTIONS = [
  { id: "all", label: "All risk" },
  { id: "any", label: "Has risk flag" },
  { id: "none", label: "No risk flag" },
] as const;

const STALE_OPTIONS = [
  { id: "all", label: "All ages" },
  { id: "stale", label: "Stale only (active > 30d)" },
  { id: "fresh", label: "Fresh only" },
] as const;

function isStale(row: ProposedRow): boolean {
  if (!STALE_ACTIVE_STATUSES.has(row.status)) return false;
  const ageMs = Date.now() - new Date(row.created_at).getTime();
  return ageMs > STALE_AFTER_DAYS * 24 * 60 * 60 * 1000;
}

function confidenceTone(level: string): string {
  switch ((level || "").toLowerCase()) {
    case "high": return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "medium": return "bg-amber-50 text-amber-700 border-amber-200";
    case "low": return "bg-slate-100 text-slate-700 border-slate-200";
    default: return "bg-slate-100 text-slate-700 border-slate-200";
  }
}

function fitTone(label: string): string {
  switch ((label || "").toLowerCase()) {
    case "strong": return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "plausible": return "bg-sky-50 text-sky-700 border-sky-200";
    case "weak": return "bg-slate-100 text-slate-700 border-slate-200";
    default: return "bg-slate-100 text-slate-700 border-slate-200";
  }
}

function statusTone(status: string): string {
  switch (status) {
    case "pending": return "bg-slate-100 text-slate-700 border-slate-200";
    case "approved": return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "rejected": return "bg-rose-50 text-rose-700 border-rose-200";
    case "archived": return "bg-slate-50 text-slate-500 border-slate-200";
    case "escalated": return "bg-amber-50 text-amber-800 border-amber-200";
    case "needs_more_research": return "bg-sky-50 text-sky-700 border-sky-200";
    default: return "bg-slate-100 text-slate-700 border-slate-200";
  }
}

export function AiSuggestionsQueuePanel() {
  const [statusFilter, setStatusFilter] = useState<string>("pending");
  const [confidenceFilter, setConfidenceFilter] = useState<string>("all");
  const [fitFilter, setFitFilter] = useState<string>("all");
  const [riskFilter, setRiskFilter] = useState<string>("all");
  const [staleFilter, setStaleFilter] = useState<string>("all");
  const [openId, setOpenId] = useState<string | null>(null);

  const listQuery = useQuery({
    queryKey: ["ai-proposed-matches", statusFilter, confidenceFilter, fitFilter],
    queryFn: async (): Promise<ProposedRow[]> => {
      let q = supabase
        .from("ai_proposed_matches")
        .select(
          "id, trade_request_id, interpretation_id, suggested_counterparty_name, suggested_counterparty_org_id, counterparty_role, jurisdiction, rank_position, confidence_level, confidence_override, fit_label, status, escalation_required, escalation_reason, match_rationale, sector_or_product_fit, capacity_indicator, prior_activity_summary, source_summary, source_references, risk_flags, reviewer_note, created_at, updated_at",
        )
        .order("created_at", { ascending: false })
        .limit(ROW_LIMIT);

      if (statusFilter !== "all") q = q.eq("status", statusFilter);
      if (confidenceFilter !== "all") q = q.eq("confidence_level", confidenceFilter);
      if (fitFilter !== "all") q = q.eq("fit_label", fitFilter);

      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as ProposedRow[];
    },
  });

  const rows = useMemo(() => {
    const raw = listQuery.data ?? [];
    return raw.filter((r) => {
      const flags = Array.isArray(r.risk_flags) ? r.risk_flags : [];
      const hasRisk = flags.length > 0 || r.escalation_required;
      if (riskFilter === "any" && !hasRisk) return false;
      if (riskFilter === "none" && hasRisk) return false;
      const stale = isStale(r);
      if (staleFilter === "stale" && !stale) return false;
      if (staleFilter === "fresh" && stale) return false;
      return true;
    });
  }, [listQuery.data, riskFilter, staleFilter]);

  const openRow = useMemo(
    () => rows.find((r) => r.id === openId) ?? (listQuery.data ?? []).find((r) => r.id === openId) ?? null,
    [openId, rows, listQuery.data],
  );

  return (
    <section className="bg-card border border-border rounded-sm overflow-hidden">
      <header className="px-4 sm:px-5 py-3 border-b border-border bg-muted/50">
        <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground">
          AI Suggestions · ai_proposed_matches · platform_admin only · read-only review queue
        </p>
      </header>

      {/* Mandatory advisory banner. Must remain visible above the queue. */}
      <div className="m-4 sm:m-5 mb-0 border border-amber-200 bg-amber-50/70 rounded-sm p-3 sm:p-4 flex gap-3">
        <Info className="h-4 w-4 text-amber-700 mt-0.5 shrink-0" strokeWidth={1.75} />
        <div className="text-[12.5px] leading-relaxed text-amber-900 space-y-1">
          <p className="font-medium">AI-generated suggestions. Advisory only.</p>
          <p className="text-amber-900/90">
            Nothing on this surface contacts a counterparty, creates a POI, WaD, or formal match,
            or asserts that an organisation is verified. The platform does not send email, SMS,
            WhatsApp, or any other outbound message from this queue. All decisions and any
            outreach remain manual and administrator-driven.
          </p>
        </div>
      </div>

      <div className="p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <FilterIcon className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.75} />
          <FilterSelect value={statusFilter} onChange={setStatusFilter} options={STATUS_OPTIONS} />
          <FilterSelect value={confidenceFilter} onChange={setConfidenceFilter} options={CONFIDENCE_OPTIONS} />
          <FilterSelect value={fitFilter} onChange={setFitFilter} options={FIT_OPTIONS} />
          <FilterSelect value={riskFilter} onChange={setRiskFilter} options={RISK_OPTIONS} />
          <FilterSelect value={staleFilter} onChange={setStaleFilter} options={STALE_OPTIONS} />
          <div className="ml-auto font-mono text-[11px] text-muted-foreground">
            {listQuery.isLoading ? "loading…" : `${rows.length} shown${(listQuery.data?.length ?? 0) >= ROW_LIMIT ? ` · capped at ${ROW_LIMIT}` : ""}`}
          </div>
        </div>

        {listQuery.error ? (
          <div className="text-sm text-rose-700 border border-rose-200 bg-rose-50 rounded-sm p-3">
            Failed to load proposed matches. {(listQuery.error as Error).message}
          </div>
        ) : null}

        <div className="border border-border rounded-sm overflow-hidden">
          <table className="w-full text-[13px]">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr className="text-left">
                <Th>#</Th>
                <Th>Counterparty</Th>
                <Th>Role</Th>
                <Th>Confidence</Th>
                <Th>Fit</Th>
                <Th>Status</Th>
                <Th>Risk</Th>
                <Th>Age</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {!listQuery.isLoading && rows.length === 0 ? (
                <tr><td colSpan={9} className="px-3 py-8 text-center text-muted-foreground text-sm">No proposed matches match the current filters.</td></tr>
              ) : null}
              {rows.map((r) => {
                const flags = Array.isArray(r.risk_flags) ? (r.risk_flags as unknown[]) : [];
                const stale = isStale(r);
                return (
                  <tr key={r.id} className="border-t border-border hover:bg-muted/30">
                    <Td className="font-mono text-[11px] text-muted-foreground">{r.rank_position ?? "—"}</Td>
                    <Td>
                      <div className="font-medium text-foreground">{r.suggested_counterparty_name}</div>
                      {r.jurisdiction ? (
                        <div className="font-mono text-[10.5px] text-muted-foreground">{r.jurisdiction}</div>
                      ) : null}
                    </Td>
                    <Td className="text-muted-foreground">{r.counterparty_role ?? "—"}</Td>
                    <Td>
                      <Badge variant="outline" className={confidenceTone(r.confidence_override ?? r.confidence_level)}>
                        {r.confidence_override ?? r.confidence_level}
                        {r.confidence_override ? " (override)" : ""}
                      </Badge>
                    </Td>
                    <Td>
                      <Badge variant="outline" className={fitTone(r.fit_label)}>{r.fit_label}</Badge>
                    </Td>
                    <Td>
                      <Badge variant="outline" className={statusTone(r.status)}>{r.status.replace(/_/g, " ")}</Badge>
                    </Td>
                    <Td>
                      {flags.length > 0 || r.escalation_required ? (
                        <span className="inline-flex items-center gap-1 text-amber-800">
                          <AlertTriangle className="h-3.5 w-3.5" strokeWidth={1.75} />
                          <span className="font-mono text-[11px]">{flags.length || (r.escalation_required ? 1 : 0)}</span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </Td>
                    <Td>
                      <div className="flex items-center gap-1.5">
                        <span className="text-muted-foreground">{formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}</span>
                        {stale ? (
                          <Badge variant="outline" className="bg-amber-50 text-amber-800 border-amber-200 inline-flex items-center gap-1">
                            <Clock className="h-3 w-3" strokeWidth={1.75} /> stale
                          </Badge>
                        ) : null}
                      </div>
                    </Td>
                    <Td className="text-right">
                      <Button size="sm" variant="outline" onClick={() => setOpenId(r.id)}>Open</Button>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="text-[11px] text-muted-foreground">
          Admin actions (approve, reject, archive, escalate, needs more research, under review,
          assign, reviewer note, confidence override) are recorded as audit events under
          <span className="font-mono"> ai_review.* </span>
          codes and never trigger outreach, POI, WaD, or formal-match creation.
        </p>
      </div>

      <Sheet open={!!openId} onOpenChange={(o) => { if (!o) setOpenId(null); }}>
        <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
          {openRow ? <DetailDrawer row={openRow} onClose={() => setOpenId(null)} /> : null}
        </SheetContent>
      </Sheet>

      <div className="border-t border-border">
        <DoNotContactPanel />
      </div>
    </section>
  );
}

function FilterSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: readonly { id: string; label: string }[];
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-8 w-auto min-w-[140px] text-[12px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.id} value={o.id} className="text-[12px]">{o.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Th({ children }: { children?: React.ReactNode }) {
  return <th className="px-3 py-2 font-mono text-[10px] tracking-[0.15em] uppercase font-medium">{children}</th>;
}
function Td({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 align-top ${className}`}>{children}</td>;
}

function DetailDrawer({ row }: { row: ProposedRow }) {
  const refs = Array.isArray(row.source_references) ? (row.source_references as unknown[]) : [];
  const flags = Array.isArray(row.risk_flags) ? (row.risk_flags as unknown[]) : [];
  const stale = isStale(row);

  const auditQuery = useQuery({
    queryKey: ["ai-proposed-match-audit", row.id],
    queryFn: async (): Promise<AuditRow[]> => {
      const { data, error } = await supabase
        .from("audit_logs")
        .select("id, action, created_at, metadata, actor_user_id")
        .eq("entity_id", row.id)
        .like("action", "ai_review.%")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as AuditRow[];
    },
  });

  return (
    <div className="space-y-5">
      <SheetHeader>
        <SheetTitle className="text-base">{row.suggested_counterparty_name}</SheetTitle>
        <SheetDescription>
          AI-generated suggestion. Advisory only. No outreach, POI, WaD, or formal match is created
          by viewing or reviewing this entry.
        </SheetDescription>
      </SheetHeader>

      <div className="flex flex-wrap gap-1.5">
        <Badge variant="outline" className={statusTone(row.status)}>{row.status.replace(/_/g, " ")}</Badge>
        <Badge variant="outline" className={confidenceTone(row.confidence_override ?? row.confidence_level)}>
          confidence · {row.confidence_override ?? row.confidence_level}{row.confidence_override ? " (override)" : ""}
        </Badge>
        <Badge variant="outline" className={fitTone(row.fit_label)}>fit · {row.fit_label}</Badge>
        {row.counterparty_role ? <Badge variant="outline">{row.counterparty_role}</Badge> : null}
        {row.jurisdiction ? <Badge variant="outline">{row.jurisdiction}</Badge> : null}
        {row.rank_position != null ? <Badge variant="outline">rank #{row.rank_position}</Badge> : null}
        {stale ? <Badge variant="outline" className="bg-amber-50 text-amber-800 border-amber-200">stale</Badge> : null}
        {row.escalation_required ? <Badge variant="outline" className="bg-amber-50 text-amber-800 border-amber-200">escalation required</Badge> : null}
      </div>

      <Section title="Match rationale">
        <Prose value={row.match_rationale} />
      </Section>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Section title="Sector / product fit"><Prose value={row.sector_or_product_fit} /></Section>
        <Section title="Capacity indicator"><Prose value={row.capacity_indicator} /></Section>
        <Section title="Prior activity"><Prose value={row.prior_activity_summary} /></Section>
        <Section title="Source summary"><Prose value={row.source_summary} /></Section>
      </div>

      <Section title="Source references">
        {refs.length === 0 ? (
          <p className="text-[12.5px] text-muted-foreground italic">Source reference not available.</p>
        ) : (
          <ul className="space-y-1.5">
            {refs.map((ref, i) => (
              <li key={i} className="text-[12.5px] font-mono text-foreground break-all">
                {typeof ref === "string" ? ref : JSON.stringify(ref)}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Risk flags">
        {flags.length === 0 && !row.escalation_required ? (
          <p className="text-[12.5px] text-muted-foreground">None recorded.</p>
        ) : (
          <ul className="space-y-1.5">
            {flags.map((f, i) => (
              <li key={i} className="text-[12.5px] text-amber-900 break-words">
                {typeof f === "string" ? f : JSON.stringify(f)}
              </li>
            ))}
            {row.escalation_required ? (
              <li className="text-[12.5px] text-amber-900">
                Escalation flagged: {row.escalation_reason ?? "no reason recorded"}
              </li>
            ) : null}
          </ul>
        )}
      </Section>

      {row.reviewer_note ? (
        <Section title="Reviewer note (read-only)">
          <Prose value={row.reviewer_note} />
        </Section>
      ) : null}

      <Section title="Audit history">
        {auditQuery.isLoading ? (
          <p className="text-[12.5px] text-muted-foreground">Loading…</p>
        ) : auditQuery.error ? (
          <p className="text-[12.5px] text-rose-700">Failed to load audit history.</p>
        ) : (auditQuery.data ?? []).length === 0 ? (
          <p className="text-[12.5px] text-muted-foreground">No audit entries recorded for this suggestion yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {(auditQuery.data ?? []).map((a) => (
              <li key={a.id} className="text-[12px] flex items-baseline gap-3 border-b border-border/60 pb-1.5">
                <span className="font-mono text-[10.5px] text-muted-foreground shrink-0">
                  {new Date(a.created_at).toISOString().replace("T", " ").slice(0, 19)}Z
                </span>
                <span className="font-mono text-[11px] text-foreground">{a.action}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <div className="text-[11px] text-muted-foreground border-t border-border pt-3 font-mono">
        id · {row.id}<br />
        trade_request · {row.trade_request_id}<br />
        created · {new Date(row.created_at).toISOString()}<br />
        updated · {new Date(row.updated_at).toISOString()}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground mb-1.5">{title}</p>
      {children}
    </div>
  );
}

function Prose({ value }: { value: string | null }) {
  if (!value || !value.trim()) {
    return <p className="text-[12.5px] text-muted-foreground italic">Not provided.</p>;
  }
  return <p className="text-[13px] leading-relaxed text-foreground whitespace-pre-wrap">{value}</p>;
}
