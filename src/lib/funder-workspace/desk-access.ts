/**
 * Funder-only Trade Desk containment (UI route guard).
 *
 * A user whose only active institutional membership is a funder role
 * (funder_org_admin, funder_reviewer, funder_approver, funder_viewer,
 * external_adviser) must not have access to the ordinary Trade Desk
 * (/desk, /desk/*). They are redirected to /funder/workspace.
 *
 * Rules (pure decision function, tested in isolation):
 *   - Platform admins always allowed (regression: HQ/admin unaffected).
 *   - A user with a genuine trade membership (trade org_id or a
 *     trade-persona role on user_roles) keeps /desk access, even if
 *     they also hold a funder seat (dual-role default).
 *   - An explicitly selected funder persona forces the redirect even
 *     for a dual-role user.
 *   - Otherwise: funder membership without trade membership → redirect.
 *
 * NEVER uses email-address checks. All inputs come from server-backed
 * membership/persona data. RLS remains the source of truth for data
 * access; this only chooses the shell.
 */

export type DeskAccessDecision = "allow" | "redirect_funder";

export interface DeskAccessInputs {
  isPlatformAdmin: boolean;
  /** Active row in p5_batch3_funder_users (any funder role). */
  isFunderUser: boolean;
  /**
   * True when the user has a genuine trade-side membership:
   *   - profiles.org_id points at a trading organisation, OR
   *   - user_roles contains a trade-persona role (org_admin, org_member,
   *     buyer, auditor, compliance_analyst).
   * Funder rows on p5_batch3_funder_users do NOT count as trade membership.
   */
  hasTradeMembership: boolean;
  /**
   * Persisted persona selection on profiles.selected_persona. "funder"
   * forces redirect for dual-role users who explicitly signed in as a
   * funder. "trade" pins /desk access. Other values (developer,
   * governance, null) are ignored by this rule.
   */
  selectedPersona?: string | null;
}

export function resolveDeskAccess(input: DeskAccessInputs): DeskAccessDecision {
  if (input.isPlatformAdmin) return "allow";

  const persona = (input.selectedPersona || "").toLowerCase();
  if (persona === "trade") return "allow";
  if (persona === "funder") return "redirect_funder";

  if (input.isFunderUser && !input.hasTradeMembership) {
    return "redirect_funder";
  }
  return "allow";
}

/**
 * Trade-persona role tokens on user_roles that count as trade membership.
 *
 * NOTE: `org_admin` and `org_member` are auto-provisioned for every
 * authenticated user (including funder-only users), so they cannot be
 * used to infer trade membership — doing so silently disables funder
 * containment. Only strictly trade-specific roles count here.
 */
export const TRADE_PERSONA_ROLES: readonly string[] = [
  "buyer",
  "seller",
  "trader",
  "auditor",
  "director",
  "compliance_analyst",
] as const;
