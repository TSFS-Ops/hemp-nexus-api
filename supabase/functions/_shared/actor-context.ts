/**
 * Actor Context Utilities
 *
 * Centralised helpers for deriving actor IDs from authentication context.
 * Ensures consistent handling of user IDs vs API key IDs across all endpoints.
 *
 * OWNERSHIP — `actor_role` column on `audit_logs`:
 *   The `actor_role` value written by edge functions (typically
 *   `actor_role: authCtx.roles?.[0] || null`) is the **acting user's first
 *   RBAC role** (e.g. `platform_admin`, `org_admin`, `compliance_officer`).
 *   It is NEVER a buyer/seller trade side and NEVER a viewer/initiator/
 *   counterparty match-role. Audit consumers MUST NOT cross-reference
 *   `audit_logs.actor_role` with `matches.buyer_org_id` /
 *   `matches.seller_org_id` derived roles.
 *   See `src/tests/audit-actor-role-shape.test.ts` for the canonical assertion.
 */

import { AuthContext } from "./auth.ts";

export interface ActorIds {
  actorUserId: string | null;
  actorApiKeyId: string | null;
}

/**
 * Derive actor IDs from authentication context.
 * 
 * For JWT auth: actorUserId = user's UUID, actorApiKeyId = null
 * For API key auth: actorUserId = null, actorApiKeyId = API key's UUID
 * 
 * This ensures proper UUID format for database inserts and avoids
 * empty string UUID validation errors.
 */
export function deriveActorIds(authCtx: AuthContext): ActorIds {
  if (authCtx.isApiKey) {
    // API key authentication: userId contains the API key's UUID
    const apiKeyId = authCtx.userId && authCtx.userId.length > 0 
      ? authCtx.userId 
      : null;
    return {
      actorUserId: null,
      actorApiKeyId: apiKeyId,
    };
  } else {
    // JWT authentication: userId contains the user's UUID
    const userId = authCtx.userId && authCtx.userId.length > 0 
      ? authCtx.userId 
      : null;
    return {
      actorUserId: userId,
      actorApiKeyId: null,
    };
  }
}

/**
 * Get the appropriate created_by value for database inserts.
 * Returns null for API key auth (since created_by expects a user UUID).
 */
export function getCreatedBy(authCtx: AuthContext): string | null {
  if (authCtx.isApiKey) {
    return null;
  }
  return authCtx.userId && authCtx.userId.length > 0 ? authCtx.userId : null;
}

/**
 * Validate that a string is a valid UUID format before database insert.
 * Returns null if invalid or empty.
 */
export function validateUuid(value: string | null | undefined): string | null {
  if (!value || value.length === 0) {
    return null;
  }
  // Basic UUID format check
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(value) ? value : null;
}
