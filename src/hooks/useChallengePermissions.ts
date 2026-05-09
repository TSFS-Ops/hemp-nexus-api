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
  /**
   * Phase 3D: comment + evidence write affordances.
   *
   * Mirrors server policy:
   *   • challenge.status must be `open` or `under_review`
   *   • viewer must be `platform_admin` OR a party `org_admin`
   * Ordinary org_members and unrelated orgs are read-only.
   */
  canComment: boolean;
  canUploadEvidence: boolean;
  /** Viewer's `author_role` for comment posts; null when not allowed. */
  authorRole: "platform_admin" | "buyer_org_admin" | "seller_org_admin" | null;
}

export type ChallengeStatusForPerms =
  | "open"
  | "under_review"
  | "outcome_recorded"
  | "withdrawn"
  | "closed_no_action"
  | null
  | undefined;

const ACTIVE_STATUSES = new Set(["open", "under_review"]);

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
  /**
   * Phase 3D: status of the challenge currently being viewed (if any).
   * Required for `canComment` / `canUploadEvidence` to be true. Pass the
   * status of the latest visible challenge.
   */
  challengeStatus?: ChallengeStatusForPerms;
}

const DENY: ChallengePermissions = {
  canViewCard: false,
  canRaise: false,
  canSeeBanner: false,
  canComment: false,
  canUploadEvidence: false,
  authorRole: null,
};

export function deriveChallengePermissions(
  input: ChallengePermissionsInput,
): ChallengePermissions {
  const {
    match,
    viewerOrgId,
    isPlatformAdmin,
    isOrgAdmin,
    isAuthenticated,
    challengeStatus,
  } = input;

  if (!isAuthenticated) return DENY;

  const isActive = !!challengeStatus && ACTIVE_STATUSES.has(challengeStatus);

  if (isPlatformAdmin) {
    return {
      canViewCard: true,
      canRaise: true,
      canSeeBanner: true,
      canComment: isActive,
      canUploadEvidence: isActive,
      authorRole: "platform_admin",
    };
  }

  if (!match) return DENY;

  const role = getMatchRole(viewerOrgId ?? null, match);
  const isParty = role === "buyer" || role === "seller";

  if (!isParty && role !== "creator") return DENY;

  const partyOrgAdmin = !!isOrgAdmin && isParty;
  const authorRole: ChallengePermissions["authorRole"] = partyOrgAdmin
    ? role === "buyer"
      ? "buyer_org_admin"
      : "seller_org_admin"
    : null;

  return {
    canViewCard: true,
    canRaise: partyOrgAdmin,
    canSeeBanner: true,
    canComment: partyOrgAdmin && isActive,
    canUploadEvidence: partyOrgAdmin && isActive,
    authorRole,
  };
}

export function useChallengePermissions(
  match: ChallengePermissionsInput["match"],
  challengeStatus?: ChallengeStatusForPerms,
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
        challengeStatus,
      }),
    [
      match,
      viewerOrgId,
      isPlatformAdmin,
      isOrgAdmin,
      session?.user?.id,
      challengeStatus,
    ],
  );
}

