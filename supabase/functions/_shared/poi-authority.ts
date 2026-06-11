/**
 * POI Authority Gate — Client decision reconciliation pass.
 *
 * The legitimacy gate (`_shared/legitimacy.ts`) verifies the *organisation*.
 * This helper enforces the *user* side of the client's binding rule:
 *
 *   "Only verified organisations, acting through authorised users, may issue,
 *    send, notify, expose, export formal POIs, create formal engagements, or
 *    progress a POI into WaD."
 *
 * It is intentionally additive and does not duplicate any existing role check.
 * It is the single backend allowlist for POI-issuance authority.
 *
 * Allowlist (must hold AT LEAST one):
 *   - platform_admin   (HQ override)
 *   - org_admin        (canonical admin for the org)
 *   - director         (signing director)
 *   - broker / seller / buyer / org_member  (trading roles)
 *
 * Read-only review roles are NOT sufficient on their own:
 *   - auditor, legal_reviewer, compliance_analyst, api_admin, billing_admin
 *
 * If the user has ONLY read-only roles, the gate returns `USER_NOT_AUTHORISED`.
 *
 * Stable error code: USER_NOT_AUTHORISED.
 */

// deno-lint-ignore no-explicit-any
type AdminClient = any;

export const USER_NOT_AUTHORISED_CODE = "USER_NOT_AUTHORISED";

const ISSUER_ROLES = new Set([
  "platform_admin",
  "org_admin",
  "director",
  "broker",
  "seller",
  "buyer",
  "org_member",
]);

export type AuthorityDecision =
  | { allowed: true; roles: string[] }
  | {
      allowed: false;
      reason: "user_not_in_org" | "no_issuer_role" | "lookup_failed";
      roles: string[];
      message: string;
    };

const HEADLINE =
  "You are not authorised to issue or progress a Proof of Intent on behalf of this organisation. Ask your organisation administrator to assign you a trading or director role.";

/**
 * Check whether `userId` is authorised to issue / progress a POI for `orgId`.
 *
 * @param admin   service-role supabase client (RLS-bypass for membership lookup)
 * @param userId  caller user id
 * @param orgId   org the POI action targets
 */
export async function checkUserPoiAuthority(
  admin: AdminClient,
  userId: string | null | undefined,
  orgId: string | null | undefined,
): Promise<AuthorityDecision> {
  if (!userId || !orgId) {
    return {
      allowed: false,
      reason: "user_not_in_org",
      roles: [],
      message: HEADLINE,
    };
  }

  // Membership check — profile must point at the same org. Defence-in-depth
  // alongside the existing IDOR profile/org check at each callsite.
  try {
    const { data: profile, error: profileErr } = await admin
      .from("profiles")
      .select("org_id")
      .eq("id", userId)
      .maybeSingle();
    if (profileErr) {
      return {
        allowed: false,
        reason: "lookup_failed",
        roles: [],
        message: HEADLINE,
      };
    }
    if (!profile || profile.org_id !== orgId) {
      return {
        allowed: false,
        reason: "user_not_in_org",
        roles: [],
        message: HEADLINE,
      };
    }
  } catch {
    return {
      allowed: false,
      reason: "lookup_failed",
      roles: [],
      message: HEADLINE,
    };
  }

  // Role check
  let roles: string[] = [];
  try {
    const { data, error } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    if (error) {
      return {
        allowed: false,
        reason: "lookup_failed",
        roles: [],
        message: HEADLINE,
      };
    }
    roles = (data ?? []).map((r: { role: string }) => r.role);
  } catch {
    return {
      allowed: false,
      reason: "lookup_failed",
      roles: [],
      message: HEADLINE,
    };
  }

  const hasIssuerRole = roles.some((r) => ISSUER_ROLES.has(r));
  if (!hasIssuerRole) {
    return {
      allowed: false,
      reason: "no_issuer_role",
      roles,
      message: HEADLINE,
    };
  }

  return { allowed: true, roles };
}

/**
 * Canonical audit metadata payload for a blocked authority attempt.
 * Use under `metadata` of an `admin_audit_logs` / `audit_logs` row
 * alongside the standard `legitimacy.gate_blocked` shape so the admin
 * audit panel surfaces both authority denials and legitimacy denials
 * through the same query.
 */
export function authorityAuditMetadata(
  decision: Extract<AuthorityDecision, { allowed: false }>,
  extras: Record<string, unknown> = {},
) {
  return {
    reason_code: USER_NOT_AUTHORISED_CODE,
    authority_reason: decision.reason,
    held_roles: decision.roles,
    ...extras,
  };
}
