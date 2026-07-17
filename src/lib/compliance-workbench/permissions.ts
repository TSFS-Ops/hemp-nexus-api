/**
 * Compliance Workbench — frontend permission helpers.
 *
 * Frontend gating ONLY. Server-side enforcement is Claude's responsibility;
 * the UI must never treat these checks as a security boundary.
 */
export type ComplianceUiRole =
  | "customer_user"
  | "organisation_admin"
  | "compliance_analyst"
  | "compliance_operations_lead"
  | "legal_reviewer"
  | "senior_compliance_approver"
  | "director"
  | "platform_admin"
  | "auditor"
  | "funder_viewer"
  | "funder_reviewer";

export const COMPLIANCE_UI_ROLE_LABELS: Record<ComplianceUiRole, string> = {
  customer_user: "Customer User",
  organisation_admin: "Organisation Administrator",
  compliance_analyst: "Compliance Analyst",
  compliance_operations_lead: "Compliance Operations Lead",
  legal_reviewer: "Legal Reviewer",
  senior_compliance_approver: "Senior Compliance Approver",
  director: "Director",
  platform_admin: "Platform Administrator",
  auditor: "Auditor",
  funder_viewer: "Funder Viewer",
  funder_reviewer: "Funder Reviewer",
};

const INTERNAL_ROLES: ComplianceUiRole[] = [
  "compliance_analyst",
  "compliance_operations_lead",
  "legal_reviewer",
  "senior_compliance_approver",
  "director",
  "platform_admin",
  "auditor",
];

export function canViewInternalWorkbench(roles: string[]): boolean {
  return roles.some((r) => (INTERNAL_ROLES as string[]).includes(r));
}

export function canProposeDecision(roles: string[]): boolean {
  return roles.includes("compliance_analyst") || roles.includes("compliance_operations_lead");
}

export function canApproveSeniorSensitive(roles: string[]): boolean {
  return roles.includes("senior_compliance_approver") || roles.includes("director");
}

export function canApproveDirector(roles: string[]): boolean {
  return roles.includes("director");
}

export function canReleaseHold(roles: string[]): boolean {
  return roles.includes("senior_compliance_approver") || roles.includes("director");
}

export function canApproveFunderSummary(roles: string[]): boolean {
  return roles.includes("senior_compliance_approver");
}

export function canReopenCase(roles: string[]): boolean {
  return (
    roles.includes("compliance_operations_lead") || roles.includes("senior_compliance_approver")
  );
}

export function canCloseCase(roles: string[]): boolean {
  return roles.includes("compliance_operations_lead") || roles.includes("senior_compliance_approver");
}

/**
 * Distinct-person visual guard. Backend enforces the real rule; the UI must
 * make it visibly clear that the currently-displayed user cannot satisfy two
 * required approver roles on the same action.
 */
export function isSameActor(currentUserDisplayName: string | null, otherDisplayName: string | null | undefined): boolean {
  if (!currentUserDisplayName || !otherDisplayName) return false;
  return currentUserDisplayName.trim().toLowerCase() === otherDisplayName.trim().toLowerCase();
}
