/**
 * Batch 4 — org-scim-user-lifecycle pure transition table + body schema.
 * Mirrored exactly from src/lib/identity/sso-claim.ts (SCIM_TRANSITIONS).
 */
import { z } from "https://esm.sh/zod@3.23.8";
import { IDENTITY_AUDIT_NAMES } from "../_shared/identity-audit.ts";

export type ScimState = "invited" | "active" | "suspended" | "deprovisioned";

export const TRANSITIONS: Record<ScimState, readonly ScimState[]> = {
  invited: ["active", "suspended", "deprovisioned"],
  active: ["suspended", "deprovisioned"],
  suspended: ["active", "deprovisioned"],
  deprovisioned: ["invited"],
};

export function isValidScimTransition(from: ScimState, to: ScimState): boolean {
  if (from === to) return false;
  return TRANSITIONS[from].includes(to);
}

export const BodySchema = z.object({
  org_id: z.string().uuid(),
  user_id: z.string().uuid(),
  state: z.enum(["invited", "active", "suspended", "deprovisioned"]),
  source: z.enum(["manual", "scim", "sso_jit"]).optional(),
  external_id: z.string().max(255).nullable().optional(),
  reason: z.string().min(1).max(500),
});

export type ScimBody = z.infer<typeof BodySchema>;

export function auditNameForTransition(to: ScimState): string {
  switch (to) {
    case "invited":
    case "active":
      return IDENTITY_AUDIT_NAMES.scim_user_provisioned;
    case "suspended":
      return IDENTITY_AUDIT_NAMES.scim_user_suspended;
    case "deprovisioned":
      return IDENTITY_AUDIT_NAMES.scim_user_deprovisioned;
  }
}
