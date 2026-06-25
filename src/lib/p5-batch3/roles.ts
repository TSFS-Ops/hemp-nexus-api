/**
 * P-5 Batch 3 — Stage 2 role categorisation (pure TS).
 *
 * Funder roles are deliberately disjoint from internal/admin roles.
 * No funder role inherits admin, operator, compliance, auditor or
 * developer permissions.
 */
import type { P5B3FunderRole } from "./constants";
import { P5B3_FUNDER_ROLES } from "./constants";

export type P5B3InternalRole =
  | "platform_admin"
  | "operator"
  | "compliance_owner"
  | "auditor"
  | "developer"
  | "non_privileged";

export type P5B3ApiClientRole = "funder_api_client";

export type P5B3AnyRole = P5B3InternalRole | P5B3FunderRole | P5B3ApiClientRole;

export const P5B3_INTERNAL_ROLES: readonly P5B3InternalRole[] = [
  "platform_admin",
  "operator",
  "compliance_owner",
  "auditor",
  "developer",
  "non_privileged",
] as const;

export function isFunderRole(role: P5B3AnyRole): role is P5B3FunderRole {
  return (P5B3_FUNDER_ROLES as readonly string[]).includes(role);
}

export function isInternalRole(role: P5B3AnyRole): role is P5B3InternalRole {
  return (P5B3_INTERNAL_ROLES as readonly string[]).includes(role);
}

export function isApiClientRole(role: P5B3AnyRole): role is P5B3ApiClientRole {
  return role === "funder_api_client";
}

/** Funder roles MUST NOT inherit any internal admin/operator/compliance powers. */
export function inheritsInternalPermissions(role: P5B3AnyRole): boolean {
  return isInternalRole(role) && role !== "non_privileged";
}

export function categoriseRole(
  role: P5B3AnyRole,
): "internal" | "funder" | "api_client" | "unknown" {
  if (isInternalRole(role)) return "internal";
  if (isFunderRole(role)) return "funder";
  if (isApiClientRole(role)) return "api_client";
  return "unknown";
}
