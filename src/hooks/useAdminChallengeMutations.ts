/**
 * useAdminChallengeMutations — Phase 3C
 *
 * Thin wrappers over the existing `match-challenges/transition` and
 * `match-challenges/break-glass` endpoints. No new server endpoints.
 *
 * Zero Swallowed Errors: callers wrap with try/catch/finally and toast.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchEdgeFunction } from "@/lib/edge-invoke";
import type { ChallengeOutcomeCode } from "@/lib/challenge-outcomes";

export interface TransitionInput {
  challenge_id: string;
  match_id: string;
  to_status: "under_review" | "outcome_recorded" | "closed_no_action" | "withdrawn";
  outcome_code?: ChallengeOutcomeCode | null;
  outcome_summary?: string | null;
}

export interface BreakGlassInput {
  match_id: string;
  reason: string;
}

function invalidate(qc: ReturnType<typeof useQueryClient>, matchId: string) {
  qc.invalidateQueries({ queryKey: ["admin-challenges"] });
  qc.invalidateQueries({ queryKey: ["match-challenges", matchId] });
}

export function useTransitionChallenge() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: TransitionInput) => {
      const { match_id: _omit, ...payload } = input;
      void _omit;
      return await fetchEdgeFunction("match-challenges/transition", {
        method: "POST",
        body: payload,
        label: "transition challenge",
      });
    },
    onSuccess: (_data, vars) => invalidate(qc, vars.match_id),
  });
}

export function useBreakGlassChallenge() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: BreakGlassInput) =>
      await fetchEdgeFunction("match-challenges/break-glass", {
        method: "POST",
        body: input,
        label: "admin override challenge",
      }),
    onSuccess: (_data, vars) => invalidate(qc, vars.match_id),
  });
}
