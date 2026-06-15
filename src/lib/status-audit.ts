/**
 * UI-010 - canonical audit action names for public-status / admin-health.
 *
 * Source of truth: signed Client-Only Decision Form, UI-010.
 *
 * These are the ONLY two audit action names sanctioned for the status /
 * platform-health surface:
 *
 *   - `status.public_status_publish_blocked`
 *       Emitted by the admin/governance health-check helper when a code
 *       path attempts (or is configured) to publish a public status
 *       update. There is intentionally NO public publishing workflow on
 *       this platform - the public `/status` route renders only the
 *       signed UI-010 holding message. Any attempt to wire one MUST go
 *       through `recordPublicStatusPublishBlocked` so the refusal is
 *       captured as a first-class audit event rather than a silent drop.
 *
 *   - `status.admin_health_check_recorded`
 *       Emitted by the admin HealthBoard / governance-health surface
 *       (auth-gated `/governance/health`) when an admin records or
 *       observes a platform-health snapshot. This is the ONLY canonical
 *       audit name for admin-recorded platform health, and exists so
 *       that future emit points have a fixed SSOT they can import rather
 *       than coining drift-prone strings inline.
 *
 * Wired by:
 *   - `src/tests/ui-010-public-status-and-availability-claims.test.ts`
 *   - `scripts/check-public-availability-claims.mjs` (prebuild guard)
 *
 * No other files should redeclare these strings; import the constants.
 */

export const STATUS_PUBLIC_STATUS_PUBLISH_BLOCKED =
  "status.public_status_publish_blocked" as const;

export const STATUS_ADMIN_HEALTH_CHECK_RECORDED =
  "status.admin_health_check_recorded" as const;

export type StatusAuditAction =
  | typeof STATUS_PUBLIC_STATUS_PUBLISH_BLOCKED
  | typeof STATUS_ADMIN_HEALTH_CHECK_RECORDED;

/**
 * Documented refusal point for any future code path that attempts to
 * publish a public status update. Intentionally a no-op aside from the
 * caller-supplied audit emitter: there is no public publish workflow,
 * and this helper exists so that the refusal can be recorded under the
 * canonical action name without inventing a new emit string.
 *
 * Callers pass their own audit emitter (server-side or client-side); the
 * helper does not perform IO itself so it is safe to import from any
 * surface without dragging supabase/edge dependencies.
 */
export function recordPublicStatusPublishBlocked(
  emit: (action: typeof STATUS_PUBLIC_STATUS_PUBLISH_BLOCKED, metadata: Record<string, unknown>) => void,
  metadata: Record<string, unknown> = {},
): void {
  emit(STATUS_PUBLIC_STATUS_PUBLISH_BLOCKED, {
    reason: "no_public_status_publishing_workflow_exists",
    ...metadata,
  });
}

/**
 * Canonical emit point for admin-recorded platform-health observations.
 * Callers pass an audit emitter so this stays free of IO/runtime deps.
 */
export function recordAdminHealthCheck(
  emit: (action: typeof STATUS_ADMIN_HEALTH_CHECK_RECORDED, metadata: Record<string, unknown>) => void,
  metadata: Record<string, unknown> = {},
): void {
  emit(STATUS_ADMIN_HEALTH_CHECK_RECORDED, metadata);
}
