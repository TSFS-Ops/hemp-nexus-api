/**
 * CompletionTracker - Actionable workflow surface for POI → WaD → PoD → Evidence.
 *
 * Uses the deterministic completion-engine to derive stages, actions, and blocked reasons.
 * Actions navigate to the relevant tab in MatchDetailsTabs.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { AlertTriangle } from "lucide-react";
import { resolveCompletion, type CompletionInput, type TrackerAction, type UserRole } from "@/lib/completion-engine";
import { ProgressSummary } from "./completion-tracker/ProgressSummary";
import { StageCard } from "./completion-tracker/StageCard";

interface CompletionTrackerProps {
  matchId: string;
  orgId: string;
  /** Callback to switch tabs in the parent MatchDetailsTabs */
  onNavigateTab?: (tab: string) => void;
}

export function CompletionTracker({ matchId, orgId, onNavigateTab }: CompletionTrackerProps) {
  const queryClient = useQueryClient();
  const { isPlatformAdmin, isOrgAdmin } = useAuth();

  const userRole: UserRole = isPlatformAdmin
    ? "platform_admin"
    : isOrgAdmin
      ? "org_admin"
      : "org_member";

  const { data: completionInput, isLoading, error } = useQuery({
    queryKey: ["completion-tracker", matchId],
    queryFn: async (): Promise<CompletionInput> => {
      // Parallel data fetch - scoped to this match and org
      const [matchRes, wadRes, podRes, docsRes, disputeRes] = await Promise.all([
        supabase.from("matches")
          .select("id, status, state, poi_state, org_id, buyer_org_id, seller_org_id, buyer_committed_at, seller_committed_at, counterparty_sighted_at, settled_at")
          .eq("id", matchId)
          .single(),
        supabase.from("p3_wads")
          .select("id, state, seal_hash, sealed_at, denial_reasons, poi_id")
          .eq("poi_id", matchId)
          .order("created_at", { ascending: false })
          .limit(1),
        // Pods are linked to WaDs, so we first get WaD then pods
        // For now, query pods scoped via match relationship
        supabase.from("pods")
          .select("id, state, wad_id")
          .order("created_at", { ascending: false })
          .limit(10),
        supabase.from("match_documents")
          .select("id, review_status")
          .eq("match_id", matchId),
        supabase.from("disputes")
          .select("id, status")
          .eq("match_id", matchId),
      ]);

      // Guard: match must exist
      if (matchRes.error || !matchRes.data) {
        throw new Error(matchRes.error?.message || "Match not found");
      }

      const match = matchRes.data;
      const wadData = (wadRes.data as any)?.[0] || null;

      // Scope pod to the WaD for this match
      let podData: any = null;
      if (wadData && podRes.data) {
        podData = (podRes.data as any[]).find((p: any) => p.wad_id === wadData.id) || null;
      }

      // Fetch milestones + breaches if pod exists
      let milestones: any[] = [];
      let breaches: any[] = [];
      if (podData) {
        const [msRes, brRes] = await Promise.all([
          supabase.from("pod_milestones")
            .select("id, name, status, depends_on, sequence_order")
            .eq("pod_id", podData.id)
            .order("sequence_order" as any, { ascending: true }),
          supabase.from("breaches")
            .select("id, status, reason")
            .eq("pod_id", podData.id),
        ]);
        milestones = (msRes.data as any[]) || [];
        breaches = (brRes.data as any[]) || [];
      }

      // Count WaD attestations if wad exists
      let attestationsCount = 0;
      if (wadData) {
        const { count } = await supabase
          .from("attestations")
          .select("id", { count: "exact", head: true })
          .eq("wad_id", wadData.id);
        attestationsCount = count || 0;
      }

      // Docs summary
      const docs = (docsRes.data as any[]) || [];
      const reviewed = docs.filter((d: any) => d.review_status === "approved" || d.review_status === "reviewed").length;
      const pending = docs.filter((d: any) => d.review_status === "pending" || !d.review_status).length;

      // Disputes summary
      const allDisputes = (disputeRes.data as any[]) || [];
      const activeDisputes = allDisputes.filter((d: any) => d.status === "open" || d.status === "investigating").length;

      return {
        match: {
          id: match.id,
          status: match.status,
          state: match.state,
          poi_state: match.poi_state,
          org_id: match.org_id,
          buyer_committed_at: match.buyer_committed_at,
          seller_committed_at: match.seller_committed_at,
          counterparty_sighted_at: match.counterparty_sighted_at,
          settled_at: match.settled_at,
          buyer_org_id: match.buyer_org_id,
          seller_org_id: match.seller_org_id,
        },
        wad: wadData ? {
          id: wadData.id,
          state: wadData.state,
          seal_hash: wadData.seal_hash,
          sealed_at: wadData.sealed_at,
          denial_reasons: wadData.denial_reasons,
          attestations_count: attestationsCount,
        } : null,
        pod: podData ? {
          id: podData.id,
          state: podData.state,
          wad_id: podData.wad_id,
        } : null,
        milestones,
        breaches,
        documents: { total: docs.length, reviewed, pending },
        disputes: { active: activeDisputes, total: allDisputes.length },
        userRole,
        userOrgId: orgId,
      };
    },
  });

  // Milestone completion mutation
  const completeMilestone = useMutation({
    mutationFn: async (milestoneId: string) => {
      const { data, error } = await supabase
        .from("pod_milestones")
        .update({ status: "completed" })
        .eq("id", milestoneId)
        .eq("status", "pending")
        .select();
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("Milestone could not be completed - it may already be done or blocked by a dependency");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["completion-tracker", matchId] });
      toast.success("Milestone completed");
    },
    onError: (err: Error) => toast.error("Failed to complete milestone", { description: err.message }),
  });

  const handleAction = (action: TrackerAction) => {
    if (action.type === "complete_milestone") {
      const milestoneId = action.id.replace("pod-complete-", "");
      completeMilestone.mutate(milestoneId);
      return;
    }

    if (action.targetTab && onNavigateTab) {
      onNavigateTab(action.targetTab);
      return;
    }

    toast.info(`Navigate to the ${action.targetTab || "relevant"} tab to ${action.label.toLowerCase()}`);
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-24 w-full" />)}
      </div>
    );
  }

  if (error || !completionInput) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          {error instanceof Error ? error.message : "Failed to load progress data. Please refresh the page."}
        </AlertDescription>
      </Alert>
    );
  }

  const state = resolveCompletion(completionInput);

  return (
    <div className="space-y-4">
      <ProgressSummary state={state} onAction={handleAction} />
      {state.stages.map(stage => (
        <StageCard
          key={stage.id}
          stage={stage}
          userRole={userRole}
          onAction={handleAction}
        />
      ))}
    </div>
  );
}