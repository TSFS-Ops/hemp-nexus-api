/**
 * useP5Permissions — Stage 4
 *
 * Pure derivation of admin P-5 governance UI affordances. The server-side
 * Stage 3 RPCs remain the authoritative security boundary; this hook only
 * decides which buttons/panels are visible.
 *
 * Role mapping (Batch 1 answer alignment):
 *   - platform_admin / super_admin      → full admin (waiver/override/RTP)
 *   - executive_approver                → full admin
 *   - compliance_analyst                → reviewer (acts as compliance reviewer)
 *   - governance_reviewer               → reviewer
 *   - operator_case_manager             → reviewer (lighter scope)
 *   - auditor / auditor_read_only       → read-only (timeline + diagnostics)
 *   - developer_technical_admin         → technical/provider diagnostics only,
 *                                         NO business decisions
 *   - customer_entity_owner /
 *     funder_external_reviewer          → not allowed in admin surface
 */
import { useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";

export interface P5Permissions {
  canViewAdmin: boolean;
  canViewFullDetails: boolean;
  canViewAuditTimeline: boolean;
  canViewProviderDiagnostics: boolean;
  canStartReview: boolean;
  canReviewEvidence: boolean;
  canApproveInternally: boolean;
  canApproveReadyToProceed: boolean;
  canRequestMoreInfo: boolean;
  canApplyHold: boolean;
  canReleaseHold: boolean;
  canApplyComplianceHold: boolean;
  canReject: boolean;
  canEscalate: boolean;
  canWaive: boolean;
  canOverride: boolean;
  canReopen: boolean;
  canArchive: boolean;
  canAssignOwner: boolean;
  canMutate: boolean;
  // Stage 5 — non-admin surfaces.
  /** Customer/entity owner can see their own scoped readiness summary. */
  canViewCustomerReadiness: boolean;
  /** Customer/entity owner can upload/replace evidence on permitted items. */
  canSubmitCustomerEvidence: boolean;
  /** Funder/external reviewer can see the approved evidence-pack summary. */
  canViewFunderEvidencePack: boolean;
  /** Funder may make any state change. Always false — funder is read-only. */
  canFunderMutate: boolean;
}

export const P5_ADMIN_LIKE = ["platform_admin", "super_admin", "executive_approver"] as const;
export const P5_REVIEWER_LIKE = [
  "platform_admin",
  "super_admin",
  "executive_approver",
  "compliance_analyst",
  "compliance_admin",
  "compliance_reviewer",
  "governance_reviewer",
  "operator_case_manager",
] as const;
export const P5_VIEW_LIKE = [
  ...P5_REVIEWER_LIKE,
  "auditor",
  "auditor_read_only",
  "developer_technical_admin",
] as const;

function has(roles: readonly string[], allowed: readonly string[]): boolean {
  return roles.some((r) => allowed.includes(r));
}

export function deriveP5Permissions(roles: readonly string[]): P5Permissions {
  const isAdmin = has(roles, P5_ADMIN_LIKE);
  const isReviewer = has(roles, P5_REVIEWER_LIKE);
  const isAuditor = has(roles, ["auditor", "auditor_read_only"]);
  const isDeveloper = roles.includes("developer_technical_admin");
  const isComplianceish =
    has(roles, ["compliance_analyst", "compliance_admin", "compliance_reviewer"]);
  const canViewAdmin = isReviewer || isAuditor || isDeveloper;

  // Developer/technical admin: diagnostics-only, never business decisions.
  // Auditor: read-only.
  return {
    canViewAdmin,
    canViewFullDetails: canViewAdmin,
    canViewAuditTimeline: canViewAdmin,
    canViewProviderDiagnostics: canViewAdmin,
    canStartReview: isReviewer,
    canReviewEvidence: isReviewer,
    canApproveInternally: isReviewer,
    canApproveReadyToProceed: isAdmin,
    canRequestMoreInfo: isReviewer,
    canApplyHold: isReviewer,
    // Compliance reviewer specifically authorised to apply compliance hold
    canApplyComplianceHold: isReviewer || isComplianceish,
    // Release-from-blocked / escalated needs admin per Stage 2 rules
    canReleaseHold: isAdmin,
    canReject: isReviewer,
    canEscalate: isReviewer,
    canWaive: isAdmin,
    canOverride: isAdmin,
    canReopen: isAdmin,
    canArchive: isAdmin,
    canAssignOwner: isReviewer,
    canMutate: isReviewer || isAdmin,
  };
}

export function useP5Permissions(): P5Permissions {
  const auth = useAuth();
  const roles = (auth.roles ?? []) as unknown as string[];
  return useMemo(() => deriveP5Permissions(roles), [roles]);
}
