/**
 * ExecutionPanel - Proof-of-Delivery (PoD) lifecycle UI.
 *
 * Wraps the existing `pods` edge function:
 *   POST   ?action=create            create PoD with milestones
 *   POST   ?action=complete-milestone
 *   POST   ?action=breach
 *   POST   ?action=finalise
 *   GET    ?pod_id=...               fetch PoD with milestones + breaches
 *
 * All mutations carry an Idempotency-Key. Errors surface as toasts under the
 * project's Zero Swallowed Errors policy.
 */

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format, formatDistanceToNowStrict } from "date-fns";
import {
  CheckCircle2,
  AlertTriangle,
  Plus,
  Trash2,
  Flag,
  Lock,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { LoadingButton } from "@/components/ui/loading-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { fetchEdgeFunction } from "@/lib/edge-invoke";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  wadId: string;
  matchId: string;
}

interface Milestone {
  id: string;
  name: string;
  due_at: string;
  status: "pending" | "completed" | "deficient";
  completed_at: string | null;
  evidence_document_id: string | null;
  depends_on: string | null;
  sequence_order: number;
}

interface Breach {
  id: string;
  milestone_id: string | null;
  reason: string;
  status: string;
  detected_at: string;
}

interface PodPayload {
  id: string;
  state: "IN_PROGRESS" | "BREACHED" | "FINALISED" | "CANCELLED";
  wad_id: string;
  finalised_at: string | null;
  milestones: Milestone[];
  breaches: Breach[];
}

type ApiEnvelope<T> = { status: string; data: T };

function newKey() {
  return crypto.randomUUID();
}

export function ExecutionPanel({ wadId, matchId: _matchId }: Props) {
  const queryClient = useQueryClient();

  // Look up the existing PoD for this WaD (if any).
  const { data: existingPodId, isLoading: lookingUp } = useQuery({
    queryKey: ["pod-by-wad", wadId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pods")
        .select("id")
        .eq("wad_id", wadId)
        .neq("state", "CANCELLED")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data?.id ?? null;
    },
  });

  // Hydrate full PoD detail when one exists.
  const {
    data: pod,
    isLoading: loadingPod,
    refetch,
  } = useQuery({
    queryKey: ["pod-detail", existingPodId],
    queryFn: async () => {
      if (!existingPodId) return null;
      const res = await fetchEdgeFunction<ApiEnvelope<PodPayload>>(
        `pods?pod_id=${existingPodId}`,
        { method: "GET", label: "load PoD" }
      );
      return res?.data ?? null;
    },
    enabled: !!existingPodId,
  });

  if (lookingUp || loadingPod) {
    return <p className="text-sm text-muted-foreground">Loading execution data…</p>;
  }

  if (!pod) {
    return (
      <CreatePodForm
        wadId={wadId}
        onCreated={async () => {
          await queryClient.invalidateQueries({ queryKey: ["pod-by-wad", wadId] });
        }}
      />
    );
  }

  return (
    <ActivePod
      pod={pod}
      onChange={() => refetch()}
    />
  );
}

/* ─────────────────────────── Create PoD ─────────────────────────── */

function CreatePodForm({
  wadId,
  onCreated,
}: {
  wadId: string;
  onCreated: () => Promise<void>;
}) {
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [milestones, setMilestones] = useState<
    { name: string; due_at: string; depends_on_index: number | null }[]
  >([{ name: "", due_at: "", depends_on_index: null }]);

  const addRow = () =>
    setMilestones((m) => [...m, { name: "", due_at: "", depends_on_index: null }]);
  const removeRow = (idx: number) =>
    setMilestones((m) => m.filter((_, i) => i !== idx));
  const updateRow = (idx: number, patch: Partial<(typeof milestones)[number]>) =>
    setMilestones((m) => m.map((row, i) => (i === idx ? { ...row, ...patch } : row)));

  const handleSubmit = async () => {
    const cleaned = milestones
      .map((m) => ({
        name: m.name.trim(),
        due_at: m.due_at ? new Date(m.due_at).toISOString() : "",
        depends_on_index:
          m.depends_on_index !== null && m.depends_on_index >= 0
            ? m.depends_on_index
            : undefined,
      }))
      .filter((m) => m.name.length > 0 && m.due_at.length > 0);

    if (cleaned.length === 0) {
      toast({
        title: "Add at least one milestone",
        description: "Each milestone needs a name and a due date.",
        variant: "destructive",
      });
      return;
    }

    setSubmitting(true);
    try {
      await fetchEdgeFunction("pods", {
        method: "POST",
        label: "create PoD",
        headers: { "Idempotency-Key": newKey() },
        body: { wad_id: wadId, milestones: cleaned },
      });
      toast({
        title: "Execution started",
        description: `${cleaned.length} milestone${cleaned.length === 1 ? "" : "s"} created.`,
      });
      await onCreated();
    } catch (err: any) {
      toast({
        title: "Could not create PoD",
        description: err?.message ?? "Unexpected error.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Define the delivery milestones that govern this trade. Each milestone
        becomes an evidence checkpoint; the PoD finalises only when all are
        completed and no breach is open.
      </p>

      <div className="space-y-3">
        {milestones.map((row, idx) => (
          <div
            key={idx}
            className="grid grid-cols-1 md:grid-cols-[1fr_180px_140px_auto] gap-2 items-end p-3 border border-border rounded-md bg-muted/20"
          >
            <div>
              <Label className="text-xs">Milestone {idx + 1}</Label>
              <Input
                value={row.name}
                onChange={(e) => updateRow(idx, { name: e.target.value })}
                placeholder="e.g. Vessel loaded at port of origin"
                maxLength={256}
              />
            </div>
            <div>
              <Label className="text-xs">Due</Label>
              <Input
                type="datetime-local"
                value={row.due_at}
                onChange={(e) => updateRow(idx, { due_at: e.target.value })}
              />
            </div>
            <div>
              <Label className="text-xs">Depends on</Label>
              <select
                className="w-full h-9 px-2 text-sm border border-input rounded-md bg-background"
                value={row.depends_on_index ?? ""}
                onChange={(e) =>
                  updateRow(idx, {
                    depends_on_index:
                      e.target.value === "" ? null : Number(e.target.value),
                  })
                }
              >
                <option value="">- none -</option>
                {milestones.slice(0, idx).map((_, i) => (
                  <option key={i} value={i}>
                    #{i + 1}
                  </option>
                ))}
              </select>
            </div>
            <Button
              variant="ghost"
              size="icon"
              type="button"
              onClick={() => removeRow(idx)}
              disabled={milestones.length === 1}
              aria-label="Remove milestone"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={addRow}>
          <Plus className="h-4 w-4 mr-1" /> Add milestone
        </Button>
        <LoadingButton
          onClick={handleSubmit}
          loading={submitting}
          loadingText="Creating PoD…"
        >
          Start execution
        </LoadingButton>
      </div>
    </div>
  );
}

/* ─────────────────────────── Active PoD ─────────────────────────── */

function ActivePod({
  pod,
  onChange,
}: {
  pod: PodPayload;
  onChange: () => void;
}) {
  const { toast } = useToast();
  const [breachOpen, setBreachOpen] = useState<{ milestoneId: string | null } | null>(
    null
  );
  const [finalising, setFinalising] = useState(false);

  const ordered = useMemo(
    () => [...pod.milestones].sort((a, b) => a.sequence_order - b.sequence_order),
    [pod.milestones]
  );

  const allDone = ordered.every((m) => m.status === "completed");
  const openBreaches = pod.breaches.filter((b) => b.status === "open");
  const isFinalised = pod.state === "FINALISED";

  const handleComplete = async (milestoneId: string) => {
    try {
      await fetchEdgeFunction("pods?action=complete-milestone", {
        method: "POST",
        label: "complete milestone",
        headers: { "Idempotency-Key": newKey() },
        body: { milestone_id: milestoneId },
      });
      toast({ title: "Milestone completed" });
      onChange();
    } catch (err: any) {
      toast({
        title: "Could not complete milestone",
        description: err?.message ?? "Unexpected error.",
        variant: "destructive",
      });
    }
  };

  const handleFinalise = async () => {
    setFinalising(true);
    try {
      await fetchEdgeFunction("pods?action=finalise", {
        method: "POST",
        label: "finalise PoD",
        headers: { "Idempotency-Key": newKey() },
        body: { pod_id: pod.id },
      });
      toast({
        title: "PoD finalised",
        description: "Execution is complete and recorded in the audit ledger.",
      });
      onChange();
    } catch (err: any) {
      toast({
        title: "Could not finalise PoD",
        description: err?.message ?? "Unexpected error.",
        variant: "destructive",
      });
    } finally {
      setFinalising(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Status strip */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant={isFinalised ? "default" : pod.state === "BREACHED" ? "destructive" : "secondary"}>
          {pod.state}
        </Badge>
        <span className="text-muted-foreground">
          {ordered.filter((m) => m.status === "completed").length} of{" "}
          {ordered.length} milestones complete
        </span>
        {openBreaches.length > 0 && (
          <span className="text-destructive flex items-center gap-1">
            <AlertTriangle className="h-3.5 w-3.5" />
            {openBreaches.length} open breach{openBreaches.length === 1 ? "" : "es"}
          </span>
        )}
      </div>

      <Separator />

      {/* Milestones */}
      <ul className="space-y-2">
        {ordered.map((m) => {
          const dep = m.depends_on
            ? ordered.find((x) => x.id === m.depends_on)
            : null;
          const blocked = !!dep && dep.status !== "completed";
          const overdue =
            m.status === "pending" && new Date(m.due_at).getTime() < Date.now();
          return (
            <li
              key={m.id}
              className="flex flex-wrap items-center gap-3 p-3 border border-border rounded-md"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm truncate">{m.name}</span>
                  {m.status === "completed" && (
                    <Badge variant="outline" className="text-xs">
                      <CheckCircle2 className="h-3 w-3 mr-1" /> Completed
                    </Badge>
                  )}
                  {m.status === "deficient" && (
                    <Badge variant="destructive" className="text-xs">
                      Deficient
                    </Badge>
                  )}
                  {overdue && m.status === "pending" && (
                    <Badge variant="destructive" className="text-xs">
                      <Clock className="h-3 w-3 mr-1" /> Overdue
                    </Badge>
                  )}
                  {dep && (
                    <span className="text-xs text-muted-foreground">
                      depends on “{dep.name}”
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  Due {format(new Date(m.due_at), "d MMM yyyy, HH:mm")}{" "}
                  ({formatDistanceToNowStrict(new Date(m.due_at), { addSuffix: true })})
                  {m.completed_at && (
                    <> · completed {format(new Date(m.completed_at), "d MMM yyyy, HH:mm")}</>
                  )}
                </div>
              </div>
              <div className="flex gap-1">
                {!isFinalised && m.status === "pending" && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={blocked}
                      title={blocked ? "Prerequisite milestone not completed" : ""}
                      onClick={() => handleComplete(m.id)}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                      Complete
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setBreachOpen({ milestoneId: m.id })}
                    >
                      <Flag className="h-3.5 w-3.5 mr-1" />
                      Breach
                    </Button>
                  </>
                )}
                {isFinalised && m.status === "completed" && (
                  <Lock className="h-4 w-4 text-muted-foreground" aria-label="Locked" />
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {/* Breaches log */}
      {pod.breaches.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Breach log
          </h4>
          <ul className="space-y-1.5">
            {pod.breaches.map((b) => (
              <li
                key={b.id}
                className="flex items-start gap-2 text-xs p-2 border border-destructive/30 bg-destructive/5 rounded"
              >
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 text-destructive shrink-0" />
                <div className="flex-1">
                  <div className="font-medium text-foreground">{b.reason}</div>
                  <div className="text-muted-foreground">
                    {format(new Date(b.detected_at), "d MMM yyyy, HH:mm")} ·{" "}
                    {b.status}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Actions */}
      {!isFinalised && (
        <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setBreachOpen({ milestoneId: null })}
          >
            <Flag className="h-4 w-4 mr-1" /> Record PoD-level breach
          </Button>
          <LoadingButton
            onClick={handleFinalise}
            loading={finalising}
            loadingText="Finalising…"
            disabled={!allDone || openBreaches.length > 0}
          >
            Finalise execution
          </LoadingButton>
          {!allDone && (
            <p className="w-full text-xs text-muted-foreground">
              Finalisation unlocks once every milestone is completed and all
              breaches are resolved.
            </p>
          )}
        </div>
      )}

      <BreachDialog
        open={breachOpen !== null}
        onOpenChange={(o) => !o && setBreachOpen(null)}
        podId={pod.id}
        milestoneId={breachOpen?.milestoneId ?? null}
        onRecorded={() => {
          setBreachOpen(null);
          onChange();
        }}
      />
    </div>
  );
}

/* ─────────────────────────── Breach Dialog ─────────────────────────── */

function BreachDialog({
  open,
  onOpenChange,
  podId,
  milestoneId,
  onRecorded,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  podId: string;
  milestoneId: string | null;
  onRecorded: () => void;
}) {
  const { toast } = useToast();
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (reason.trim().length < 3) {
      toast({
        title: "Reason required",
        description: "Provide a short explanation of the breach.",
        variant: "destructive",
      });
      return;
    }
    setSubmitting(true);
    try {
      await fetchEdgeFunction("pods?action=breach", {
        method: "POST",
        label: "record breach",
        headers: { "Idempotency-Key": newKey() },
        body: {
          pod_id: podId,
          milestone_id: milestoneId ?? undefined,
          reason: reason.trim(),
        },
      });
      toast({
        title: "Breach recorded",
        description: "A 7-day grace period has been started.",
      });
      setReason("");
      onRecorded();
    } catch (err: any) {
      toast({
        title: "Could not record breach",
        description: err?.message ?? "Unexpected error.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record a breach</DialogTitle>
          <DialogDescription>
            This is recorded immutably in the audit ledger and notifies the
            counterparty. A 7-day grace period begins on submission.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="breach-reason">Reason</Label>
          <Textarea
            id="breach-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Describe what was missed, late, or non-compliant…"
            rows={4}
            maxLength={1024}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <LoadingButton
            onClick={submit}
            loading={submitting}
            loadingText="Recording…"
            variant="destructive"
          >
            Record breach
          </LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
