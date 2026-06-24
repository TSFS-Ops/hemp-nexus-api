/**
 * useP5Batch2Permissions — Stage 4
 *
 * Pure derivation of P-5 Batch 2 admin/operator UI affordances. Authoritative
 * security is enforced by the Stage 3 SECURITY DEFINER RPCs; this hook only
 * decides which surfaces and actions are visible.
 *
 * Role categories:
 *   - platform_admin   → platform_admin, super_admin, executive_approver
 *   - compliance_owner → compliance_analyst, compliance_admin, compliance_reviewer,
 *                        governance_reviewer
 *   - operator         → operator_case_manager
 *   - auditor          → read-only (auditor, auditor_read_only)
 *   - developer        → developer_technical_admin (diagnostics only, no business)
 *   - non_privileged   → everything else (customer/counterparty/funder/api_user
 *                        roles, or unauthenticated)
 *
 * Funder, API-customer, customer/counterparty and director/UBO roles are
 * never granted any Stage 4 admin/operator surface.
 */
import { useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";

export type P5B2RoleCategory =
  | "platform_admin"
  | "compliance_owner"
  | "operator"
  | "auditor"
  | "developer"
  | "non_privileged";

export interface P5B2Permissions {
  category: P5B2RoleCategory;
  // Surface visibility
  canViewAdminArea: boolean;
  canViewDashboard: boolean;
  canViewRecordDetail: boolean;
  canViewEvidencePack: boolean;
  canViewFinalitySnapshot: boolean;
  canViewSensitiveAccessLog: boolean;
  canViewReviewerInternalNotes: boolean;
  canViewProviderDiagnostics: boolean;
  // Actions (gated UI). Server RPC is the source of truth.
  canCreateRecord: boolean;
  canLinkRecords: boolean;
  canGenerateChecklist: boolean;
  canUploadEvidence: boolean;
  canReviewEvidence: boolean;            // accept / accept-with-warning / reject / request-correction
  canSetProviderState: boolean;
  canWaiveEvidence: boolean;
  canWithdrawEvidence: boolean;
  canSuspendRelease: boolean;
  canSnapshotFinalityPack: boolean;
  canUnmaskSensitive: boolean;           // triggers reason capture + sensitive-access log
}

const PLATFORM_ADMIN_ROLES = ["platform_admin", "super_admin", "executive_approver"] as const;
const COMPLIANCE_OWNER_ROLES = [
  "compliance_analyst",
  "compliance_admin",
  "compliance_reviewer",
  "governance_reviewer",
] as const;
const OPERATOR_ROLES = ["operator_case_manager"] as const;
const AUDITOR_ROLES = ["auditor", "auditor_read_only"] as const;
const DEVELOPER_ROLES = ["developer_technical_admin"] as const;

function any(roles: readonly string[], allowed: readonly string[]): boolean {
  return roles.some((r) => allowed.includes(r));
}

export function deriveP5B2Permissions(roles: readonly string[]): P5B2Permissions {
  const isAdmin = any(roles, PLATFORM_ADMIN_ROLES);
  const isCompliance = any(roles, COMPLIANCE_OWNER_ROLES);
  const isOperator = any(roles, OPERATOR_ROLES);
  const isAuditor = any(roles, AUDITOR_ROLES);
  const isDeveloper = any(roles, DEVELOPER_ROLES);

  let category: P5B2RoleCategory = "non_privileged";
  if (isAdmin) category = "platform_admin";
  else if (isCompliance) category = "compliance_owner";
  else if (isOperator) category = "operator";
  else if (isAuditor) category = "auditor";
  else if (isDeveloper) category = "developer";

  const canViewAdminArea = isAdmin || isCompliance || isOperator || isAuditor || isDeveloper;
  const adminOrCompliance = isAdmin || isCompliance;
  const reviewerLike = adminOrCompliance || isOperator;

  return {
    category,
    canViewAdminArea,
    canViewDashboard: canViewAdminArea,
    canViewRecordDetail: canViewAdminArea,
    canViewEvidencePack: canViewAdminArea,
    canViewFinalitySnapshot: canViewAdminArea,
    canViewSensitiveAccessLog: adminOrCompliance || isAuditor,
    canViewReviewerInternalNotes: adminOrCompliance,
    canViewProviderDiagnostics: canViewAdminArea,

    canCreateRecord: reviewerLike,
    canLinkRecords: reviewerLike,
    canGenerateChecklist: reviewerLike,
    canUploadEvidence: reviewerLike,
    canReviewEvidence: reviewerLike,
    canSetProviderState: adminOrCompliance,
    canWaiveEvidence: isAdmin,
    canWithdrawEvidence: adminOrCompliance,
    canSuspendRelease: adminOrCompliance,
    canSnapshotFinalityPack: isAdmin,
    canUnmaskSensitive: adminOrCompliance,
  };
}

export function useP5Batch2Permissions(): P5B2Permissions {
  const auth = useAuth();
  const roles = (auth.roles ?? []) as unknown as string[];
  return useMemo(() => deriveP5B2Permissions(roles), [roles]);
}
