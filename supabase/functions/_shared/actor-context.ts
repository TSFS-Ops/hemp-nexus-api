/**
 * Actor Context Utilities
 * 
 * Centralised helpers for deriving actor IDs from authentication context.
 * Ensures consistent handling of user IDs vs API key IDs across all endpoints.
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
