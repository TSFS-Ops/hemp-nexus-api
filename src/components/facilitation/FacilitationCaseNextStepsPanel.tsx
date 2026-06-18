/**
 * Batch 9B — Positive-response next-step tasks (admin-only panel).
 *
 * Renders inside the admin FacilitationCaseDrawer. Reads directly from
 * `facilitation_case_next_steps` (RLS restricts visibility to platform_admin,
 * compliance_analyst, the case owner, or the task assignee — requesters
 * cannot see this section under any circumstance).
 *
 * Pure UI for a controlled internal task — no POI, WaD, verification,
 * compliance clearance, commercial state or external outreach.
 */
import React, { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { NEXT_STEP_STATUS_LABELS, type FacilitationNextStepStatus } from "@/lib/facilitation-case-state";
import { friendlyFacilitationError } from "@/lib/facilitation-labels";

type NextStepRow = {
  id: string;
  status: FacilitationNextStepStatus;
  next_step_type: string;
  title: string;
  description: string;
  required_actions: string[] | null;
  assigned_to: string | null;
  created_at: string;
  completed_at: string | null;
  completion_note: string | null;
};

export const FacilitationCaseNextStepsPanel: React.FC<{
  caseId: string;
  onChanged?: () => void;
}> = ({ caseId, onChanged }) => {
  const [rows, setRows] = useState<NextStepRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [completeFor, setCompleteFor] = useState<string | null>(null);
  const [completionNote, setCompletionNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("facilitation_case_next_steps")
        .select("id,status,next_step_type,title,description,required_actions,assigned_to,created_at,completed_at,completion_note")
        .eq("case_id", caseId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      setRows((data ?? []) as unknown as NextStepRow[]);
    } catch (err: unknown) {
      // RLS denies for requesters — silently render nothing.
      setRows([]);
      void err;
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => { void load(); }, [load]);

  const callAction = async (body: Record<string, unknown>) => {
    const { error } = await supabase.functions.invoke("facilitation-case-admin-action", { body });
    if (error) throw error;
    await load();
    onChanged?.();
  };

  const doStart = async (id: string) => {
    try {
      await callAction({ action: "update_next_step_status", case_id: caseId, next_step_id: id, to_status: "in_progress" });
      toast.success("Task marked as in progress.");
    } catch (err: unknown) {
      toast.error(await friendlyFacilitationError(err, "Could not update this task. Please try again."));
    }
  };
  const doCancel = async (id: string) => {
    try {
      await callAction({ action: "update_next_step_status", case_id: caseId, next_step_id: id, to_status: "cancelled" });
      toast.success("Task cancelled.");
    } catch (err: unknown) {
      toast.error(await friendlyFacilitationError(err, "Could not cancel this task. Please try again."));
    }
  };
  const doComplete = async () => {
    if (!completeFor) return;
    if (completionNote.trim().length < 3) {
      toast.error("Please add a short completion note (at least 3 characters).");
      return;
    }
    setSubmitting(true);
    try {
      await callAction({ action: "complete_next_step", case_id: caseId, next_step_id: completeFor, completion_note: completionNote.trim() });
      toast.success("Task completed.");
      setCompleteFor(null);
      setCompletionNote("");
    } catch (err: unknown) {
      toast.error(await friendlyFacilitationError(err, "Could not complete this task. Please try again."));
    } finally {
      setSubmitting(false);
    }
  };

  // Hide the section entirely when there is nothing to show (e.g. requester
  // view, or no positive response yet).
  if (!rows || rows.length === 0) return null;

  return (
    <section className="space-y-2 rounded-md border border-emerald-200 bg-emerald-50/40 p-3">
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-slate-900">Positive response next steps</h3>
        {loading ? <span className="text-xs text-slate-500">Loading…</span> : null}
      </div>
      <p className="text-xs text-slate-600">
        Internal-only follow-up tasks created when the counterparty responded positively.
        Completing these tasks does not create a POI, WaD, verification or commercial state.
      </p>
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.id} className="rounded border border-slate-200 bg-white p-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <div className="font-medium text-slate-900">{r.title}</div>
              <Badge variant={r.status === "completed" ? "secondary" : r.status === "cancelled" ? "outline" : "default"}>
                {NEXT_STEP_STATUS_LABELS[r.status]}
              </Badge>
            </div>
            <div className="mt-1 text-slate-700 whitespace-pre-wrap">{r.description}</div>
            {Array.isArray(r.required_actions) && r.required_actions.length > 0 ? (
              <div className="mt-2">
                <div className="text-xs text-slate-500">Required actions</div>
                <ul className="list-disc pl-5 mt-1 text-slate-800">
                  {r.required_actions.map((a, i) => <li key={i}>{a}</li>)}
                </ul>
              </div>
            ) : null}
            {r.completed_at ? (
              <div className="mt-2 text-xs text-slate-600">
                Completed {new Date(r.completed_at).toLocaleString()}
                {r.completion_note ? <div className="mt-1 whitespace-pre-wrap text-slate-700">Note: {r.completion_note}</div> : null}
              </div>
            ) : (
              <div className="mt-2 flex gap-2">
                {r.status === "open" ? (
                  <Button size="sm" variant="outline" onClick={() => void doStart(r.id)}>Mark in progress</Button>
                ) : null}
                {r.status !== "completed" && r.status !== "cancelled" ? (
                  <Dialog open={completeFor === r.id} onOpenChange={(o) => { if (!o) { setCompleteFor(null); setCompletionNote(""); } }}>
                    <DialogTrigger asChild>
                      <Button size="sm" onClick={() => setCompleteFor(r.id)}>Complete</Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-md">
                      <DialogHeader>
                        <DialogTitle>Complete next-step task</DialogTitle>
                        <DialogDescription>
                          Add a short completion note. This does not create a POI, WaD, verification, compliance clearance or commercial commitment.
                        </DialogDescription>
                      </DialogHeader>
                      <div className="space-y-2">
                        <Label htmlFor="cn">Completion note</Label>
                        <Textarea id="cn" rows={4} value={completionNote} onChange={(e) => setCompletionNote(e.target.value)} placeholder="Briefly record what was done and any internal next handover." />
                      </div>
                      <DialogFooter>
                        <Button variant="ghost" onClick={() => { setCompleteFor(null); setCompletionNote(""); }} disabled={submitting}>Cancel</Button>
                        <Button onClick={doComplete} disabled={submitting}>{submitting ? "Saving…" : "Save completion"}</Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                ) : null}
                {r.status !== "completed" && r.status !== "cancelled" ? (
                  <Button size="sm" variant="ghost" onClick={() => void doCancel(r.id)}>Cancel task</Button>
                ) : null}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
};
