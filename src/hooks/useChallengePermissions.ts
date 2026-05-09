/**
 * useChallengePermissions — Phase 3B
 *
 * Pure derivation of UI-visibility booleans. **Not** a security boundary —
 * the server (RLS + match-challenges edge function) is authoritative.
 *
 * | Role on match                         | canViewCard     | canRaise | canSeeBanner |
 * | ------------------------------------- | --------------- | -------- | ------------ |
 * | Party `org_admin` (buyer or seller)   | yes             | yes      | yes          |
 * | Party `org_member` (buyer or seller)  | yes (read-only) | no       | yes          |
 * | Platform admin                        | yes             | yes      | yes          |
 * | Unrelated org                         | no              | no       | no           |
 * | Unauthenticated                       | no              | no       | no           |
 */
import { useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useUserOrg, getMatchRole } from "@/hooks/use-user-org";

export interface ChallengePermissions {
  canViewCard: boolean;
  canRaise: boolean;
  canSeeBanner: boolean;
}

export interface ChallengePermissionsInput {
  match: {
    org_id: string;
    buyer_org_id?: string | null;
    seller_org_id?: string | null;
  } | null | undefined;
  /** Override viewer org (for tests). Defaults to logged-in user's org. */
  viewerOrgId?: string | null;
  /** Override platform admin flag (for tests). */
  isPlatformAdmin?: boolean;
  /** Override "is org admin of viewer's org" (for tests). */
  isOrgAdmin?: boolean;
  /** Whether the viewer is authenticated. Defaults to AuthContext session. */
  isAuthenticated?: boolean;
}

export function deriveChallengePermissions(
  input: ChallengePermissionsInput,
): ChallengePermissions {
  const { match, viewerOrgId, isPlatformAdmin, isOrgAdmin, isAuthenticated } = input;

  if (!isAuthenticated) {
    return { canViewCard: false, canRaise: false, canSeeBanner: false };
  }

  if (isPlatformAdmin) {
    return { canViewCard: true, canRaise: true, canSeeBanner: true };
  }

  if (!match) {
    return { canViewCard: false, canRaise: false, canSeeBanner: false };
  }

  const role = getMatchRole(viewerOrgId ?? null, match);
  // "creator" without a buyer/seller slot is a fallback — treat like a party
  // for view but not for raise (raise requires party org_admin).
  const isParty = role === "buyer" || role === "seller";

  if (!isParty && role !== "creator") {
    return { canViewCard: false, canRaise: false, canSeeBanner: false };
  }

  return {
    canViewCard: true,
    canRaise: !!isOrgAdmin && isParty,
    canSeeBanner: true,
  };
}

export function useChallengePermissions(
  match: ChallengePermissionsInput["match"],
): ChallengePermissions {
  const { session, isPlatformAdmin, isOrgAdmin } = useAuth();
  const viewerOrgId = useUserOrg();

  return useMemo(
    () =>
      deriveChallengePermissions({
        match,
        viewerOrgId,
        isPlatformAdmin,
        isOrgAdmin,
        isAuthenticated: !!session?.user?.id,
      }),
    [match, viewerOrgId, isPlatformAdmin, isOrgAdmin, session?.user?.id],
  );
}
