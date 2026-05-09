/**
 * useMatchChallenge — Phase 3B
 *
 * Reads `match_challenges` for a single match directly via the Supabase
 * client. RLS already governs who can see which rows:
 *   • participant org members + platform admins → see all challenges on the
 *     match
 *   • unrelated orgs → see nothing (zero rows)
 *
 * No new edge function is introduced; we deliberately reuse the table's
 * existing RLS policy `challenges_select_participants`.
 */
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";

export type ChallengeStatus =
  | "open"
  | "under_review"
  | "outcome_recorded"
  | "withdrawn"
  | "closed_no_action";

export interface ChallengeRow {
  id: string;
  match_id: string;
  org_id: string | null;
  raised_by_org_id: string | null;
  raised_by_user_id: string | null;
  raised_by_role: "buyer_org_admin" | "seller_org_admin" | "platform_admin" | null;
  subject_code: string;
  summary: string;
  status: ChallengeStatus;
  outcome_code: string | null;
  outcome_summary: string | null;
  closed_at: string | null;
  closed_by_user_id: string | null;
  break_glass_override_used: boolean | null;
  created_at: string;
  updated_at: string | null;
}

const ACTIVE = new Set<ChallengeStatus>(["open", "under_review"]);
const TERMINAL = new Set<ChallengeStatus>([
  "outcome_recorded",
  "withdrawn",
  "closed_no_action",
]);

export interface UseMatchChallengeResult {
  /** Latest active challenge (open/under_review) — at most one by DB invariant. */
  open: ChallengeRow | null;
  /** Latest terminal challenge, if any. */
  terminal: ChallengeRow | null;
  /** Latest challenge regardless of status. */
  latest: ChallengeRow | null;
  /** All challenges for the match, newest first. */
  all: ChallengeRow[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useMatchChallenge(matchId: string | null | undefined): UseMatchChallengeResult {
  const query = useQuery({
    queryKey: ["match-challenges", matchId],
    enabled: !!matchId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("match_challenges")
        .select(
          "id, match_id, org_id, raised_by_org_id, raised_by_user_id, raised_by_role, subject_code, summary, status, outcome_code, outcome_summary, closed_at, closed_by_user_id, break_glass_override_used, created_at, updated_at",
        )
        .eq("match_id", matchId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ChallengeRow[];
    },
    staleTime: 15_000,
  });

  return useMemo(() => {
    const all = query.data ?? [];
    const open = all.find((c) => ACTIVE.has(c.status)) ?? null;
    const terminal = all.find((c) => TERMINAL.has(c.status)) ?? null;
    const latest = all[0] ?? null;
    return {
      open,
      terminal,
      latest,
      all,
      isLoading: query.isLoading,
      error: (query.error as Error | null) ?? null,
      refetch: () => query.refetch(),
    };
  }, [query.data, query.isLoading, query.error, query.refetch]);
}

export const CHALLENGE_ACTIVE_STATUSES = ACTIVE;
export const CHALLENGE_TERMINAL_STATUSES = TERMINAL;
