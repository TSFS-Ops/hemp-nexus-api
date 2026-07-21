/**
 * Institutional Funder Evidence Workspace — Batch 3
 * Pure role → label mapping for funder-facing surfaces.
 * Enum values are NOT renamed here; this only maps to display labels.
 */

export const FUNDER_ROLE_LABELS: Record<string, string> = {
  funder_org_admin: "Funder Admin",
  funder_approver: "Approver",
  funder_reviewer: "Reviewer",
  funder_viewer: "Viewer",
  external_adviser: "External Adviser",
};

export function funderRoleLabel(role: string | null | undefined): string {
  if (!role) return "—";
  return FUNDER_ROLE_LABELS[role] ?? role;
}

/** Human summary of what a funder role may do in the workspace. */
export const FUNDER_ROLE_SUMMARY: Record<string, string[]> = {
  funder_org_admin: [
    "View assigned deals and released evidence",
    "See organisation membership",
    "Team self-service is not yet available",
  ],
  funder_approver: [
    "View assigned deals and released evidence",
      "Record the formal funding decision for a release", 
  ],
  funder_reviewer: [
    "View assigned deals and released evidence",
      "Create requests for information (RFIs) and shared comments", 
  ],
  funder_viewer: ["View assigned deals and released evidence (read-only)"],
  external_adviser: ["View assigned deals in read-only mode"],
};

export function funderRoleSummary(role: string | null | undefined): string[] {
  if (!role) return [];
  return FUNDER_ROLE_SUMMARY[role] ?? [];
}
