/**
 * Phase 2 wiring helpers for the canonical governance audit writer.
 *
 * Thin convenience layer around `_shared/governance-audit.ts` that
 *   1. derives a deterministic idempotency_key per critical action so
 *      retries (network, idempotent endpoints) cannot duplicate the event,
 *   2. supplies a posture_snapshot scaffold so critical events always pass
 *      validation, even when the caller cannot determine posture exactly
 *      (in which case `verification_posture: "Not recorded"` is recorded
 *      with `posture_reason` set, per the Phase 2 spec).
 *
 * Callers MUST use writeCriticalGovernanceEvent (re-exported) for critical
 * events and propagate any throw — the underlying business action must
 * fail closed.
 */

import {
  writeCriticalGovernanceEvent,
  writeGovernanceEventBestEffort,
  type AdminLike,
  type GovernanceWriteInput,
  type GovernanceWriteResult,
  type PostureSnapshot,
} from "./governance-audit.ts";

export { writeCriticalGovernanceEvent, writeGovernanceEventBestEffort };

export interface PostureHints {
  policy_version?: string | null;
  waiver_applied?: boolean;
  bypass_applied?: boolean;
  demo?: boolean;
  test_mode?: boolean;
  evidence_level?: string | null;
  check_status?: Record<string, unknown> | null;
  stale_verification?: boolean;
  manual_review_required?: boolean;
}

/**
 * Build a posture_snapshot that always satisfies the critical-event
 * validation. When `verification_posture` cannot be confidently derived,
 * pass `"Not recorded"` with a non-empty `reason` and the writer accepts it.
 */
export function buildPostureSnapshot(
  verification_posture: PostureSnapshot["verification_posture"],
  hints: PostureHints & { reason?: string } = {},
): PostureSnapshot {
  const out: PostureSnapshot = {
    verification_posture,
    policy_version: hints.policy_version ?? null,
    waiver_applied: !!hints.waiver_applied,
    bypass_applied: !!hints.bypass_applied,
    demo: !!hints.demo,
    test_mode: !!hints.test_mode,
    evidence_level: hints.evidence_level ?? null,
    check_status_snapshot: hints.check_status ?? null,
    stale_verification: !!hints.stale_verification,
    manual_review_required: !!hints.manual_review_required,
  };
  if (verification_posture === "Not recorded") {
    out.posture_reason = hints.reason || "source data unavailable";
  }
  return out;
}

/**
 * Derive a stable idempotency key for a critical action. Same parts
 * → same key, so retries within the 5-minute idempotency window dedupe.
 */
export function deriveIdempotencyKey(parts: {
  aggregate_id: string;
  event_type: string;
  request_id?: string | null;
  extra?: string | null;
}): string {
  return [
    parts.aggregate_id,
    parts.event_type,
    parts.request_id ?? "no-req",
    parts.extra ?? "",
  ].join("|");
}

/**
 * Convenience wrapper: validate + write a critical event with a
 * pre-built posture snapshot and derived idempotency key.
 * Throws on failure (caller MUST fail closed).
 */
export async function writeCriticalEventWithPosture(
  admin: AdminLike,
  input: Omit<GovernanceWriteInput, "posture_snapshot" | "idempotency_key"> & {
    posture: PostureSnapshot;
    idempotency_extra?: string;
  },
): Promise<GovernanceWriteResult> {
  const { posture, idempotency_extra, ...rest } = input;
  return await writeCriticalGovernanceEvent(admin, {
    ...rest,
    posture_snapshot: posture,
    idempotency_key: deriveIdempotencyKey({
      aggregate_id: rest.aggregate_id,
      event_type: rest.event_type,
      request_id: rest.request_id,
      extra: idempotency_extra ?? null,
    }),
  });
}
