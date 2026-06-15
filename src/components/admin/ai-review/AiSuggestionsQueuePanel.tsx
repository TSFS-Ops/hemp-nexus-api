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
import { AiOutreachDraftV2Panel } from "./AiOutreachDraftV2Panel";
import { AiPoiIntelligencePanel } from "./AiPoiIntelligencePanel";
import { AiSuggestionLauncher } from "./AiSuggestionLauncher";

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
  details: unknown;
  admin_user_id: string | null;
};

const STATUS_OPTIONS = [
  { id: "all", label: "All statuses" },
  { id: "new", label: "New" },
  { id: "pending", label: "Pending" },
  { id: "under_review", label: "Under review" },
  { id: "approved", label: "Approved (internal)" },
  { id: "approved_internal", label: "Approved · internal" },
  { id: "approved_client_view", label: "Approved · client view" },
  { id: "rejected", label: "Rejected" },
  { id: "archived", label: "Archived" },
  { id: "escalated", label: "Escalated" },
  { id: "needs_more_research", label: "Needs more research" },
  { id: "expired", label: "Expired" },
  { id: "closed", label: "Closed" },
  { id: "stale", label: "Stale" },
] as const;

// Status groups used by the workspace tabs.
export const STATUS_GROUPS = {
  pending: ["new", "pending", "under_review"],
  approved: ["approved", "approved_internal", "approved_client_view"],
} as const;
export type AiReviewStatusGroup = keyof typeof STATUS_GROUPS | "all" | "stale";

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
    case "approved":
    case "approved_internal": return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "approved_client_view": return "bg-emerald-100 text-emerald-800 border-emerald-300";
    case "rejected": return "bg-rose-50 text-rose-700 border-rose-200";
    case "archived":
    case "closed": return "bg-slate-50 text-slate-500 border-slate-200";
    case "expired":
    case "stale": return "bg-amber-50 text-amber-800 border-amber-200";
    case "escalated": return "bg-amber-50 text-amber-800 border-amber-200";
    case "needs_more_research": return "bg-sky-50 text-sky-700 border-sky-200";
    default: return "bg-slate-100 text-slate-700 border-slate-200";
  }
}

export type AiSuggestionsQueuePanelProps = {
  /** Pre-filters the queue by a status group ("pending", "approved", "stale"). */
  initialStatusGroup?: AiReviewStatusGroup;
  /** Hide the embedded Do-Not-Contact panel (the workspace renders it once). */
  hideDoNotContact?: boolean;
  /** Hide the launcher (workspace shows it only on the Pending tab). */
  hideLauncher?: boolean;
};

export function AiSuggestionsQueuePanel(props: AiSuggestionsQueuePanelProps = {}) {
  const { initialStatusGroup = "all", hideDoNotContact = false, hideLauncher = false } = props;
  const groupStatuses = initialStatusGroup in STATUS_GROUPS
    ? STATUS_GROUPS[initialStatusGroup as keyof typeof STATUS_GROUPS]
    : null;
  const initialStatusFilter =
    initialStatusGroup === "all" || initialStatusGroup === "stale"
      ? "all"
      : (groupStatuses?.[0] ?? "all");
  const initialStaleFilter = initialStatusGroup === "stale" ? "stale" : "all";

  const [statusFilter, setStatusFilter] = useState<string>(initialStatusFilter);
  const [confidenceFilter, setConfidenceFilter] = useState<string>("all");
  const [fitFilter, setFitFilter] = useState<string>("all");
  const [riskFilter, setRiskFilter] = useState<string>("all");
  const [staleFilter, setStaleFilter] = useState<string>(initialStaleFilter);
  const [openId, setOpenId] = useState<string | null>(null);

  const listQuery = useQuery({
    queryKey: ["ai-proposed-matches", initialStatusGroup, statusFilter, confidenceFilter, fitFilter],
    queryFn: async (): Promise<ProposedRow[]> => {
      let q = supabase
        .from("ai_proposed_matches")
        .select(
          "id, trade_request_id, interpretation_id, suggested_counterparty_name, suggested_counterparty_org_id, counterparty_role, jurisdiction, rank_position, confidence_level, confidence_override, fit_label, status, escalation_required, escalation_reason, match_rationale, sector_or_product_fit, capacity_indicator, prior_activity_summary, source_summary, source_references, risk_flags, reviewer_note, created_at, updated_at",
        )
        .order("created_at", { ascending: false })
        .limit(ROW_LIMIT);

      if (statusFilter !== "all") {
        q = q.eq("status", statusFilter);
      } else if (groupStatuses) {
        q = q.in("status", groupStatuses as unknown as string[]);
      }
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

  const totalLoaded = listQuery.data?.length ?? 0;
  const filtersActive =
    statusFilter !== "all" ||
    confidenceFilter !== "all" ||
    fitFilter !== "all" ||
    riskFilter !== "all" ||
    staleFilter !== "all";

  return (
    <div className="space-y-4">
      {hideLauncher ? null : <AiSuggestionLauncher />}
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
                <tr>
                  <td colSpan={9} className="px-3 py-8 text-center text-muted-foreground text-sm">
                    {filtersActive && totalLoaded > 0 ? (
                      "No proposed matches match the current filters."
                    ) : (
                      <span>
                        No AI proposed matches yet. Select a trade request above, run
                        {" "}<span className="font-medium text-foreground">Interpret with AI</span>, then
                        {" "}<span className="font-medium text-foreground">Source counterparties</span>.
                        {" "}AI output is advisory only and does not contact anyone, create a POI,
                        create a WaD, create a formal match, or mark any party verified.
                      </span>
                    )}
                  </td>
                </tr>
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

      {hideDoNotContact ? null : (
        <div className="border-t border-border">
          <DoNotContactPanel />
        </div>
      )}
    </section>
    </div>
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

function DetailDrawer({ row, onClose }: { row: ProposedRow; onClose: () => void }) {
  const refs = Array.isArray(row.source_references) ? (row.source_references as unknown[]) : [];
  const flags = Array.isArray(row.risk_flags) ? (row.risk_flags as unknown[]) : [];
  const stale = isStale(row);

  const auditQuery = useQuery({
    queryKey: ["ai-proposed-match-audit", row.id],
    queryFn: async (): Promise<AuditRow[]> => {
      // Audit drawer reads from admin_audit_logs (canonical sink for
      // ai_review.* events). target_id is the proposed_match id; details
      // holds the structured envelope; admin_user_id is the actor.
      const { data, error } = await supabase
        .from("admin_audit_logs")
        .select("id, action, created_at, details, admin_user_id")
        .eq("target_id", row.id)
        .like("action", "ai_review.%")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as unknown as AuditRow[];
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
        <Section title="Reviewer note">
          <Prose value={row.reviewer_note} />
        </Section>
      ) : null}

      <ActionsBar row={row} onDone={onClose} />

      <AiPoiIntelligencePanel proposedMatchId={row.id} />

      <AiOutreachDraftV2Panel proposedMatchId={row.id} parentStatus={row.status} />

      <Section title="Audit history">
        <p className="text-[11px] text-muted-foreground mb-2">
          Reads <span className="font-mono">admin_audit_logs</span> where
          <span className="font-mono"> target_id = proposed_match.id</span> and
          <span className="font-mono"> action LIKE 'ai_review.%'</span>. Drafts and POI
          intelligence audits target their own rows and appear in their respective panels above.
        </p>
        {auditQuery.isLoading ? (
          <p className="text-[12.5px] text-muted-foreground">Loading…</p>
        ) : auditQuery.error ? (
          <p className="text-[12.5px] text-rose-700">Failed to load audit history.</p>
        ) : (auditQuery.data ?? []).length === 0 ? (
          <p className="text-[12.5px] text-muted-foreground">No proposed-match audit entries recorded for this suggestion yet.</p>
        ) : (
          <ul className="space-y-2">
            {(auditQuery.data ?? []).map((a) => {
              const details = a.details && typeof a.details === "object" ? (a.details as Record<string, unknown>) : null;
              const status = details?.status as string | undefined;
              const reason = details?.reason as string | undefined;
              return (
                <li key={a.id} className="text-[12px] border-b border-border/60 pb-1.5">
                  <div className="flex items-baseline gap-3 flex-wrap">
                    <span className="font-mono text-[10.5px] text-muted-foreground shrink-0">
                      {new Date(a.created_at).toISOString().replace("T", " ").slice(0, 19)}Z
                    </span>
                    <span className="font-mono text-[11px] text-foreground">{a.action}</span>
                    {status ? <Badge variant="outline" className="text-[10px]">{status}</Badge> : null}
                  </div>
                  <div className="flex items-baseline gap-3 mt-0.5 font-mono text-[10.5px] text-muted-foreground">
                    <span>actor · {a.admin_user_id ?? "system"}</span>
                    {reason ? <span className="text-foreground/80 break-words">reason · {reason}</span> : null}
                  </div>
                </li>
              );
            })}
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

// ─────────────────────────────────────────────────────────────────────────────
// Action bar — admin decisions on a proposed match. All mutations go through
// the `ai-proposed-match-decision` edge function so RLS, role-gating, and
// canonical `ai_review.*` audit writes stay server-side.
// ─────────────────────────────────────────────────────────────────────────────
const CONFIDENCE_LEVELS = ["low", "medium", "high"] as const;

// Mirrors supabase/functions/ai-proposed-match-decision/index.ts FEEDBACK_REASONS.
const FEEDBACK_REASONS = [
  "wrong_company", "wrong_country", "wrong_product", "wrong_counterparty_role",
  "weak_source", "bad_contact", "dead_email", "duplicate",
  "possible_compliance_concern", "poor_outreach_draft",
  "not_commercially_relevant", "insufficient_evidence", "other",
] as const;

const ESCALATION_TARGETS = ["verification", "wad", "kyb", "compliance"] as const;

type ActionKey =
  | "approve"
  | "reject"
  | "archive"
  | "escalate"
  | "needs_more_research"
  | "under_review"
  | "reviewer_note"
  | "confidence_override"
  | "assign"
  | "set_due_date"
  | "mark_duplicate"
  | "mark_not_relevant"
  | "set_feedback_reason"
  | "request_rerun"
  | "approve_for_client_view"
  | "approve_for_outreach";

type DialogSpec = {
  action: ActionKey;
  title: string;
  description: string;
  needsReason?: boolean;
  needsNote?: boolean;
  needsOverride?: boolean;
  needsAssignee?: boolean;
  needsDueAt?: boolean;
  needsFeedbackReason?: boolean;
  needsEscalationTarget?: boolean;
  /** Show a destructive confirmation banner before submit (client-visible exposure). */
  clientVisibleConfirm?: boolean;
  confirmLabel: string;
  destructive?: boolean;
};

const DIALOG_SPECS: Record<ActionKey, DialogSpec> = {
  approve: { action: "approve", title: "Approve (internal)", description: "Approve for internal admin work only. Does not expose this proposal to external users.", needsNote: true, confirmLabel: "Approve internal" },
  reject: { action: "reject", title: "Reject proposal", description: "Record a rejection reason. Captured in the audit trail.", needsReason: true, needsNote: true, confirmLabel: "Reject", destructive: true },
  archive: { action: "archive", title: "Archive proposal", description: "Move out of the active queue. An optional note explains why.", needsReason: true, confirmLabel: "Archive" },
  escalate: { action: "escalate", title: "Escalate proposal", description: "Flag for senior review. Pick an escalation target.", needsReason: true, needsEscalationTarget: true, confirmLabel: "Escalate" },
  needs_more_research: { action: "needs_more_research", title: "Needs more research", description: "Park while further internal research is gathered.", needsNote: true, confirmLabel: "Mark needs more research" },
  under_review: { action: "under_review", title: "Mark under review", description: "Indicate that an admin is actively reviewing this proposal.", confirmLabel: "Mark under review" },
  reviewer_note: { action: "reviewer_note", title: "Add reviewer note", description: "Append or replace the reviewer note. Recorded in audit trail.", needsNote: true, confirmLabel: "Save note" },
  confidence_override: { action: "confidence_override", title: "Override Discovery Confidence", description: "Manually set the Discovery Confidence level. This is advisory; it does not assert verification.", needsOverride: true, needsReason: true, confirmLabel: "Apply override" },
  assign: { action: "assign", title: "Assign to platform admin", description: "Assign this proposal to a specific platform_admin reviewer (paste their user id).", needsAssignee: true, confirmLabel: "Assign" },
  set_due_date: { action: "set_due_date", title: "Set due date", description: "Internal review due date. Advisory only — no automatic action is taken when the date passes.", needsDueAt: true, confirmLabel: "Set due date" },
  mark_duplicate: { action: "mark_duplicate", title: "Mark duplicate", description: "Archive this proposal and tag as a duplicate of another suggestion.", needsReason: true, confirmLabel: "Mark duplicate" },
  mark_not_relevant: { action: "mark_not_relevant", title: "Mark not relevant", description: "Archive this proposal as not commercially relevant.", needsReason: true, confirmLabel: "Mark not relevant" },
  set_feedback_reason: { action: "set_feedback_reason", title: "Set feedback reason", description: "Record a fixed feedback reason against this proposal.", needsFeedbackReason: true, confirmLabel: "Save feedback reason" },
  request_rerun: { action: "request_rerun", title: "Request rerun", description: "Records a rerun request in the audit trail. The actual rerun is launched separately by an admin clicking Source counterparties.", needsReason: true, confirmLabel: "Request rerun" },
  approve_for_client_view: {
    action: "approve_for_client_view",
    title: "Approve for client view",
    description: "Snapshots the approved payload and sets client_visible = true. This is a separate explicit action; it is not implied by any other approval.",
    needsReason: true,
    clientVisibleConfirm: true,
    confirmLabel: "Approve for client view",
    destructive: true,
  },
  approve_for_outreach: { action: "approve_for_outreach", title: "Approve for outreach", description: "Marks the proposal as cleared for manual outreach drafting. Does not send anything.", needsReason: true, confirmLabel: "Approve for outreach" },
};

function ActionsBar({ row, onDone }: { row: ProposedRow; onDone: () => void }) {
  const [open, setOpen] = useState<ActionKey | null>(null);
  const [openVersions, setOpenVersions] = useState(false);
  const [openEdit, setOpenEdit] = useState(false);

  const terminalArchived = row.status === "rejected" || row.status === "archived" || row.status === "expired" || row.status === "closed";
  const isApprovedInternal = row.status === "approved" || row.status === "approved_internal";
  const isApprovedClient = row.status === "approved_client_view";

  return (
    <div className="border border-border rounded-sm bg-muted/30 p-3 space-y-2">
      <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground">Admin actions</p>
      {terminalArchived ? (
        <p className="text-[12px] text-muted-foreground">
          This proposal is in terminal status <span className="font-mono">{row.status}</span>. Only reviewer notes,
          rerun requests and feedback reason capture remain available.
        </p>
      ) : null}
      <div className="flex flex-wrap gap-1.5">
        {!terminalArchived && !isApprovedInternal && !isApprovedClient && (
          <Button size="sm" variant="default" onClick={() => setOpen("approve")}>Approve (internal)</Button>
        )}
        {(isApprovedInternal || isApprovedClient) && (
          <Button size="sm" variant="default" onClick={() => setOpen("approve_for_client_view")}>
            Approve for client view
          </Button>
        )}
        {(isApprovedInternal || isApprovedClient) && (
          <Button size="sm" variant="outline" onClick={() => setOpen("approve_for_outreach")}>
            Approve for outreach
          </Button>
        )}
        {!terminalArchived && <Button size="sm" variant="destructive" onClick={() => setOpen("reject")}>Reject</Button>}
        {!terminalArchived && <Button size="sm" variant="outline" onClick={() => setOpen("escalate")}>Escalate…</Button>}
        {!terminalArchived && <Button size="sm" variant="outline" onClick={() => setOpen("needs_more_research")}>Needs more research</Button>}
        {!terminalArchived && <Button size="sm" variant="outline" onClick={() => setOpen("under_review")}>Under review</Button>}
        {!terminalArchived && <Button size="sm" variant="outline" onClick={() => setOpen("confidence_override")}>Override Discovery Confidence</Button>}
        {!terminalArchived && <Button size="sm" variant="outline" onClick={() => setOpen("mark_duplicate")}>Mark duplicate</Button>}
        {!terminalArchived && <Button size="sm" variant="outline" onClick={() => setOpen("mark_not_relevant")}>Mark not relevant</Button>}
        <Button size="sm" variant="outline" onClick={() => setOpen("set_feedback_reason")}>Feedback reason</Button>
        <Button size="sm" variant="outline" onClick={() => setOpen("set_due_date")}>Set due date</Button>
        <Button size="sm" variant="outline" onClick={() => setOpen("assign")}>Assign</Button>
        <Button size="sm" variant="outline" onClick={() => setOpen("request_rerun")}>Request rerun</Button>
        {row.status !== "archived" && !terminalArchived && <Button size="sm" variant="outline" onClick={() => setOpen("archive")}>Archive</Button>}
        <Button size="sm" variant="outline" onClick={() => setOpen("reviewer_note")}>Reviewer note</Button>
        <Button size="sm" variant="outline" onClick={() => setOpenEdit(true)}>Edit payload…</Button>
        <Button size="sm" variant="outline" onClick={() => setOpenVersions(true)}>View versions</Button>
      </div>
      {open ? (
        <DecisionDialog
          spec={DIALOG_SPECS[open]}
          row={row}
          onClose={() => setOpen(null)}
          onSuccess={() => { setOpen(null); onDone(); }}
        />
      ) : null}
      {openEdit ? <EditPayloadDialog row={row} onClose={() => setOpenEdit(false)} /> : null}
      {openVersions ? <VersionsDrawer row={row} onClose={() => setOpenVersions(false)} /> : null}
    </div>
  );
}

function DecisionDialog({
  spec,
  row,
  onClose,
  onSuccess,
}: {
  spec: DialogSpec;
  row: ProposedRow;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [override, setOverride] = useState<string>(row.confidence_override ?? row.confidence_level);
  const [assigneeId, setAssigneeId] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [feedbackReason, setFeedbackReason] = useState<string>(FEEDBACK_REASONS[0]);
  const [escalationTarget, setEscalationTarget] = useState<string>(ESCALATION_TARGETS[0]);
  const [clientVisibleAck, setClientVisibleAck] = useState(false);

  const mut = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {
        proposed_match_id: row.id,
        action: spec.action,
      };
      if (spec.needsReason) payload.reason = reason.trim();
      if (spec.needsNote && note.trim()) payload.note = note;
      if (spec.needsOverride) {
        payload.confidence_override = override;
        payload.reason = reason.trim();
      }
      if (spec.needsAssignee) payload.assignee_id = assigneeId.trim();
      if (spec.needsDueAt) payload.due_at = new Date(dueAt).toISOString();
      if (spec.needsFeedbackReason) payload.feedback_reason = feedbackReason;
      if (spec.needsEscalationTarget) payload.escalation_target = escalationTarget;
      const { data, error } = await supabase.functions.invoke("ai-proposed-match-decision", { body: payload });
      if (error) throw new Error(error.message || "Edge function error");
      if ((data as { error?: string })?.error) throw new Error((data as { error?: string }).error!);
      return data;
    },
    onSuccess: () => {
      toast.success(`${spec.title} — recorded`);
      qc.invalidateQueries({ queryKey: ["ai-proposed-matches"] });
      qc.invalidateQueries({ queryKey: ["ai-proposed-match-audit", row.id] });
      onSuccess();
    },
    onError: (err: Error) => {
      toast.error(`Action failed: ${err.message}`);
    },
  });

  const reasonRequired = !!spec.needsReason || !!spec.needsOverride;
  const canSubmit =
    !mut.isPending &&
    (!reasonRequired || reason.trim().length > 0) &&
    (!spec.needsOverride || (CONFIDENCE_LEVELS as readonly string[]).includes(override)) &&
    (!spec.needsAssignee || assigneeId.trim().length > 0) &&
    (!spec.needsDueAt || (!!dueAt && !Number.isNaN(Date.parse(dueAt)))) &&
    (!spec.clientVisibleConfirm || clientVisibleAck);

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{spec.title}</DialogTitle>
          <DialogDescription>{spec.description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {spec.clientVisibleConfirm ? (
            <div className="border border-amber-300 bg-amber-50 rounded-sm p-3 text-[12px] text-amber-900 space-y-2">
              <p className="font-medium">Heads up — client-visible exposure.</p>
              <p>
                Approving for client view sets <span className="font-mono">client_visible = true</span> and
                snapshots the approved payload. In a future phase (Phase 4) this snapshot may be shown
                to the trade-request originator. No external user surfaces are built yet. AI Intel
                Confidence remains advisory and is not labelled as verified.
              </p>
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={clientVisibleAck}
                  onChange={(e) => setClientVisibleAck(e.target.checked)}
                  className="mt-0.5"
                />
                <span>I understand this approval is a separate, audited, client-visible exposure step.</span>
              </label>
            </div>
          ) : null}
          {spec.needsOverride ? (
            <div className="space-y-1.5">
              <Label htmlFor="ai-override-level">Discovery Confidence</Label>
              <Select value={override} onValueChange={setOverride}>
                <SelectTrigger id="ai-override-level"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CONFIDENCE_LEVELS.map((l) => (
                    <SelectItem key={l} value={l}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          {spec.needsEscalationTarget ? (
            <div className="space-y-1.5">
              <Label htmlFor="ai-escalation-target">Escalation target</Label>
              <Select value={escalationTarget} onValueChange={setEscalationTarget}>
                <SelectTrigger id="ai-escalation-target"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ESCALATION_TARGETS.map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          {spec.needsFeedbackReason ? (
            <div className="space-y-1.5">
              <Label htmlFor="ai-feedback-reason">Feedback reason</Label>
              <Select value={feedbackReason} onValueChange={setFeedbackReason}>
                <SelectTrigger id="ai-feedback-reason"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FEEDBACK_REASONS.map((r) => (
                    <SelectItem key={r} value={r}>{r.replace(/_/g, " ")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          {spec.needsAssignee ? (
            <div className="space-y-1.5">
              <Label htmlFor="ai-assignee">Platform admin user id</Label>
              <Input id="ai-assignee" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} placeholder="UUID of platform_admin reviewer" />
            </div>
          ) : null}
          {spec.needsDueAt ? (
            <div className="space-y-1.5">
              <Label htmlFor="ai-due-at">Due date</Label>
              <Input id="ai-due-at" type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
            </div>
          ) : null}
          {spec.needsReason ? (
            <div className="space-y-1.5">
              <Label htmlFor="ai-reason">Reason {reasonRequired ? <span className="text-rose-600">*</span> : null}</Label>
              <Textarea id="ai-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="Short, factual reason recorded in the audit trail." rows={3} />
              <p className="text-[10.5px] font-mono text-muted-foreground">{reason.length}/500</p>
            </div>
          ) : null}
          {spec.needsNote ? (
            <div className="space-y-1.5">
              <Label htmlFor="ai-note">Reviewer note (optional)</Label>
              <Textarea id="ai-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} rows={3} />
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={mut.isPending}>Cancel</Button>
          <Button onClick={() => mut.mutate()} disabled={!canSubmit} variant={spec.destructive ? "destructive" : "default"}>
            {mut.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : null}
            {spec.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Edit payload — admin-only. Edits safe advisory fields. Calls `edit_payload`
// on the decision edge function which lazily snapshots `original_payload` and
// stamps `edited_payload`. Edits are NOT approved; a separate approve action
// is still required.
// ─────────────────────────────────────────────────────────────────────────────
const SAFE_EDIT_FIELDS = [
  "suggested_counterparty_name",
  "counterparty_role",
  "jurisdiction",
  "sector_or_product_fit",
  "capacity_indicator",
  "prior_activity_summary",
  "source_summary",
  "match_rationale",
] as const;

function EditPayloadDialog({ row, onClose }: { row: ProposedRow; onClose: () => void }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const f of SAFE_EDIT_FIELDS) {
      const v = (row as unknown as Record<string, unknown>)[f];
      out[f] = typeof v === "string" ? v : "";
    }
    return out;
  });
  const [reason, setReason] = useState("");

  const mut = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("ai-proposed-match-decision", {
        body: {
          proposed_match_id: row.id,
          action: "edit_payload",
          edited_payload: draft,
          reason: reason.trim() || undefined,
        },
      });
      if (error) throw new Error(error.message || "Edge function error");
      if ((data as { error?: string })?.error) throw new Error((data as { error?: string }).error!);
      return data;
    },
    onSuccess: () => {
      toast.success("Edit recorded. Not yet approved — separate approval required.");
      qc.invalidateQueries({ queryKey: ["ai-proposed-matches"] });
      qc.invalidateQueries({ queryKey: ["ai-proposed-match-audit", row.id] });
      onClose();
    },
    onError: (err: Error) => toast.error(`Edit failed: ${err.message}`),
  });

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit advisory fields</DialogTitle>
          <DialogDescription>
            Edits the safe advisory fields only. The original AI payload is preserved as
            <span className="font-mono"> original_payload</span> and your edits are saved as
            <span className="font-mono"> edited_payload</span>. <b>Edits are not approved</b> — a separate
            approval action is still required before any client-visible or outreach step.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {SAFE_EDIT_FIELDS.map((f) => (
            <div key={f} className="space-y-1.5">
              <Label htmlFor={`edit-${f}`} className="font-mono text-[11px] tracking-[0.1em] uppercase">{f}</Label>
              <Textarea
                id={`edit-${f}`}
                value={draft[f] ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, [f]: e.target.value }))}
                rows={2}
                maxLength={4000}
              />
            </div>
          ))}
          <div className="space-y-1.5">
            <Label htmlFor="edit-reason">Reason (optional)</Label>
            <Textarea id="edit-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={mut.isPending}>Cancel</Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
            {mut.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : null}
            Save edit (not approved)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Versions drawer — shows original AI payload, edited payload and approved
// payload side-by-side. Admin-only. Not exposed to external users.
// ─────────────────────────────────────────────────────────────────────────────
function VersionsDrawer({ row, onClose }: { row: ProposedRow; onClose: () => void }) {
  // Fetch the full row to pick up payload columns not in the list select.
  const q = useQuery({
    queryKey: ["ai-proposed-match-versions", row.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_proposed_matches")
        .select("original_payload, edited_payload, approved_payload, client_visible, status")
        .eq("id", row.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-3xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Payload versions · admin only</SheetTitle>
          <SheetDescription>
            Side-by-side view of the original AI payload, any admin edits, and the snapshot taken at
            client-visible approval. Not shown to external users. AI Intel Confidence is advisory and
            is not labelled as verified.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-4 space-y-4">
          <div className="text-[11px] font-mono text-muted-foreground">
            status · {q.data?.status ?? row.status} · client_visible · {String(q.data?.client_visible ?? false)}
          </div>
          <VersionBlock title="Original AI payload" value={q.data?.original_payload as unknown} />
          <VersionBlock title="Edited payload (admin)" value={q.data?.edited_payload as unknown} />
          <VersionBlock title="Approved payload (snapshot at client-visible approval)" value={q.data?.approved_payload as unknown} />
        </div>
      </SheetContent>
    </Sheet>
  );
}

function VersionBlock({ title, value }: { title: string; value: unknown }) {
  const isEmpty = value == null || (typeof value === "object" && Object.keys(value as object).length === 0);
  return (
    <div className="border border-border rounded-sm">
      <div className="px-3 py-2 border-b border-border bg-muted/40 font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground">
        {title}
      </div>
      {isEmpty ? (
        <p className="px-3 py-3 text-[12.5px] text-muted-foreground italic">Not yet captured.</p>
      ) : (
        <pre className="px-3 py-3 text-[11.5px] whitespace-pre-wrap break-words font-mono leading-snug text-foreground">
          {JSON.stringify(value, null, 2)}
        </pre>
      )}
    </div>
  );
}



// ─────────────────────────────────────────────────────────────────────────────
// Do-Not-Contact rules manager. Mutations go through `ai-do-not-contact-rules`
// (platform_admin only). Create is idempotent on (rule_type, rule_value) while
// active. Deactivate on an already-inactive rule is a no-op. Sourcing reads
// the same table; no separate cache is involved.
// ─────────────────────────────────────────────────────────────────────────────
const DNC_RULE_TYPES = [
  "specific_counterparty",
  "jurisdiction",
  "source_type",
  "opportunity_type",
  "organisation",
  "domain",
  "email",
] as const;

type DncRule = {
  id: string;
  rule_type: string;
  rule_value: string;
  reason: string | null;
  active: boolean;
  created_at: string;
  deactivated_at: string | null;
};

export function DoNotContactPanel() {
  const qc = useQueryClient();
  const [openAdd, setOpenAdd] = useState(false);
  const [showInactive, setShowInactive] = useState(false);

  const list = useQuery({
    queryKey: ["ai-dnc-rules"],
    queryFn: async (): Promise<DncRule[]> => {
      const { data, error } = await supabase
        .from("ai_do_not_contact_rules")
        .select("id, rule_type, rule_value, reason, active, created_at, deactivated_at")
        .order("active", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as DncRule[];
    },
  });

  const deactivate = useMutation({
    mutationFn: async (rule_id: string) => {
      const { data, error } = await supabase.functions.invoke("ai-do-not-contact-rules", {
        body: { op: "deactivate", rule_id },
      });
      if (error) throw new Error(error.message || "Edge function error");
      if ((data as { error?: string })?.error) throw new Error((data as { error?: string }).error!);
      return data;
    },
    onSuccess: () => {
      toast.success("Rule deactivated");
      qc.invalidateQueries({ queryKey: ["ai-dnc-rules"] });
    },
    onError: (err: Error) => toast.error(`Deactivate failed: ${err.message}`),
  });

  const rows = useMemo(
    () => (list.data ?? []).filter((r) => (showInactive ? true : r.active)),
    [list.data, showInactive],
  );

  return (
    <div className="p-4 sm:p-5 space-y-3">
      <div className="flex items-center gap-2">
        <Ban className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.75} />
        <h3 className="text-[13px] font-medium text-foreground">Do-not-contact rules</h3>
        <span className="font-mono text-[10px] tracking-[0.15em] uppercase text-muted-foreground">
          ai_do_not_contact_rules · sourcing-time filter
        </span>
        <div className="ml-auto flex gap-1.5">
          <Button size="sm" variant="outline" onClick={() => setShowInactive((s) => !s)}>
            {showInactive ? "Hide inactive" : "Show inactive"}
          </Button>
          <Button size="sm" onClick={() => setOpenAdd(true)}>Add rule</Button>
        </div>
      </div>
      <p className="text-[11.5px] text-muted-foreground">
        Rules block counterparties from appearing in AI sourcing. Adding a rule that already exists is
        idempotent: no duplicate row and no duplicate audit. Deactivation is recorded against the
        original rule and is also idempotent.
      </p>

      <div className="border border-border rounded-sm overflow-hidden">
        <table className="w-full text-[13px]">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr className="text-left">
              <Th>Type</Th>
              <Th>Value</Th>
              <Th>Reason</Th>
              <Th>Status</Th>
              <Th>Added</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {list.isLoading ? (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground text-sm">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground text-sm">No do-not-contact rules.</td></tr>
            ) : rows.map((r) => (
              <tr key={r.id} className="border-t border-border">
                <Td className="font-mono text-[11.5px]">{r.rule_type}</Td>
                <Td className="font-mono text-[11.5px] break-all">{r.rule_value}</Td>
                <Td className="text-muted-foreground">{r.reason ?? "—"}</Td>
                <Td>
                  <Badge variant="outline" className={r.active ? "bg-rose-50 text-rose-700 border-rose-200" : "bg-slate-100 text-slate-500 border-slate-200"}>
                    {r.active ? "active · blocking" : "inactive"}
                  </Badge>
                </Td>
                <Td className="font-mono text-[11px] text-muted-foreground">{new Date(r.created_at).toISOString().slice(0, 10)}</Td>
                <Td className="text-right">
                  {r.active ? (
                    <Button size="sm" variant="outline" disabled={deactivate.isPending} onClick={() => deactivate.mutate(r.id)}>
                      Deactivate
                    </Button>
                  ) : null}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {openAdd ? <DncAddDialog onClose={() => setOpenAdd(false)} /> : null}
    </div>
  );
}

function DncAddDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [ruleType, setRuleType] = useState<string>("organisation");
  const [ruleValue, setRuleValue] = useState("");
  const [reason, setReason] = useState("");

  const mut = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("ai-do-not-contact-rules", {
        body: { op: "create", rule_type: ruleType, rule_value: ruleValue.trim(), reason: reason.trim() || null },
      });
      if (error) throw new Error(error.message || "Edge function error");
      if ((data as { error?: string })?.error) throw new Error((data as { error?: string }).error!);
      return data as { rule: DncRule; idempotent?: boolean };
    },
    onSuccess: (data) => {
      toast.success(data.idempotent ? "Rule already exists (no change)" : "Rule added");
      qc.invalidateQueries({ queryKey: ["ai-dnc-rules"] });
      onClose();
    },
    onError: (err: Error) => toast.error(`Add failed: ${err.message}`),
  });

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add do-not-contact rule</DialogTitle>
          <DialogDescription>
            Blocks matching counterparties from appearing in AI sourcing. Submission is idempotent.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="dnc-type">Rule type</Label>
            <Select value={ruleType} onValueChange={setRuleType}>
              <SelectTrigger id="dnc-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                {DNC_RULE_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dnc-value">Value</Label>
            <Input id="dnc-value" value={ruleValue} onChange={(e) => setRuleValue(e.target.value)} maxLength={500} placeholder="e.g. org-uuid, example.com, ZA" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dnc-reason">Reason (optional)</Label>
            <Textarea id="dnc-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={mut.isPending}>Cancel</Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending || !ruleValue.trim()}>
            {mut.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : null}
            Add rule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
