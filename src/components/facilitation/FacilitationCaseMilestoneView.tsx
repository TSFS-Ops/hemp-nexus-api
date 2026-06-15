/**
 * FacilitationCaseMilestoneView - requester-facing case view.
 *
 * Shows the milestone (user_facing_status), case number, summary, and the
 * cancellable action. No outreach, no contact, no notification dispatch.
 */
import React, { useEffect, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BackButton } from "@/components/BackButton";
import { toast } from "sonner";
import { friendlyFacilitationError } from "@/lib/facilitation-labels";
import {
  USER_FACING_LABELS,
  ROLE_LABELS,
  type FacilitationUserFacingStatus,
  type FacilitationRole,
} from "@/lib/facilitation-case-state";

type FacilitationCase = {
  id: string;
  case_number: string;
  internal_status: string;
  user_facing_status: FacilitationUserFacingStatus;
  counterparty_legal_name: string;
  counterparty_country: string;
  product_or_commodity: string;
  role: FacilitationRole;
  urgency: string;
  created_at: string;
  closed_at: string | null;
  closing_reason: string | null;
};

export const FacilitationCaseMilestoneView: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [kase, setKase] = useState<FacilitationCase | null>(null);
  const [events, setEvents] = useState<Array<{ id: string; action: string; created_at: string; payload: Record<string, unknown> | null }>>([]);
  const [coarseOutreach, setCoarseOutreach] = useState<"not_started" | "in_progress" | "sent" | "blocked">("not_started");
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("get-facilitation-case", { body: { case_id: id } });
      if (error) throw error;
      const payload = data as { case: FacilitationCase; events: typeof events; coarse_outreach_state?: typeof coarseOutreach };
      setKase(payload.case);
      setEvents(payload.events ?? []);
      setCoarseOutreach(payload.coarse_outreach_state ?? "not_started");
    } catch (err: unknown) {
      const msg = await friendlyFacilitationError(err, "Could not load this facilitation case. Please try again.");
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const onCancel = async () => {
    if (!kase) return;
    if (!confirm("Cancel this facilitation request? This cannot be undone.")) return;
    setCancelling(true);
    try {
      const { error } = await supabase.functions.invoke("facilitation-case-admin-action", {
        body: { action: "status_change", case_id: kase.id, to_status: "cancelled_by_requester", closing_reason: "Cancelled by requester" },
      });
      if (error) throw error;
      toast.success("Request cancelled.");
      await load();
    } catch (err: unknown) {
      const msg = await friendlyFacilitationError(err, "Could not cancel this case. Please try again.");
      toast.error(msg);
    } finally {
      setCancelling(false);
    }
  };

  if (loading) return <div className="text-sm text-slate-500">Loading…</div>;
  if (!kase) return <div className="text-sm text-slate-500">Case not found.</div>;

  const canCancel = !["cancelled_by_requester", "closed", "converted_to_known_counterparty_poi", "unable_to_proceed", "blocked_by_compliance", "counterparty_declined"].includes(kase.internal_status);

  return (
    <div className="max-w-3xl space-y-6">
      <BackButton />
      <header>
        <p className="text-xs text-slate-500 mb-2">
          Facilitation request · {kase.case_number}
        </p>
        <h1 className="text-3xl font-semibold text-slate-900 tracking-tight">
          {kase.counterparty_legal_name}
        </h1>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{USER_FACING_LABELS[kase.user_facing_status] ?? kase.user_facing_status}</Badge>
          <Badge variant="outline">Urgency: {kase.urgency}</Badge>
          <Badge variant="outline">Your role: {ROLE_LABELS[kase.role] ?? kase.role}</Badge>
        </div>
      </header>

      <Card>
        <CardHeader><CardTitle className="text-base">Summary</CardTitle></CardHeader>
        <CardContent className="text-sm text-slate-700 space-y-2">
          <div><span className="text-slate-500">Product:</span> {kase.product_or_commodity}</div>
          <div><span className="text-slate-500">Country:</span> {kase.counterparty_country}</div>
          <div><span className="text-slate-500">Submitted:</span> {new Date(kase.created_at).toLocaleString()}</div>
          {kase.closed_at && <div><span className="text-slate-500">Closed:</span> {new Date(kase.closed_at).toLocaleString()}</div>}
          {kase.closing_reason && <div><span className="text-slate-500">Reason:</span> {kase.closing_reason}</div>}
        </CardContent>
      </Card>

      {(() => {
        const milestoneEvents = events.filter((ev) => ev.action === "facilitation_case.milestone_changed");
        if (milestoneEvents.length === 0) return null;
        return (
          <Card>
            <CardHeader><CardTitle className="text-base">Progress</CardTitle></CardHeader>
            <CardContent>
              <ol className="space-y-3 text-sm">
                {milestoneEvents.map((ev) => {
                  const to = (ev.payload && typeof (ev.payload as Record<string, unknown>).to_user_facing === "string")
                    ? (ev.payload as Record<string, unknown>).to_user_facing as string
                    : null;
                  const label = to && USER_FACING_LABELS[to as FacilitationUserFacingStatus]
                    ? USER_FACING_LABELS[to as FacilitationUserFacingStatus]
                    : "Status updated";
                  return (
                    <li key={ev.id} className="flex items-start gap-3">
                      <span className="text-xs text-slate-500 w-40 shrink-0">{new Date(ev.created_at).toLocaleString()}</span>
                      <span className="text-slate-700">{label}</span>
                    </li>
                  );
                })}
              </ol>
            </CardContent>
          </Card>
        );
      })()}

      {canCancel && (
        <div className="flex justify-end">
          <Button variant="outline" onClick={onCancel} disabled={cancelling}>
            {cancelling ? "Cancelling…" : "Cancel request"}
          </Button>
        </div>
      )}
    </div>
  );
};

export default FacilitationCaseMilestoneView;
