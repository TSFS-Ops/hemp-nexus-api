/**
 * DATA-003 Phase 1 — Legal Hold helper.
 *
 * Used by destructive / anonymising / purge / export-destruction edge
 * functions to refuse work when an active legal hold covers any of the
 * scopes the work would touch.
 *
 * Failure mode: fail-CLOSED. If the table is missing or the query
 * errors out, we treat that as "unable to confirm no hold" and BLOCK
 * the action. (The previous stub in user-export-request explicitly
 * swallowed errors as "no hold" — that behaviour is replaced now that
 * the table exists.)
 *
 * Canonical audit names emitted by this module:
 *   - data.deletion_blocked_legal_hold  (on any block)
 *
 * The apply / release audits (`data.legal_hold_applied`,
 * `data.legal_hold_released`) are emitted by the admin-legal-hold
 * edge function — NOT here.
 */

// deno-lint-ignore-file no-explicit-any

export type LegalHoldScopeType =
  | "user"
  | "org"
  | "match"
  | "engagement"
  | "poi"
  | "wad"
  | "dispute"
  | "payment"
  | "evidence"
  | "record_group";

export interface LegalHoldScope {
  scope_type: LegalHoldScopeType;
  scope_id: string;
}

export interface AssertNoLegalHoldContext {
  /** Action label used in the audit row, e.g. "delete-account.profile_anonymise". */
  action: string;
  /** Caller user id (for audit). Null = system/cron caller. */
  actorUserId?: string | null;
  /** Caller org id (for audit). Null/undefined if not applicable. */
  actorOrgId?: string | null;
  /** Free-form request id for tracing. */
  requestId?: string | null;
  /** Optional caller-supplied id correlating this attempt to a request. */
  relatedRequestId?: string | null;
  /** Extra metadata to merge into the block audit row. */
  extra?: Record<string, unknown>;
}

export interface AssertNoLegalHoldResult {
  blocked: boolean;
  /** When blocked, the active hold that caused the block (first match). */
  activeHold?: {
    id: string;
    scope_type: LegalHoldScopeType;
    scope_id: string;
    reason: string;
    applied_at: string;
  };
  /** Stable error code clients can switch on. */
  code?: "LEGAL_HOLD_ACTIVE" | "LEGAL_HOLD_CHECK_FAILED";
  message?: string;
}

/**
 * Well-known UUIDs for `record_group` scope sentinels. These are used by
 * destructive paths that operate over an entire table or pipeline rather
 * than a per-record scope (e.g. the email-log anonymise job).
 *
 * Add new sentinels here rather than inventing UUIDs at call-sites.
 */
export const RECORD_GROUP_IDS = {
  retention_enforcement: "11111111-0000-4000-8000-000000000001",
  storage_deletion_queue: "11111111-0000-4000-8000-000000000002",
  storage_orphan_cleanup: "11111111-0000-4000-8000-000000000003",
  email_send_log_anonymise: "11111111-0000-4000-8000-000000000004",
  cold_storage_archive: "11111111-0000-4000-8000-000000000005",
} as const;

/**
 * Check whether any of the supplied scopes has an active legal hold.
 *
 * If `admin` is a service-role client, RLS is bypassed automatically
 * (correct: enforcement must work for cron callers and edge functions
 * acting on behalf of users).
 */
export async function assertNoLegalHold(
  admin: any,
  scopes: LegalHoldScope[],
  ctx: AssertNoLegalHoldContext,
): Promise<AssertNoLegalHoldResult> {
  if (!scopes || scopes.length === 0) {
    return { blocked: false };
  }

  // Build an OR of (scope_type=X AND scope_id=Y) pairs.
  const orFilter = scopes
    .map((s) => `and(scope_type.eq.${s.scope_type},scope_id.eq.${s.scope_id})`)
    .join(",");

  let activeRows: Array<{
    id: string;
    scope_type: LegalHoldScopeType;
    scope_id: string;
    reason: string;
    applied_at: string;
  }> | null = null;
  let queryError: unknown = null;

  try {
    const { data, error } = await admin
      .from("legal_holds")
      .select("id, scope_type, scope_id, reason, applied_at")
      .eq("status", "active")
      .or(orFilter)
      .limit(1);
    if (error) queryError = error;
    else activeRows = data ?? [];
  } catch (e) {
    queryError = e;
  }

  // Fail-CLOSED on errors. The previous stub swallowed errors as "no hold";
  // we deliberately reverse that now that the table exists.
  if (queryError) {
    console.error(
      `[legal-hold] check failed for action=${ctx.action}:`,
      queryError,
    );
    // Best-effort audit of the failure so admins can see why a destructive
    // action was refused.
    await writeBlockAudit(admin, scopes, null, ctx, {
      block_reason: "check_failed",
      error: (queryError as Error)?.message ?? String(queryError),
    });
    return {
      blocked: true,
      code: "LEGAL_HOLD_CHECK_FAILED",
      message:
        "Could not verify legal-hold status. Action refused until verification succeeds.",
    };
  }

  if (activeRows && activeRows.length > 0) {
    const hold = activeRows[0];
    await writeBlockAudit(admin, scopes, hold, ctx, {
      block_reason: "active_hold",
    });
    return {
      blocked: true,
      code: "LEGAL_HOLD_ACTIVE",
      activeHold: hold,
      message:
        "Deletion/anonymisation is blocked because an active legal hold exists for this scope.",
    };
  }

  return { blocked: false };
}

async function writeBlockAudit(
  admin: any,
  scopes: LegalHoldScope[],
  hold:
    | { id: string; scope_type: LegalHoldScopeType; scope_id: string; reason: string; applied_at: string }
    | null,
  ctx: AssertNoLegalHoldContext,
  extra: Record<string, unknown>,
): Promise<void> {
  try {
    await admin.from("audit_logs").insert({
      org_id: ctx.actorOrgId ?? null,
      actor_user_id: ctx.actorUserId ?? null,
      action: "data.deletion_blocked_legal_hold",
      entity_type: "legal_hold",
      entity_id: hold?.id ?? null,
      metadata: {
        action_context: ctx.action,
        request_id: ctx.requestId ?? null,
        related_request_id: ctx.relatedRequestId ?? null,
        actor_user_id: ctx.actorUserId ?? null,
        actor_org_id: ctx.actorOrgId ?? null,
        scopes,
        legal_hold_id: hold?.id ?? null,
        scope_type: hold?.scope_type ?? null,
        scope_id: hold?.scope_id ?? null,
        reason: hold?.reason ?? null,
        applied_at: hold?.applied_at ?? null,
        ...extra,
        ...(ctx.extra ?? {}),
      },
    });
  } catch (e) {
    console.error(
      `[legal-hold] failed to write data.deletion_blocked_legal_hold audit:`,
      e,
    );
  }
}

/**
 * Canonical audit name list — kept in this module so the parity guard
 * test can import them as the single source of truth.
 */
export const LEGAL_HOLD_AUDIT_NAMES = {
  applied: "data.legal_hold_applied",
  released: "data.legal_hold_released",
  deletion_blocked: "data.deletion_blocked_legal_hold",
} as const;
