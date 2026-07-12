/**
 * Institutional Funder Evidence Workspace — Batch 2
 * Read-only role label helpers. The canonical role→V1 mapping happens
 * server-side in public.funder_role_for_v1. This module is UI-only.
 */
export const FUNDER_V1_ROLE_LABELS = {
  admin: "Admin",
  approver: "Approver",
  reviewer: "Reviewer",
  viewer: "Viewer",
  external_adviser: "External adviser",
} as const;
export type FunderV1Role = keyof typeof FUNDER_V1_ROLE_LABELS;

export function funderRoleLabel(role: string | null | undefined): string {
  if (!role) return "—";
  return (FUNDER_V1_ROLE_LABELS as Record<string, string>)[role] ?? role;
}
