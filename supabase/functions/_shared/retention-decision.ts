/**
 * DATA-004 Phase 3 — Canonical retention decision helper.
 *
 * Single source of truth used by ALL wired retention sweepers when
 * deciding whether a given row may be purged. Sweepers must consume the
 * structured decisions returned here rather than re-implementing policy
 * lookup or fallback semantics inline.
 *
 * Failure mode: FAIL-CLOSED.
 *   - missing org policy             → skipped_due_to_missing_policy
 *   - explicitly disabled policy     → skipped_due_to_disabled_policy
 *   - invalid policy (below floor /
 *     non-positive / unresolved)     → skipped_due_to_invalid_policy
 *   - active legal hold              → skipped_due_to_legal_hold
 *   - lookup error                   → skipped_due_to_error
 *   - retention window not elapsed   → retained_not_expired
 *   - all checks pass                → eligible_for_purge
 *
 * Phase 3 wires this for `email_send_log` only via the
 * `purge-email-send-log-daily` edge function. No other sweeper may
 * import this module yet — `check-data-004-phase3-enforcement-scope.mjs`
 * fails the build if they do.
 */

// deno-lint-ignore-file no-explicit-any

import { assertNoLegalHold, RECORD_GROUP_IDS, type LegalHoldScope } from "./legal-hold.ts";

export type RetentionDecision =
  | "eligible_for_purge"
  | "retained_not_expired"
  | "skipped_due_to_missing_policy"
  | "skipped_due_to_disabled_policy"
  | "skipped_due_to_invalid_policy"
  | "skipped_due_to_legal_hold"
  | "skipped_due_to_error";

export interface RetentionDecisionInput {
  admin: any;
  orgId: string | null;          // null = platform-scope row (no org attribution)
  recordClass: "email_send_log"; // expand union as more classes get wired
  rowAgeDays: number;            // age of the row in days
  legalHoldScopes?: LegalHoldScope[]; // extra scopes to check beyond org/record_group
  jobName: string;
  requestId?: string | null;
}

export interface RetentionDecisionResult {
  decision: RetentionDecision;
  reason: string;
  retention_days: number | null;
  policy_id: string | null;
  policy_source: "explicit" | "missing" | "disabled" | "invalid" | "platform_scope" | "error";
  legal_hold_id?: string | null;
}

const PLATFORM_FLOORS: Record<string, number> = {
  email_send_log: 90,
};

/**
 * Pure decision evaluator. Reads `org_retention_policies` directly so we
 * can distinguish "explicit" from "missing" (the SECURITY DEFINER reader
 * `get_effective_retention_days` collapses both into the platform floor,
 * which would silently authorise deletion — exactly what Phase 3 must
 * not do).
 */
export async function decideRetention(
  input: RetentionDecisionInput,
): Promise<RetentionDecisionResult> {
  const { admin, orgId, recordClass, rowAgeDays, jobName, requestId } = input;
  const floor = PLATFORM_FLOORS[recordClass];
  if (!floor) {
    return {
      decision: "skipped_due_to_invalid_policy",
      reason: `no platform floor defined for record_class=${recordClass}`,
      retention_days: null,
      policy_id: null,
      policy_source: "invalid",
    };
  }

  // Platform-scope rows (no org attribution) are NOT auto-purged in Phase 3.
  // The spec forbids any global fallback deletion that is not explicitly
  // designed/tested. Surface them as missing-policy skips.
  if (!orgId) {
    return {
      decision: "skipped_due_to_missing_policy",
      reason: "platform_scope_row_has_no_org_attribution",
      retention_days: null,
      policy_id: null,
      policy_source: "platform_scope",
    };
  }

  // 1. Resolve the explicit org policy.
  let policyRow: any = null;
  try {
    const { data, error } = await admin
      .from("org_retention_policies")
      .select("id, retention_days, floor_days, metadata")
      .eq("org_id", orgId)
      .eq("record_class", recordClass)
      .maybeSingle();
    if (error) {
      return {
        decision: "skipped_due_to_error",
        reason: `policy_lookup_failed: ${error.message ?? "unknown"}`,
        retention_days: null,
        policy_id: null,
        policy_source: "error",
      };
    }
    policyRow = data;
  } catch (e) {
    return {
      decision: "skipped_due_to_error",
      reason: `policy_lookup_threw: ${(e as Error)?.message ?? "unknown"}`,
      retention_days: null,
      policy_id: null,
      policy_source: "error",
    };
  }

  if (!policyRow) {
    return {
      decision: "skipped_due_to_missing_policy",
      reason: "no_explicit_policy_for_org_record_class",
      retention_days: null,
      policy_id: null,
      policy_source: "missing",
    };
  }

  // 2. Disabled flag via metadata.enabled === false.
  const meta = (policyRow.metadata ?? {}) as Record<string, unknown>;
  if (meta?.enabled === false) {
    return {
      decision: "skipped_due_to_disabled_policy",
      reason: "policy.metadata.enabled === false",
      retention_days: policyRow.retention_days ?? null,
      policy_id: policyRow.id ?? null,
      policy_source: "disabled",
    };
  }

  // 3. Validate retention window.
  const retentionDays = Number(policyRow.retention_days);
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) {
    return {
      decision: "skipped_due_to_invalid_policy",
      reason: "retention_days is not a positive finite number",
      retention_days: null,
      policy_id: policyRow.id ?? null,
      policy_source: "invalid",
    };
  }
  if (retentionDays < floor) {
    return {
      decision: "skipped_due_to_invalid_policy",
      reason: `retention_days(${retentionDays}) below platform floor(${floor})`,
      retention_days: retentionDays,
      policy_id: policyRow.id ?? null,
      policy_source: "invalid",
    };
  }

  // 4. Legal hold check. Fail-closed on lookup errors.
  const scopes: LegalHoldScope[] = [
    { scope_type: "org", scope_id: orgId },
    {
      scope_type: "record_group",
      scope_id: RECORD_GROUP_IDS.email_send_log_anonymise,
    },
    ...(input.legalHoldScopes ?? []),
  ];
  try {
    const hold = await assertNoLegalHold(admin, scopes, {
      action: `${jobName}.row_purge`,
      actorUserId: null,
      actorOrgId: orgId,
      requestId: requestId ?? null,
    });
    if (hold.blocked) {
      return {
        decision: "skipped_due_to_legal_hold",
        reason: hold.message ?? "legal_hold_active",
        retention_days: retentionDays,
        policy_id: policyRow.id ?? null,
        policy_source: "explicit",
        legal_hold_id: hold.activeHold?.id ?? null,
      };
    }
  } catch (e) {
    return {
      decision: "skipped_due_to_error",
      reason: `legal_hold_lookup_threw: ${(e as Error)?.message ?? "unknown"}`,
      retention_days: retentionDays,
      policy_id: policyRow.id ?? null,
      policy_source: "error",
    };
  }

  // 5. Age check.
  if (!Number.isFinite(rowAgeDays) || rowAgeDays < retentionDays) {
    return {
      decision: "retained_not_expired",
      reason: `row_age_days(${rowAgeDays}) < retention_days(${retentionDays})`,
      retention_days: retentionDays,
      policy_id: policyRow.id ?? null,
      policy_source: "explicit",
    };
  }

  return {
    decision: "eligible_for_purge",
    reason: "policy_resolved_and_age_exceeded",
    retention_days: retentionDays,
    policy_id: policyRow.id ?? null,
    policy_source: "explicit",
  };
}

export function getPlatformFloorDays(recordClass: string): number | null {
  return PLATFORM_FLOORS[recordClass] ?? null;
}
