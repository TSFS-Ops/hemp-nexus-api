/**
 * Batch C Phase 3A — Match-scoped challenge progression guard.
 *
 * Rule: while a match has any challenge in status `open` or `under_review`,
 * match-scoped progression actions MUST be blocked:
 *   • POI mint and POI state transitions (poi-transition)
 *   • WaD create / seal (wad, p3-wad)
 *   • Attestation (attestation)
 *   • Collapse / completion / counterparty reveal (collapse, match)
 *   • Match-scoped engagement renewal/decline (poi-engagements)
 *
 * Out of scope (intentionally NOT blocked):
 *   • Standalone credit purchases (org-scoped, not match-scoped)
 *   • Unrelated matches
 *   • Adding comments / evidence to the challenge itself
 *   • The explicit `platform_admin_break_glass_progress` admin override
 *     (which closes the challenge as `admin_override_recorded` — terminal —
 *     before progression resumes)
 *
 * Stable error code (HTTP 409): CHALLENGE_OPEN
 *
 * Canonical 409 response shape (locked Phase 3A):
 *   {
 *     error: "CHALLENGE_OPEN",
 *     code:  "CHALLENGE_OPEN",
 *     message: <human-readable>,
 *     challenge_id: <uuid|null>,
 *     challenge_status: "open" | "under_review" | null,
 *     raised_at: <ISO timestamp|null>
 *   }
 */

export interface ChallengeGuardDecision {
  allowed: boolean;
  code?: "CHALLENGE_OPEN";
  message?: string;
  challengeId?: string | null;
  challengeStatus?: "open" | "under_review" | null;
  raisedAt?: string | null;
}

/**
 * Returns the gating decision for a given match.
 *
 * Implementation note: uses an admin (service-role) client so RLS does not
 * mask challenges raised by the counterparty. Selects `created_at` as the
 * raised-at timestamp.
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
    .select("id, status, created_at")
    .eq("match_id", matchId)
    .in("status", ["open", "under_review"])
    .order("created_at", { ascending: true })
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
      raisedAt: null,
    };
  }

  if (!data) {
    return { allowed: true };
  }

  return {
    allowed: false,
    code: "CHALLENGE_OPEN",
    message:
      "Progression is paused because an open challenge exists on this match.",
    challengeId: data.id,
    challengeStatus: data.status,
    raisedAt: data.created_at ?? null,
  };
}

/**
 * Build the canonical CHALLENGE_OPEN HTTP 409 Response. All edge functions
 * that wire `assertNoOpenChallenge` MUST emit failures via this helper so
 * the response shape is identical across surfaces.
 */
export function challengeOpenResponse(
  decision: ChallengeGuardDecision,
  headers: Record<string, string>,
): Response {
  const body = {
    error: "CHALLENGE_OPEN",
    code: "CHALLENGE_OPEN",
    message: decision.message ??
      "Progression is paused because an open challenge exists on this match.",
    challenge_id: decision.challengeId ?? null,
    challenge_status: decision.challengeStatus ?? null,
    raised_at: decision.raisedAt ?? null,
  };
  return new Response(JSON.stringify(body), {
    status: 409,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}
