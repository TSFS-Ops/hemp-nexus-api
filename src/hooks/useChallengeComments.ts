/**
 * useChallengeComments - Phase 3D
 *
 * Direct RLS read of `match_challenge_comments` for a single challenge,
 * plus a write mutation that posts to the existing `match-challenges/comment`
 * edge route. No new server endpoint, no new schema.
 *
 * Validation mirrors the DB CHECK constraint: 5–4000 trimmed characters.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchEdgeFunction } from "@/lib/edge-invoke";

export const COMMENT_MIN = 5;
export const COMMENT_MAX = 4000;

export interface ChallengeCommentRow {
  id: string;
  challenge_id: string;
  author_user_id: string;
  author_org_id: string | null;
  author_role: "buyer_org_admin" | "seller_org_admin" | "platform_admin";
  body: string;
  created_at: string;
}

export interface PostCommentInput {
  challenge_id: string;
  author_role: ChallengeCommentRow["author_role"];
  author_org_id?: string | null;
  body: string;
}

export function useChallengeComments(challengeId: string | null | undefined) {
  return useQuery({
    queryKey: ["challenge-comments", challengeId],
    enabled: !!challengeId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("match_challenge_comments")
        .select(
          "id, challenge_id, author_user_id, author_org_id, author_role, body, created_at",
        )
        .eq("challenge_id", challengeId!)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as ChallengeCommentRow[];
    },
    staleTime: 10_000,
  });
}

export function usePostChallengeComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: PostCommentInput) =>
      await fetchEdgeFunction("match-challenges/comment", {
        method: "POST",
        body: input,
        label: "post challenge comment",
      }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["challenge-comments", vars.challenge_id] });
    },
  });
}
