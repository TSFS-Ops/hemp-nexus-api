/**
 * useChallengeOverrideAudit - Phase 3E governance display.
 *
 * Read-only fetch of the most recent `challenge.break_glass_override`
 * audit row for a given challenge. Exposes the structured governance
 * fields stored in `audit_logs.metadata` so the admin review drawer can
 * render them after closure.
 *
 * Service-role write surface remains the edge function. This hook is
 * read-only (RLS on audit_logs is the authoritative gate).
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface ChallengeOverrideAuditMetadata {
  match_id?: string | null;
  reason_category?: string | null;
  internal_approval_reference?: string | null;
  regulator_reference?: string | null;
  written_reason?: string | null;
  reason_length?: number | null;
  outcome_code?: string | null;
}

export interface ChallengeOverrideAuditRow {
  id: string;
  actor_user_id: string | null;
  created_at: string;
  metadata: ChallengeOverrideAuditMetadata | null;
}

export function useChallengeOverrideAudit(
  challengeId: string | null | undefined,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["challenge-override-audit", challengeId],
    enabled: !!challengeId && enabled,
    queryFn: async (): Promise<ChallengeOverrideAuditRow | null> => {
      if (!challengeId) return null;
      const { data, error } = await supabase
        .from("audit_logs")
        .select("id, actor_user_id, created_at, metadata")
        .eq("action", "challenge.break_glass_override")
        .eq("entity_type", "match_challenge")
        .eq("entity_id", challengeId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as ChallengeOverrideAuditRow | null;
    },
    staleTime: 30_000,
  });
}
