/**
 * FacilitationCaseSlaPanel — Batch 7
 *
 * Admin/owner/compliance-only SLA panel for the facilitation case drawer.
 * Shows due dates, overdue badge with plain-English reason, last evaluation
 * time, and a "Refresh SLA" button. All wording is plain English.
 *
 * Read-only display + a single non-destructive admin action — no automatic
 * status changes, no automatic outreach, no automatic POI conversion.
 */
import React, { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  OVERDUE_REASON_LABELS,
  SLA_DUE_LABELS,
  type OverdueReasonCode,
} from "@/lib/facilitation-sla";
import { friendlyFacilitationError } from "@/lib/facilitation-labels";

type SlaCaseFields = {
  owner_assignment_due_at: string | null;
  initial_triage_due_at: string | null;
  more_info_response_due_at: string | null;
  first_outreach_due_at: string | null;
  follow_up_outreach_due_at: string | null;
  compliance_review_due_at: string | null;
  next_action_due_at: string | null;
  is_overdue: boolean | null;
  overdue_reasons: string[] | null;
  sla_last_evaluated_at: string | null;
  last_activity_at: string | null;
};

const fmt = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString() : "—";

const overdue = (iso: string | null | undefined) =>
  !!iso && new Date(iso).getTime() < Date.now();

export const FacilitationCaseSlaPanel: React.FC<{
  caseId: string;
  kase: SlaCaseFields;
  onChanged?: () => void;
}> = ({ caseId, kase, onChanged }) => {
  const [refreshing, setRefreshing] = useState(false);
  const reasons = (kase.overdue_reasons ?? []) as OverdueReasonCode[];

  const refresh = async () => {
    setRefreshing(true);
    try {
      const { error } = await supabase.functions.invoke(
        "facilitation-case-sla-evaluate",
        { body: { case_id: caseId } },
      );
      if (error) throw error;
      toast.success("SLA refreshed.");
      onChanged?.();
    } catch (err: unknown) {
      toast.error(
        await friendlyFacilitationError(
          err,
          "Could not refresh SLA. Please try again.",
        ),
      );
    } finally {
      setRefreshing(false);
    }
  };

  const rows: Array<[keyof typeof SLA_DUE_LABELS, string | null]> = [
    ["next_action_due_at", kase.next_action_due_at],
    ["owner_assignment_due_at", kase.owner_assignment_due_at],
    ["initial_triage_due_at", kase.initial_triage_due_at],
    ["compliance_review_due_at", kase.compliance_review_due_at],
    ["first_outreach_due_at", kase.first_outreach_due_at],
    ["follow_up_outreach_due_at", kase.follow_up_outreach_due_at],
    ["more_info_response_due_at", kase.more_info_response_due_at],
  ];

  return (
    <section className="space-y-3 rounded-md border border-slate-200 bg-white p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="font-medium">Service-level tracking</h3>
          {kase.is_overdue ? (
            <Badge variant="destructive">Overdue</Badge>
          ) : (
            <Badge variant="secondary">On track</Badge>
          )}
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={refresh}
          disabled={refreshing}
        >
          {refreshing ? "Refreshing…" : "Refresh SLA"}
        </Button>
      </div>

      {kase.is_overdue && reasons.length > 0 ? (
        <ul className="text-xs text-rose-700 space-y-1">
          {reasons.map((r) => (
            <li key={r}>• {OVERDUE_REASON_LABELS[r] ?? r}</li>
          ))}
        </ul>
      ) : null}

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        {rows.map(([k, v]) => (
          <React.Fragment key={k}>
            <dt className="text-slate-500">{SLA_DUE_LABELS[k]}</dt>
            <dd
              className={
                overdue(v) ? "text-rose-700 font-medium" : "text-slate-800"
              }
            >
              {fmt(v)}
            </dd>
          </React.Fragment>
        ))}
      </dl>

      <div className="text-[11px] text-slate-500 flex flex-wrap gap-x-3">
        <span>
          Last SLA checked:{" "}
          <span className="text-slate-700">{fmt(kase.sla_last_evaluated_at)}</span>
        </span>
        <span>
          Last activity:{" "}
          <span className="text-slate-700">{fmt(kase.last_activity_at)}</span>
        </span>
      </div>
      <p className="text-[11px] text-slate-400">
        Business-hour calendar: Mon–Fri 09:00–17:00 UTC. Public-holiday
        calendar is not configured yet.
      </p>
    </section>
  );
};

export default FacilitationCaseSlaPanel;
