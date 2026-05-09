/**
 * Batch C Phase 2 — Match-scoped challenge progression guard.
 *
 * Rule: while a match has any challenge in status `open` or `under_review`,
 * match-scoped progression actions MUST be blocked:
 *   • POI mint and POI state transitions (poi-transition)
 *   • WaD create / seal (wad, p3-wad)
 *   • Attestation (attestation)
 *   • Collapse / completion (collapse)
 *   • Counterparty reveal / engagement-scoped token burns (match)
 *
 * Out of scope (intentionally NOT blocked):
 *   • Standalone credit purchases (org-scoped, not match-scoped)
 *   • Unrelated matches
 *   • Adding comments / evidence to the challenge itself
 *   • The explicit `platform_admin_break_glass_progress` admin override
 *
 * Stable error code (HTTP 409): CHALLENGE_OPEN
 */

export interface ChallengeGuardDecision {
  allowed: boolean;
  code?: "CHALLENGE_OPEN";
  message?: string;
  challengeId?: string | null;
  challengeStatus?: "open" | "under_review" | null;
}

/**
 * Returns the gating decision for a given match.
 *
 * Implementation note: uses a plain RLS-bypassing service-role select
 * (the caller passes an admin client). We intentionally do NOT call the
 * `has_open_match_challenge` RPC here — we want the open challenge id
 * back so callers can include it in the 409 payload for client UI.
 */
export async function assertNoOpenChallenge(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  matchId: string,
): Promise<ChallengeGuardDecision> {
  if (!matchId) {
    return { allowed: true };
  }

  const { data, error } = await supabase
    .from("match_challenges")
    .select("id, status")
    .eq("match_id", matchId)
    .in("status", ["open", "under_review"])
    .limit(1)
    .maybeSingle();

  if (error) {
    // Fail closed: if we cannot determine challenge state, refuse to
    // progress on stale data.
    return {
      allowed: false,
      code: "CHALLENGE_OPEN",
      message:
        "Unable to determine challenge state for this match. Progression refused.",
      challengeId: null,
      challengeStatus: null,
    };
  }

  if (!data) {
    return { allowed: true };
  }

  return {
    allowed: false,
    code: "CHALLENGE_OPEN",
    message:
      "An open challenge exists on this match. Match-scoped progression is paused until the challenge is resolved.",
    challengeId: data.id,
    challengeStatus: data.status,
  };
}
