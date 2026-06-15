/**
 * session-expiry-bus - tiny pub/sub for "your session is dead, force re-auth".
 *
 * Why: previously a session-expired error surfaced as a small toast in the
 * corner that users routinely missed (see screenshot from client incident
 * 2026-04-24). Any code path that detects an unrecoverable auth failure
 * should call `notifySessionExpired(reason)` and the global
 * <SessionExpiredModal /> mounted in App.tsx will block the UI with a
 * single "Sign in again" CTA that preserves returnTo.
 *
 * The bus is a CustomEvent on `window` so it works across module boundaries
 * (edge-invoke.ts, AuthContext.tsx, ad-hoc fetch sites) without circular
 * imports.
 */

export type SessionExpiryReason =
  | "UNAUTHORIZED"
  | "NO_SESSION"
  | "REFRESH_FAILED"
  | "HEALTH_CHECK_FAILED";

export interface SessionExpiryDetail {
  reason: SessionExpiryReason;
  /** Optional human-readable context (e.g. server message). */
  detail?: string;
  /** Server-supplied correlation ID for support diagnostics. */
  requestId?: string;
}

export const SESSION_EXPIRY_EVENT = "izenzo:session-force-reauth";

/**
 * Companion event consumed by `useDraftPersistence` and other "save my work
 * before the user is bounced" listeners. We always fire this BEFORE the
 * modal event so any in-flight form contents are persisted to sessionStorage
 * before the global SessionExpiredModal triggers a `window.location.href`
 * redirect to /auth.
 */
export const SESSION_EMERGENCY_SAVE_EVENT = "izenzo:session-expiry";

/** Fire the global "session expired, force re-auth" event. Idempotent. */
export function notifySessionExpired(
  reason: SessionExpiryReason,
  detail?: string,
  requestId?: string
): void {
  if (typeof window === "undefined") return;
  // 1) Emergency-save first - synchronous dispatch so listeners run before
  //    the modal opens and any subsequent navigation happens.
  window.dispatchEvent(new CustomEvent(SESSION_EMERGENCY_SAVE_EVENT));
  // 2) Then surface the modal.
  window.dispatchEvent(
    new CustomEvent<SessionExpiryDetail>(SESSION_EXPIRY_EVENT, {
      detail: { reason, detail, requestId },
    })
  );
}

/** Subscribe to expiry events. Returns an unsubscribe function. */
export function onSessionExpired(handler: (detail: SessionExpiryDetail) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = (e: Event) => {
    const ce = e as CustomEvent<SessionExpiryDetail>;
    handler(ce.detail);
  };
  window.addEventListener(SESSION_EXPIRY_EVENT, listener);
  return () => window.removeEventListener(SESSION_EXPIRY_EVENT, listener);
}
