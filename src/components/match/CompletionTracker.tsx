/**
 * CompletionTracker — Unified view of POI → WaD → PoD progress for a match.
 * Shows each stage's status, blocking conditions, next steps, and action triggers.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { CheckCircle2, Circle, Clock, AlertTriangle, ShieldCheck, FileCheck, Truck, Play, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface CompletionTrackerProps {
  matchId: string;
  orgId: string;
}

interface StageInfo {
  label: string;
  icon: React.ReactNode;
  status: "complete" | "in_progress" | "blocked" | "pending" | "not_started";
  detail: string;
  substeps?: { label: string; done: boolean }[];
  actionLabel?: string;
  actionKey?: "start_wad" | "start_pod";
}

function statusIcon(status: StageInfo["status"]) {
  switch (status) {
    case "complete": return <CheckCircle2 className="h-5 w-5 text-green-500" />;
    case "in_progress": return <Clock className="h-5 w-5 text-blue-500 animate-pulse" />;
    case "blocked": return <AlertTriangle className="h-5 w-5 text-destructive" />;
    case "pending": return <Circle className="h-5 w-5 text-muted-foreground" />;
    case "not_started": return <Circle className="h-5 w-5 text-muted-foreground/40" />;
  }
}

function statusBadge(status: StageInfo["status"]) {
  const map: Record<string, string> = {
    complete: "Complete",
    in_progress: "In Progress",
    blocked: "Blocked",
    pending: "Pending",
    not_started: "Not Started",
  };
  const variantMap: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    complete: "default",
    in_progress: "secondary",
    blocked: "destructive",
    pending: "outline",
    not_started: "outline",
  };
  return <Badge variant={variantMap[status]}>{map[status]}</Badge>;
}

export function CompletionTracker({ matchId, orgId }: CompletionTrackerProps) {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["completion-tracker", matchId],
    queryFn: async () => {
      const matchRes = await supabase.from("matches").select("id, status, state, poi_state, buyer_committed_at, seller_committed_at, settled_at").eq("id", matchId).single();
      const wadRes = await supabase.from("p3_wads").select("id, state, denial_reasons").eq("poi_id", matchId).order("created_at", { ascending: false }).limit(1);
      const podRes = await supabase.from("pods").select("id, state, wad_id").order("created_at", { ascending: false }).limit(1);

      const wadData = (wadRes.data as any)?.[0] || null;
      const podData = (podRes.data as any)?.[0] || null;

      let milestones: any[] = [];
      if (podData) {
        const { data: ms } = await supabase.from("pod_milestones").select("id, name, status").eq("pod_id", podData.id).order("sequence_order" as any, { ascending: true });
        milestones = (ms as any[]) || [];
      }

      return {
        match: matchRes.data as any,
        wad: wadData,
        pod: podData,
        milestones,
      };
    },
  });

  const startWadMutation = useMutation({
    mutationFn: async () => {
      const { data: fnRes, error } = await supabase.functions.invoke("wad", {
        body: { action: "create", poi_id: matchId, org_id: orgId },
      });
      if (error) throw error;
      if (fnRes && !fnRes.ok) throw new Error(fnRes.error || "Failed to create WaD");
      return fnRes;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["completion-tracker", matchId] });
      toast.success("WaD process initiated", { description: "The Written Acknowledgement of Debt has been created." });
    },
    onError: (err: Error) => toast.error("Failed to start WaD", { description: err.message }),
  });

  const startPodMutation = useMutation({
    mutationFn: async () => {
      const wadId = data?.wad?.id;
      if (!wadId) throw new Error("WaD must be issued before creating a PoD");
      const { data: fnRes, error } = await supabase.functions.invoke("pods", {
        body: { action: "create", wad_id: wadId, org_id: orgId },
      });
      if (error) throw error;
      if (fnRes && !fnRes.ok) throw new Error(fnRes.error || "Failed to create PoD");
      return fnRes;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["completion-tracker", matchId] });
      toast.success("PoD process initiated", { description: "Proof of Delivery tracking has been created." });
    },
    onError: (err: Error) => toast.error("Failed to start PoD", { description: err.message }),
  });

  const handleAction = (key: string) => {
    if (key === "start_wad") startWadMutation.mutate();
    if (key === "start_pod") startPodMutation.mutate();
  };

  const isActioning = startWadMutation.isPending || startPodMutation.isPending;

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(i => <Skeleton key={i} className="h-24 w-full" />)}
      </div>
    );
  }

  const match = data?.match;
  const wad = data?.wad;
  const pod = data?.pod;
  const milestones = data?.milestones || [];

  if (!match) {
    return <p className="text-sm text-muted-foreground">Match not found</p>;
  }

  // Derive POI stage
  const poiState = match.poi_state || match.state || "discovery";
  const poiDone = ["issued", "settled"].includes(poiState);
  const poiInProgress = !poiDone && poiState !== "discovery";
  const poiStage: StageInfo = {
    label: "Proof of Intent (POI)",
    icon: <ShieldCheck className="h-5 w-5" />,
    status: poiDone ? "complete" : poiInProgress ? "in_progress" : "pending",
    detail: poiDone
      ? "Both parties have confirmed intent"
      : `Current state: ${poiState}`,
    substeps: [
      { label: "Counterparty sighted", done: !!match.buyer_committed_at || !!match.seller_committed_at },
      { label: "Buyer committed", done: !!match.buyer_committed_at },
      { label: "Seller committed", done: !!match.seller_committed_at },
      { label: "Settlement", done: !!match.settled_at },
    ],
  };

  // Derive WaD stage
  let wadStage: StageInfo;
  if (!wad) {
    wadStage = {
      label: "Written Acknowledgement of Debt (WaD)",
      icon: <FileCheck className="h-5 w-5" />,
      status: poiDone ? "pending" : "not_started",
      detail: poiDone ? "Ready to create — POI is complete" : "Waiting for POI completion",
      actionLabel: poiDone ? "Start WaD" : undefined,
      actionKey: poiDone ? "start_wad" : undefined,
    };
  } else {
    const wadDone = wad.state === "ISSUED";
    const wadDenied = wad.state === "DENIED";
    wadStage = {
      label: "Written Acknowledgement of Debt (WaD)",
      icon: <FileCheck className="h-5 w-5" />,
      status: wadDone ? "complete" : wadDenied ? "blocked" : "in_progress",
      detail: wadDone
        ? "WaD issued and sealed"
        : wadDenied
          ? `Denied: ${(wad.denial_reasons as string[])?.join(", ") || "See details"}`
          : `WaD state: ${wad.state}`,
    };
  }

  // Derive PoD stage
  let podStage: StageInfo;
  if (!pod) {
    const wadDone = wad?.state === "ISSUED";
    podStage = {
      label: "Proof of Delivery (PoD)",
      icon: <Truck className="h-5 w-5" />,
      status: wadDone ? "pending" : "not_started",
      detail: wadDone ? "Ready to create — WaD is issued" : "Waiting for WaD issuance",
      actionLabel: wadDone ? "Start PoD" : undefined,
      actionKey: wadDone ? "start_pod" : undefined,
    };
  } else {
    const podDone = pod.state === "FINALISED";
    const podBreached = pod.state === "BREACHED";
    podStage = {
      label: "Proof of Delivery (PoD)",
      icon: <Truck className="h-5 w-5" />,
      status: podDone ? "complete" : podBreached ? "blocked" : "in_progress",
      detail: podDone
        ? "All milestones complete — delivery finalised"
        : podBreached
          ? "Breach detected — remediation required"
          : `${milestones.filter((m: any) => m.status === "completed").length}/${milestones.length} milestones complete`,
      substeps: milestones.map((m: any) => ({
        label: m.name,
        done: m.status === "completed",
      })),
    };
  }

  const stages = [poiStage, wadStage, podStage];
  const completedCount = stages.filter(s => s.status === "complete").length;

  return (
    <div className="space-y-4">
      {/* Overall progress */}
      <Card>
        <CardContent className="pt-4 pb-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">Deal Progress to Finality</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {completedCount} of {stages.length} stages complete
              </p>
            </div>
            <div className="flex items-center gap-1">
              {stages.map((s, i) => (
                <div key={i} className="flex items-center">
                  <div className={`h-3 w-3 rounded-full ${
                    s.status === "complete" ? "bg-green-500" :
                    s.status === "in_progress" ? "bg-blue-500" :
                    s.status === "blocked" ? "bg-destructive" :
                    "bg-muted"
                  }`} />
                  {i < stages.length - 1 && (
                    <div className={`h-0.5 w-6 ${
                      s.status === "complete" ? "bg-green-500" : "bg-muted"
                    }`} />
                  )}
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stage cards */}
      {stages.map((stage, i) => (
        <Card key={i} className={stage.status === "blocked" ? "border-destructive/50" : ""}>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                {statusIcon(stage.status)}
                <CardTitle className="text-base">{stage.label}</CardTitle>
              </div>
              <div className="flex items-center gap-2">
                {stage.actionLabel && stage.actionKey && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        size="sm"
                        variant="default"
                        disabled={isActioning}
                        className="h-7 text-xs"
                      >
                        {isActioning ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                        ) : (
                          <Play className="h-3.5 w-3.5 mr-1" />
                        )}
                        {stage.actionLabel}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          {stage.actionKey === "start_wad" ? "Create Written Acknowledgement of Debt?" : "Create Proof of Delivery?"}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          {stage.actionKey === "start_wad"
                            ? "This will create an irrevocable WaD governance record for this match. This action cannot be undone."
                            : "This will create a PoD with milestone tracking for this deal. This action cannot be undone."}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => handleAction(stage.actionKey!)}>
                          Confirm
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
                {statusBadge(stage.status)}
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="text-sm text-muted-foreground">{stage.detail}</p>
            {stage.substeps && stage.substeps.length > 0 && (
              <div className="mt-3 space-y-1.5">
                {stage.substeps.map((sub, j) => (
                  <div key={j} className="flex items-center gap-2 text-sm">
                    {sub.done ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                    ) : (
                      <Circle className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
                    )}
                    <span className={sub.done ? "text-foreground" : "text-muted-foreground"}>
                      {sub.label}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
