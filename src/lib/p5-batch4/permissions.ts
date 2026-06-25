/**
 * P-5 Batch 4 — Server-style permission helpers (pure).
 *
 * Convenience wrappers that combine the role matrix with case-state
 * facts. RPC wrappers (Stage 3) call these BEFORE attempting any write.
 */
import type { P5B4ExecutionStatus, P5B4RoleKey } from "./constants";
import { isActionAllowed, type P5B4Action } from "./roles";

export interface P5B4PermissionCheck {
  allowed: boolean;
  error?: string;
}

export function checkAction(role: P5B4RoleKey, action: P5B4Action): P5B4PermissionCheck {
  if (!isActionAllowed(role, action)) {
    return { allowed: false, error: `role_${role}_cannot_${action}` };
  }
  return { allowed: true };
}

/** Closed/archived cases are read-only unless the actor is a platform admin reopening them. */
export function checkCaseMutable(
  status: P5B4ExecutionStatus,
  role: P5B4RoleKey,
  action: P5B4Action,
): P5B4PermissionCheck {
  if (status === "closed" || status === "archived" || status === "finality_recorded") {
    if (action !== "reopen_case") {
      return { allowed: false, error: "case_read_only" };
    }
    if (role !== "platform_admin") {
      return { allowed: false, error: "reopen_requires_platform_admin" };
    }
  }
  return checkAction(role, action);
}

/** Final approval and finality are platform-admin-only, regardless of action matrix. */
export function checkFinalityAction(role: P5B4RoleKey): P5B4PermissionCheck {
  if (role !== "platform_admin") {
    return { allowed: false, error: "finality_requires_platform_admin" };
  }
  return { allowed: true };
}
