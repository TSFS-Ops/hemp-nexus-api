/**
 * P-5 Batch 5 — Phase 5
 * Permission-aware Memory History Panel.
 *
 * Display-only. Hides sensitive fields by default; never renders raw
 * provider payloads, raw bank details, private/internal/support notes,
 * or draft AI suggestions. All data is fetched and shaped by the caller
 * (typically via a server-side function that already respects RLS and
 * Phase 4 projection) — this panel never queries Supabase directly.
 */
import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  P5B5_FINALITY_STATUS_LABELS,
  P5B5_MEMORY_STATUS_LABELS,
  type P5B5CorrectionStatus,
  type P5B5DisputeStatus,
  type P5B5FinalityStatus,
  type P5B5FinalOutcomeCode,
  type P5B5MemoryStatus,
  type P5B5ProviderDependencyStatus,
} from "@/lib/p5-batch5/outcomes";
import {
  getP5B5Capabilities,
  type P5B5PermissionContext,
  type P5B5Role,
} from "@/lib/p5-batch5/permissions";
import { P5B5_APPROVED_PHRASES, P5B5_APPROVED_TOOLTIPS } from "@/lib/p5-batch5/wording";

export interface P5B5MemoryHistoryRow {
  id: string;
  event_at: string;
  event_type: string;
  final_outcome_code: P5B5FinalOutcomeCode | null;
  source_case_id: string | null;
  subject_label: string;
  decision_maker_role: string | null;
  evidence_rating: string | null;
  provider_state: P5B5ProviderDependencyStatus | null;
  waiver_flag: boolean;
  dispute_status: P5B5DisputeStatus;
  correction_status: P5B5CorrectionStatus;
  finality_status: P5B5FinalityStatus;
  memory_status: P5B5MemoryStatus;
  audit_hash_reference: string | null;
}

export interface P5B5MemoryHistorySummary {
  subject_label: string;
  current_memory_status: P5B5MemoryStatus;
  confidence_marker: "low" | "moderate" | "high" | null;
  latest_finality_status: P5B5FinalityStatus | null;
  latest_outcome_code: P5B5FinalOutcomeCode | null;
  evidence_rating: string | null;
  has_open_dispute: boolean;
  has_open_correction: boolean;
  final_record_count: number;
  last_updated_at: string | null;
  permitted_reliance_level: "view_only" | "operational" | "reliance" | "audit";
}

export interface P5B5MemoryHistoryPanelProps {
  role: P5B5Role;
  context?: P5B5PermissionContext;
  summary: P5B5MemoryHistorySummary;
  rows: ReadonlyArray<P5B5MemoryHistoryRow>;
}

export function P5B5MemoryHistoryPanel({
  role,
  context,
  summary,
  rows,
}: P5B5MemoryHistoryPanelProps) {
  const caps = getP5B5Capabilities(role, context);
  const [filter, setFilter] = useState("");

  const visibleRows = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const filtered = f
      ? rows.filter(
          (r) =>
            r.subject_label.toLowerCase().includes(f) ||
            (r.final_outcome_code ?? "").toLowerCase().includes(f) ||
            (r.source_case_id ?? "").toLowerCase().includes(f),
        )
      : rows.slice();

    // Default sort: latest material finality or correction first, then by date desc.
    return filtered.sort((a, b) => {
      const ax =
        (a.dispute_status === "under_dispute" ? 3 : 0) +
        (a.correction_status !== "none" ? 2 : 0) +
        (a.finality_status === "final" ? 1 : 0);
      const bx =
        (b.dispute_status === "under_dispute" ? 3 : 0) +
        (b.correction_status !== "none" ? 2 : 0) +
        (b.finality_status === "final" ? 1 : 0);
      if (ax !== bx) return bx - ax;
      return (b.event_at ?? "").localeCompare(a.event_at ?? "");
    });
  }, [rows, filter]);

  if (!caps.can_view_full_memory && !caps.can_view_org_memory && !caps.can_view_case_finality) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Memory history</CardTitle>
          <CardDescription>You do not have permission to view Memory.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card data-p5b5-memory-history>
      <CardHeader>
        <CardTitle className="text-base">{summary.subject_label} — Memory history</CardTitle>
        <CardDescription title={P5B5_APPROVED_TOOLTIPS.WHAT_IS_MEMORY}>
          {P5B5_APPROVED_PHRASES.EVIDENCE_BASIS}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
          <Stat label="Memory status" value={P5B5_MEMORY_STATUS_LABELS[summary.current_memory_status]} />
          <Stat label="Confidence" value={summary.confidence_marker ?? "—"} />
          <Stat
            label="Latest finality"
            value={
              summary.latest_finality_status
                ? P5B5_FINALITY_STATUS_LABELS[summary.latest_finality_status]
                : "—"
            }
          />
          <Stat label="Latest outcome" value={summary.latest_outcome_code ?? "—"} />
          {caps.can_view_full_memory || caps.can_view_org_memory ? (
            <Stat label="Evidence rating" value={summary.evidence_rating ?? "—"} />
          ) : null}
          <Stat label="Final records" value={String(summary.final_record_count)} />
          <Stat label="Last updated" value={summary.last_updated_at ?? "—"} />
          <Stat label="Reliance level" value={summary.permitted_reliance_level} />
        </div>

        <div className="flex flex-wrap items-end gap-2">
          {(summary.has_open_dispute) && (
            <Badge variant="secondary">{P5B5_APPROVED_PHRASES.UNDER_DISPUTE_SHORT}</Badge>
          )}
          {(summary.has_open_correction) && (
            <Badge variant="secondary">{P5B5_APPROVED_PHRASES.CORRECTED_SHORT}</Badge>
          )}
          {summary.current_memory_status === "paused" && (
            <Badge variant="secondary">{P5B5_APPROVED_PHRASES.MEMORY_PAUSED}</Badge>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="p5b5-mem-filter" className="text-xs">Filter</Label>
          <Input
            id="p5b5-mem-filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by subject, outcome, case id"
          />
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Event</TableHead>
              <TableHead>Outcome</TableHead>
              <TableHead>Subject</TableHead>
              <TableHead>Role</TableHead>
              {caps.can_view_full_memory || caps.can_view_org_memory ? (
                <TableHead>Evidence rating</TableHead>
              ) : null}
              <TableHead>Provider</TableHead>
              <TableHead>Waiver</TableHead>
              <TableHead>Dispute</TableHead>
              <TableHead>Correction</TableHead>
              {caps.can_view_raw_provider_summary ? <TableHead>Audit ref</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={11} className="text-center text-muted-foreground">
                  No history rows to display.
                </TableCell>
              </TableRow>
            ) : (
              visibleRows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap">{r.event_at}</TableCell>
                  <TableCell>{r.event_type}</TableCell>
                  <TableCell>{r.final_outcome_code ?? "—"}</TableCell>
                  <TableCell>{r.subject_label}</TableCell>
                  <TableCell>{r.decision_maker_role ?? "—"}</TableCell>
                  {caps.can_view_full_memory || caps.can_view_org_memory ? (
                    <TableCell>{r.evidence_rating ?? "—"}</TableCell>
                  ) : null}
                  <TableCell>{r.provider_state ?? "—"}</TableCell>
                  <TableCell>{r.waiver_flag ? "Yes" : "—"}</TableCell>
                  <TableCell>{r.dispute_status}</TableCell>
                  <TableCell>{r.correction_status}</TableCell>
                  {caps.can_view_raw_provider_summary ? (
                    <TableCell className="font-mono text-xs">{r.audit_hash_reference ?? "—"}</TableCell>
                  ) : null}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

        <p className="text-xs text-muted-foreground">
          Private/internal notes, raw provider payloads, raw bank details and draft AI
          suggestions are never displayed in this panel.
        </p>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm">{value}</div>
    </div>
  );
}

export default P5B5MemoryHistoryPanel;
