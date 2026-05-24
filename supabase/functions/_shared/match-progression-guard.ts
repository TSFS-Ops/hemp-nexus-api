/**
 * MT-008 / MT-009 — Server-side progression guard.
 *
 * Source of truth: signed Client Workflow Decision Form, MT-008 (legacy /
 * inconsistent match rows) and MT-009 (organisation-attached match with no
 * named buyer/seller contact). Pure helpers live in
 * `_shared/match-lifecycle.ts`; this module is the impure wrapper that
 * loads the actual `matches` + `match_named_contacts` rows, runs the
 * predicates, emits the canonical block audits, and returns a stable
 * 409 response shape that every progression edge function consumes.
 *
 * Guard MUST run BEFORE any side effect:
 *   - POI state transition / mint
 *   - WaD attest / seal / phase-3
 *   - Collapse / finality / execution
 *   - Outreach send (poi-engagements send-outreach)
 *   - Credit burn (atomic_token_burn callers)
 *   - Payment event emission
 *
 * Returned audit names — never rename without updating the runbook AND
 * `src/tests/mt-008-mt-009-server-progression-guard.test.ts`:
 *   MT-008 block  → "match.legacy_state_reconciliation_required"
 *   MT-009 block  → "match.organisation_attached_contact_required"
 *                  + "match.progression_blocked_missing_named_contact"
 *
 * Existing audits NOT modified by this guard:
 *   "match.legacy_state_repaired", "match.legacy_state_archived",
 *   "match.named_contact_assigned" — emitted by their owning admin RPCs.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import {
  isInconsistentMatch,
  inconsistencyReasons,
  requiresNamedContact,
  type LifecycleMatch,
  type ActiveNamedContact,
  type NamedContactGap,
} from "./match-lifecycle.ts";

export const AUDIT_LEGACY_STATE_RECONCILIATION_REQUIRED =
  "match.legacy_state_reconciliation_required" as const;
export const AUDIT_ORGANISATION_ATTACHED_CONTACT_REQUIRED =
  "match.organisation_attached_contact_required" as const;
export const AUDIT_PROGRESSION_BLOCKED_MISSING_NAMED_CONTACT =
  "match.progression_blocked_missing_named_contact" as const;

const SYSTEM_ORG_SENTINEL = "00000000-0000-0000-0000-000000000000";

/** Canonical progression actions a caller may attempt. */
export type ProgressionAction =
  | "poi"
  | "poi_transition"
  | "wad"
  | "execution"
  | "finality"
  | "collapse"
  | "outreach"
  | "credit_burn"
  | "payment_event";

export type ProgressionBlockCode =
  | "MT_008_INCONSISTENT_MATCH"
  | "MT_008_LEGACY_ADMIN_HOLD"
  | "MT_009_NAMED_CONTACT_REQUIRED";

export type ProgressionGuardDecision =
  | { allowed: true; matchId: string }
  | {
      allowed: false;
      matchId: string;
      code: ProgressionBlockCode;
      httpStatus: 409;
      message: string;
      details: Record<string, unknown>;
    };

const LIFECYCLE_COLUMNS = [
  "id",
  "status",
  "state",
  "poi_state",
  "settled_at",
  "completed_at",
  "buyer_committed_at",
  "seller_committed_at",
  "buyer_org_id",
  "seller_org_id",
  "buyer_authorised_user_id",
  "seller_authorised_user_id",
  "buyer_contact_user_id",
  "seller_contact_user_id",
  "metadata",
  "org_id",
].join(", ");

function hasMarker(m: LifecycleMatch, key: string): boolean {
  const md = m.metadata;
  if (!md || typeof md !== "object") return false;
  const v = (md as Record<string, unknown>)[key];
  return v === true || v === "true" || v === 1;
}

async function writeBlockAudit(
  supabase: SupabaseClient,
  action: string,
  matchId: string,
  orgId: string | null,
  metadata: Record<string, unknown>,
): Promise<void> {
  try {
    await supabase.from("audit_logs").insert({
      org_id: orgId || SYSTEM_ORG_SENTINEL,
      entity_type: "match",
      entity_id: matchId,
      action,
      metadata: {
        ...metadata,
        guard: "match-progression-guard",
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    // Best-effort: audit failure must NOT prevent the block response.
    console.error("[match-progression-guard] audit insert failed", { action, matchId, err });
  }
}

export interface AssertProgressableArgs {
  supabase: SupabaseClient;
  matchId: string;
  action: ProgressionAction;
  sourceFunction: string;
  actorUserId?: string | null;
  actorOrgId?: string | null;
  /** Optional pre-loaded match row to skip the SELECT. */
  preloadedMatch?: LifecycleMatch & { id?: string; org_id?: string | null };
}

/**
 * MT-008 + MT-009 server-side guard. Loads the canonical match row,
 * loads its active named contacts, evaluates both predicates, writes the
 * canonical block audits if blocked, and returns a decision the caller
 * MUST convert to a 409 response before performing any side effect.
 *
 * Fails CLOSED on lookup errors that prevent evaluation: if the match
 * cannot be loaded, the guard returns allowed=false. Callers that already
 * loaded the match for other reasons may pass `preloadedMatch` to avoid
 * a redundant SELECT and to ensure consistency with their own snapshot.
 */
export async function assertMatchProgressable(
  args: AssertProgressableArgs,
): Promise<ProgressionGuardDecision> {
  const { supabase, matchId, action, sourceFunction, actorUserId, actorOrgId, preloadedMatch } = args;

  let match: (LifecycleMatch & { id?: string; org_id?: string | null }) | null = null;
  if (preloadedMatch && preloadedMatch.id === matchId) {
    match = preloadedMatch;
  } else {
    const { data, error } = await supabase
      .from("matches")
      .select(LIFECYCLE_COLUMNS)
      .eq("id", matchId)
      .maybeSingle();
    if (error || !data) {
      // Fail closed — never allow progression on a row we cannot evaluate.
      return {
        allowed: false,
        matchId,
        code: "MT_008_INCONSISTENT_MATCH",
        httpStatus: 409,
        message: "Match could not be loaded for progression guard evaluation.",
        details: { action, source_function: sourceFunction, reason: "match_load_failed" },
      };
    }
    match = data as LifecycleMatch & { id?: string; org_id?: string | null };
  }

  // ── MT-008: legacy / inconsistent / admin-hold rows must not progress ──
  const reasons = inconsistencyReasons(match);
  const legacyHold =
    hasMarker(match, "legacy_archived_admin_hold") ||
    hasMarker(match, "parent_archived_admin_exception_hold");

  if (reasons.length > 0 || legacyHold) {
    const code: ProgressionBlockCode = legacyHold
      ? "MT_008_LEGACY_ADMIN_HOLD"
      : "MT_008_INCONSISTENT_MATCH";
    await writeBlockAudit(
      supabase,
      AUDIT_LEGACY_STATE_RECONCILIATION_REQUIRED,
      matchId,
      actorOrgId ?? match.org_id ?? null,
      {
        action_attempted: action,
        source_function: sourceFunction,
        reasons,
        legacy_archived_admin_hold: hasMarker(match, "legacy_archived_admin_hold"),
        parent_archived_admin_exception_hold: hasMarker(
          match,
          "parent_archived_admin_exception_hold",
        ),
        actor_user_id: actorUserId ?? null,
        block_code: code,
      },
    );
    return {
      allowed: false,
      matchId,
      code,
      httpStatus: 409,
      message:
        code === "MT_008_LEGACY_ADMIN_HOLD"
          ? "Match is on legacy admin hold and cannot progress until repaired or archived."
          : "Match has inconsistent lifecycle state and cannot progress until reconciled.",
      details: {
        action,
        source_function: sourceFunction,
        inconsistency_reasons: reasons,
        legacy_hold: legacyHold,
      },
    };
  }

  // ── MT-009: organisation-attached row missing named contact ──
  const { data: namedRows, error: namedErr } = await supabase
    .from("match_named_contacts")
    .select("side, status")
    .eq("match_id", matchId);
  if (namedErr) {
    // Fail closed — cannot evaluate MT-009 satisfaction.
    return {
      allowed: false,
      matchId,
      code: "MT_009_NAMED_CONTACT_REQUIRED",
      httpStatus: 409,
      message: "Named-contact satisfaction could not be evaluated.",
      details: { action, source_function: sourceFunction, reason: "named_contact_load_failed" },
    };
  }

  const active: ActiveNamedContact[] = (namedRows ?? []).map((r) => ({
    side: (r as { side: "buyer" | "seller" }).side,
    status: (r as { status?: string | null }).status ?? "active",
  }));
  const gap: NamedContactGap = requiresNamedContact(match, active);

  if (gap !== null) {
    // Two distinct audit emissions per signed spec:
    //   organisation_attached_contact_required → detection signal
    //   progression_blocked_missing_named_contact → action signal
    await writeBlockAudit(
      supabase,
      AUDIT_ORGANISATION_ATTACHED_CONTACT_REQUIRED,
      matchId,
      actorOrgId ?? match.org_id ?? null,
      {
        action_attempted: action,
        source_function: sourceFunction,
        missing_side: gap,
        buyer_org_id: match.buyer_org_id ?? null,
        seller_org_id: match.seller_org_id ?? null,
      },
    );
    await writeBlockAudit(
      supabase,
      AUDIT_PROGRESSION_BLOCKED_MISSING_NAMED_CONTACT,
      matchId,
      actorOrgId ?? match.org_id ?? null,
      {
        action_attempted: action,
        source_function: sourceFunction,
        missing_side: gap,
        actor_user_id: actorUserId ?? null,
      },
    );
    return {
      allowed: false,
      matchId,
      code: "MT_009_NAMED_CONTACT_REQUIRED",
      httpStatus: 409,
      message:
        "A named " +
        (gap === "both" ? "buyer and seller" : gap) +
        " contact is required before this match can progress.",
      details: { action, source_function: sourceFunction, missing_side: gap },
    };
  }

  // Also assert intra-helper invariant
  if (isInconsistentMatch(match)) {
    return {
      allowed: false,
      matchId,
      code: "MT_008_INCONSISTENT_MATCH",
      httpStatus: 409,
      message: "Match has inconsistent lifecycle state and cannot progress until reconciled.",
      details: { action, source_function: sourceFunction, inconsistency_reasons: reasons },
    };
  }

  return { allowed: true, matchId };
}

/**
 * Convert a blocked decision into the standard JSON 409 response body.
 * Allowed decisions return null (caller continues).
 */
export function buildProgressionGuardResponse(
  decision: ProgressionGuardDecision,
  corsHeaders: Record<string, string> = {},
): Response | null {
  if (decision.allowed) return null;
  return new Response(
    JSON.stringify({
      error: decision.message,
      code: decision.code,
      match_id: decision.matchId,
      details: decision.details,
    }),
    {
      status: decision.httpStatus,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
}
