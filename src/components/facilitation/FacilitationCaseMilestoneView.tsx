/**
 * FacilitationCaseMilestoneView - requester-facing case view.
 *
 * Shows the milestone (user_facing_status), case number, summary, the active
 * "more information needed" request (Batch 4), and the cancellable action.
 *
 * No outreach, no contact, no internal events, no admin notes,
 * no compliance / duplicate / DNC details.
 */
import React, { useEffect, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
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
  info_request_message: string | null;
  info_request_items: string[] | null;
  info_request_due_date: string | null;
  info_request_requested_at: string | null;
  info_request_response_message: string | null;
  info_request_response_at: string | null;
  info_request_response_evidence_summary: string | null;
};

export const FacilitationCaseMilestoneView: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [kase, setKase] = useState<FacilitationCase | null>(null);
  const [events, setEvents] = useState<Array<{ id: string; action: string; created_at: string; payload: Record<string, unknown> | null }>>([]);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const [responseMessage, setResponseMessage] = useState("");
  const [responseEvidence, setResponseEvidence] = useState("");
  const [submittingResponse, setSubmittingResponse] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("get-facilitation-case", { body: { case_id: id } });
      if (error) throw error;
      const payload = data as { case: FacilitationCase; events: typeof events };
      setKase(payload.case);
      setEvents(payload.events ?? []);
    } catch (err: unknown) {
      const msg = await friendlyFacilitationError(err, "Could not load this facilitation request. Please try again.");
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
      const msg = await friendlyFacilitationError(err, "Could not cancel this request. Please try again.");
      toast.error(msg);
    } finally {
      setCancelling(false);
    }
  };

  const onSubmitMoreInfo = async () => {
    if (!kase) return;
    if (responseMessage.trim().length < 2) {
      toast.error("Please write a short response before submitting.");
      return;
    }
    setSubmittingResponse(true);
    try {
      const { error } = await supabase.functions.invoke("facilitation-case-admin-action", {
        body: {
          action: "submit_more_information",
          case_id: kase.id,
          response_message: responseMessage.trim(),
          evidence_summary: responseEvidence.trim() ? responseEvidence.trim() : null,
        },
      });
      if (error) throw error;
      toast.success("Your response has been submitted.");
      setResponseMessage("");
      setResponseEvidence("");
      await load();
    } catch (err: unknown) {
      const msg = await friendlyFacilitationError(err, "Could not submit your response. Please try again.");
      toast.error(msg);
    } finally {
      setSubmittingResponse(false);
    }
  };

  if (loading) return <div className="text-sm text-slate-500">Loading…</div>;
  if (!kase) return <div className="text-sm text-slate-500">Request not found.</div>;

  const canCancel = !["cancelled_by_requester", "closed", "converted_to_known_counterparty_poi", "unable_to_proceed", "blocked_by_compliance", "counterparty_declined"].includes(kase.internal_status);
  const moreInfoActive = kase.internal_status === "more_information_needed" && !!kase.info_request_requested_at;
  const responseSubmitted = !!kase.info_request_response_at;

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

      {moreInfoActive && (
        <Card className="border-amber-200 bg-amber-50/40">
          <CardHeader>
            <CardTitle className="text-base">More information is needed</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-3">
            <p className="text-slate-700">
              More information is required before Izenzo can continue. Please provide the requested information.
            </p>
            {kase.info_request_message ? (
              <div className="rounded border border-slate-200 bg-white p-3 whitespace-pre-wrap text-slate-800">
                {kase.info_request_message}
              </div>
            ) : null}
            {Array.isArray(kase.info_request_items) && kase.info_request_items.length > 0 ? (
              <div>
                <div className="text-slate-500 mb-1">Items needed:</div>
                <ul className="list-disc pl-5 text-slate-800">
                  {kase.info_request_items.map((it, i) => <li key={i}>{it}</li>)}
                </ul>
              </div>
            ) : null}
            {kase.info_request_due_date ? (
              <div className="text-slate-700"><span className="text-slate-500">Please respond by:</span> {kase.info_request_due_date}</div>
            ) : null}

            {responseSubmitted ? (
              <div className="rounded border border-emerald-200 bg-emerald-50/60 p-3 text-emerald-900">
                <div className="font-medium">Response submitted</div>
                <div className="text-xs text-emerald-800 mt-1">
                  Submitted on {new Date(kase.info_request_response_at as string).toLocaleString()}. Izenzo is now reviewing your response.
                </div>
                {kase.info_request_response_message ? (
                  <div className="mt-2 whitespace-pre-wrap text-sm">{kase.info_request_response_message}</div>
                ) : null}
                {kase.info_request_response_evidence_summary ? (
                  <div className="mt-1 text-sm text-emerald-900/80"><span className="text-emerald-900/70">Source / evidence: </span>{kase.info_request_response_evidence_summary}</div>
                ) : null}
              </div>
            ) : (
              <div className="space-y-2">
                <div className="space-y-1">
                  <Label htmlFor="mi-response">Your response</Label>
                  <Textarea id="mi-response" rows={4} value={responseMessage} onChange={(e) => setResponseMessage(e.target.value)} placeholder="Provide the requested information here." />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="mi-evidence">Source / evidence (optional)</Label>
                  <Textarea id="mi-evidence" rows={2} value={responseEvidence} onChange={(e) => setResponseEvidence(e.target.value)} placeholder="Mention where the information came from, links, or any supporting source." />
                </div>
                <div className="flex justify-end">
                  <Button onClick={onSubmitMoreInfo} disabled={submittingResponse}>
                    {submittingResponse ? "Submitting…" : "Submit response"}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

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
