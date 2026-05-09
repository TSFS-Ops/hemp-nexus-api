/**
 * useAdminChallengeQueue — Phase 3C
 *
 * Platform-admin queue read. Relies on the `challenges_select_admins` RLS
 * policy (platform_admin sees all rows via `is_admin()`). No new server
 * endpoint or RPC. No new schema.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { ChallengeRow, ChallengeStatus } from "@/hooks/useMatchChallenge";

export type AdminChallengeFilter = "all" | "open" | "under_review" | "terminal";

const TERMINAL: ChallengeStatus[] = ["outcome_recorded", "withdrawn", "closed_no_action"];

export function useAdminChallengeQueue(filter: AdminChallengeFilter, limit = 50) {
  return useQuery({
    queryKey: ["admin-challenges", filter, limit],
    queryFn: async (): Promise<ChallengeRow[]> => {
      let q = supabase
        .from("match_challenges")
        .select(
          "id, match_id, org_id, raised_by_org_id, raised_by_user_id, raised_by_role, subject_code, summary, status, outcome_code, outcome_summary, closed_at, closed_by_user_id, break_glass_override_used, created_at, updated_at",
        )
        .order("created_at", { ascending: false })
        .limit(limit);

      if (filter === "open") q = q.eq("status", "open");
      else if (filter === "under_review") q = q.eq("status", "under_review");
      else if (filter === "terminal") q = q.in("status", TERMINAL);

      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as ChallengeRow[];
    },
    staleTime: 15_000,
  });
}
