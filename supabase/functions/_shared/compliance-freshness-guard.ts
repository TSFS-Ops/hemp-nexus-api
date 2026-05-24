/**
 * COMP-002 / COMP-012 — compliance freshness guard (Deno).
 *
 * Source of truth: signed Client Workflow Decision Form
 *   COMP-002 — Sanctions screening becomes stale after onboarding (30 days)
 *   COMP-012 — Verification data is older than the allowed threshold (365 days)
 *
 * The guard MUST run after MT-008/MT-009/Mt-012 and engagement guards,
 * and BEFORE any side effect (WaD create/issue/seal, p3-WaD, execution,
 * finality, collapse, token burn, payment event). Returns a stable 409
 * with a documented code. Idempotently opens a `compliance_holds` row
 * and a `operator_verification_requests` queue item on every block.
 *
 * Fails CLOSED on lookup errors.
 *
 * Stable error codes:
 *   COMP_HOLD_ACTIVE
 *   COMP_002_SANCTIONS_MISSING
 *   COMP_002_SANCTIONS_STALE
 *   COMP_002_SANCTIONS_POTENTIAL_MATCH
 *   COMP_012_VERIFICATION_MISSING
 *   COMP_012_VERIFICATION_STALE
 *   COMP_012_VERIFICATION_FAILED
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import {
  SANCTIONS_FRESHNESS_MS,
  VERIFICATION_FRESHNESS_MS,
  SANCTIONS_FRESHNESS_DAYS,
  VERIFICATION_FRESHNESS_DAYS,
} from "./freshness-thresholds.ts";
import {
  COMP_002_SANCTIONS_RESCREEN_REQUIRED,
  COMP_002_SANCTIONS_POTENTIAL_MATCH_DETECTED,
  COMP_012_VERIFICATION_REFRESH_REQUIRED,
  COMP_012_VERIFICATION_REFRESH_FAILED,
  COMP_PROGRESSION_BLOCKED_SANCTIONS_STALE,
  COMP_PROGRESSION_BLOCKED_VERIFICATION_STALE,
} from "./comp-002-012-audit.ts";

const SYSTEM_ORG_SENTINEL = "00000000-0000-0000-0000-000000000000";

export type ComplianceProgressionAction =
  | "wad"
  | "p3_wad"
  | "execution"
  | "finality"
  | "collapse"
  | "credit_burn"
  | "payment_event";

export type ComplianceBlockCode =
  | "COMP_HOLD_ACTIVE"
  | "COMP_002_SANCTIONS_MISSING"
  | "COMP_002_SANCTIONS_STALE"
  | "COMP_002_SANCTIONS_POTENTIAL_MATCH"
  | "COMP_012_VERIFICATION_MISSING"
  | "COMP_012_VERIFICATION_STALE"
  | "COMP_012_VERIFICATION_FAILED";

export type ComplianceHoldType =
  | "sanctions_rescreen_required"
  | "compliance_hold_sanctions_rescreen"
  | "compliance_hold_sanctions_potential_match"
  | "verification_refresh_required"
  | "compliance_hold_verification_refresh"
  | "compliance_hold_verification_failed";

export type ComplianceFreshnessDecision =
  | { allowed: true; matchId: string }
  | {
      allowed: false;
      matchId: string;
      code: ComplianceBlockCode;
      httpStatus: 409;
      message: string;
      details: Record<string, unknown>;
    };

export interface AssertCompliantFreshnessArgs {
  supabase: SupabaseClient;
  matchId: string;
  action: ComplianceProgressionAction;
  sourceFunction: string;
  actorUserId?: string | null;
  actorOrgId?: string | null;
}

interface SidePayload {
  org_id: string;
  side: "buyer" | "seller";
  entity_ids: string[];
}

const HOLD_BLOCK_CODE: Record<ComplianceHoldType, ComplianceBlockCode> = {
  sanctions_rescreen_required: "COMP_002_SANCTIONS_MISSING",
  compliance_hold_sanctions_rescreen: "COMP_002_SANCTIONS_STALE",
  compliance_hold_sanctions_potential_match: "COMP_002_SANCTIONS_POTENTIAL_MATCH",
  verification_refresh_required: "COMP_012_VERIFICATION_MISSING",
  compliance_hold_verification_refresh: "COMP_012_VERIFICATION_STALE",
  compliance_hold_verification_failed: "COMP_012_VERIFICATION_FAILED",
};

const HOLD_QUEUE_KIND: Record<ComplianceHoldType, string> = {
  sanctions_rescreen_required: "sanctions_rescreen",
  compliance_hold_sanctions_rescreen: "sanctions_rescreen",
  compliance_hold_sanctions_potential_match: "sanctions_potential_match",
  verification_refresh_required: "verification_refresh",
  compliance_hold_verification_refresh: "verification_refresh",
  compliance_hold_verification_failed: "verification_failed",
};

function isSanctionsHold(t: ComplianceHoldType): boolean {
  return t.startsWith("sanctions_") || t.startsWith("compliance_hold_sanctions_");
}

async function writeAudit(
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
        guard: "compliance-freshness-guard",
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error("[compliance-freshness-guard] audit insert failed", { action, matchId, err });
  }
}

async function openHoldAndQueue(
  supabase: SupabaseClient,
  args: {
    orgId: string;
    entityId: string | null;
    holdType: ComplianceHoldType;
    reason: string;
    sourceCheckId?: string | null;
    sourceCheckType?: string | null;
    matchId: string;
    subjectName: string;
    metadata?: Record<string, unknown>;
  },
): Promise<string | null> {
  let holdId: string | null = null;
  const insertRes = await supabase
    .from("compliance_holds")
    .insert({
      org_id: args.orgId,
      entity_id: args.entityId,
      hold_type: args.holdType,
      reason: args.reason,
      source_check_id: args.sourceCheckId ?? null,
      source_check_type: args.sourceCheckType ?? null,
      status: "active",
      metadata: { match_id: args.matchId, ...(args.metadata ?? {}) },
    })
    .select("id")
    .maybeSingle();
  if (insertRes.error) {
    const existing = await supabase
      .from("compliance_holds")
      .select("id")
      .eq("org_id", args.orgId)
      .eq("hold_type", args.holdType)
      .eq("status", "active")
      .is("entity_id", args.entityId ?? null)
      .maybeSingle();
    holdId = (existing.data as { id?: string } | null)?.id ?? null;
    if (!holdId && args.entityId) {
      const existing2 = await supabase
        .from("compliance_holds")
        .select("id")
        .eq("org_id", args.orgId)
        .eq("entity_id", args.entityId)
        .eq("hold_type", args.holdType)
        .eq("status", "active")
        .maybeSingle();
      holdId = (existing2.data as { id?: string } | null)?.id ?? null;
    }
  } else {
    holdId = (insertRes.data as { id?: string } | null)?.id ?? null;
  }

  if (!holdId) return null;

  const openAudit = isSanctionsHold(args.holdType)
    ? args.holdType === "compliance_hold_sanctions_potential_match"
      ? COMP_002_SANCTIONS_POTENTIAL_MATCH_DETECTED
      : COMP_002_SANCTIONS_RESCREEN_REQUIRED
    : args.holdType === "compliance_hold_verification_failed"
    ? COMP_012_VERIFICATION_REFRESH_FAILED
    : COMP_012_VERIFICATION_REFRESH_REQUIRED;
  await writeAudit(supabase, openAudit, args.matchId, args.orgId, {
    hold_id: holdId,
    hold_type: args.holdType,
    entity_id: args.entityId,
    source_check_id: args.sourceCheckId ?? null,
    source_check_type: args.sourceCheckType ?? null,
  });

  const queueKind = HOLD_QUEUE_KIND[args.holdType];
  try {
    await supabase.from("operator_verification_requests").insert({
      match_id: args.matchId,
      org_id: args.orgId,
      subject_org_id: args.orgId,
      subject_name: args.subjectName || "compliance-hold",
      kind: queueKind,
      status: "pending",
      reason: args.reason,
      raised_by: null,
      compliance_hold_id: holdId,
    });
  } catch (_err) {
  }

  return holdId;
}

async function loadSides(
  supabase: SupabaseClient,
  matchId: string,
): Promise<{ sides: SidePayload[]; subjectNames: Record<string, string> } | null> {
  const { data: match, error } = await supabase
    .from("matches")
    .select("id, buyer_org_id, seller_org_id")
    .eq("id", matchId)
    .maybeSingle();
  if (error || !match) return null;

  const orgIds = [match.buyer_org_id, match.seller_org_id].filter(
    (v): v is string => typeof v === "string" && v.length > 0,
  );
  const sides: SidePayload[] = [];
  const subjectNames: Record<string, string> = {};

  for (const orgId of orgIds) {
    const side: "buyer" | "seller" =
      orgId === match.buyer_org_id ? "buyer" : "seller";
    const { data: ents } = await supabase
      .from("entities")
      .select("id, legal_name")
      .eq("org_id", orgId);
    const entIds = (ents ?? []).map((e: { id: string }) => e.id);
    sides.push({ org_id: orgId, side, entity_ids: entIds });
    const { data: org } = await supabase
      .from("organizations")
      .select("name")
      .eq("id", orgId)
      .maybeSingle();
    subjectNames[orgId] =
      (org as { name?: string } | null)?.name ??
      (ents?.[0] as { legal_name?: string } | undefined)?.legal_name ??
      orgId;
  }
  return { sides, subjectNames };
}

interface BlockOutcome {
  code: ComplianceBlockCode;
  holdType: ComplianceHoldType;
  reason: string;
  sourceCheckId?: string | null;
  sourceCheckType?: string | null;
  entityId?: string | null;
  orgId: string;
  side: "buyer" | "seller";
}

function ageDays(ts: string | null | undefined): number | null {
  if (!ts) return null;
  return Math.floor((Date.now() - new Date(ts).getTime()) / 86_400_000);
}

async function evaluateSide(
  supabase: SupabaseClient,
  side: SidePayload,
): Promise<BlockOutcome | null> {
  const { data: activeHolds, error: holdErr } = await supabase
    .from("compliance_holds")
    .select("id, hold_type, reason")
    .eq("org_id", side.org_id)
    .eq("status", "active")
    .limit(1);
  if (holdErr) {
    return {
      code: "COMP_HOLD_ACTIVE",
      holdType: "verification_refresh_required",
      reason: "Compliance hold table unreadable; failing closed.",
      orgId: side.org_id,
      side: side.side,
    };
  }
  if (activeHolds && activeHolds.length > 0) {
    const h = activeHolds[0] as { id: string; hold_type: ComplianceHoldType; reason: string };
    return {
      code: "COMP_HOLD_ACTIVE",
      holdType: h.hold_type,
      reason: h.reason,
      orgId: side.org_id,
      side: side.side,
    };
  }

  if (side.entity_ids.length === 0) {
    return {
      code: "COMP_012_VERIFICATION_MISSING",
      holdType: "verification_refresh_required",
      reason: "No verified entity exists for this organisation.",
      orgId: side.org_id,
      side: side.side,
      entityId: null,
    };
  }

  for (const entityId of side.entity_ids) {
    const { data: run, error: runErr } = await supabase
      .from("screening_runs")
      .select("id, status, ran_at")
      .eq("org_id", side.org_id)
      .eq("entity_id", entityId)
      .order("ran_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (runErr) {
      return {
        code: "COMP_002_SANCTIONS_MISSING",
        holdType: "sanctions_rescreen_required",
        reason: "Sanctions screening table unreadable; failing closed.",
        orgId: side.org_id,
        side: side.side,
        entityId,
      };
    }
    if (!run) {
      return {
        code: "COMP_002_SANCTIONS_MISSING",
        holdType: "sanctions_rescreen_required",
        reason: "No sanctions screening run exists for this entity.",
        orgId: side.org_id,
        side: side.side,
        entityId,
      };
    }
    const status = (run as { status: string }).status;
    const ranAt = (run as { ran_at: string }).ran_at;
    if (status === "POTENTIAL_MATCH" || status === "CONFIRMED_MATCH") {
      return {
        code: "COMP_002_SANCTIONS_POTENTIAL_MATCH",
        holdType: "compliance_hold_sanctions_potential_match",
        reason: `Sanctions screening returned ${status}.`,
        orgId: side.org_id,
        side: side.side,
        entityId,
        sourceCheckId: (run as { id: string }).id,
        sourceCheckType: "screening_run",
      };
    }
    if (status !== "CLEAR") {
      return {
        code: "COMP_002_SANCTIONS_MISSING",
        holdType: "sanctions_rescreen_required",
        reason: `Sanctions screening status '${status}' is not CLEAR.`,
        orgId: side.org_id,
        side: side.side,
        entityId,
        sourceCheckId: (run as { id: string }).id,
        sourceCheckType: "screening_run",
      };
    }
    if (Date.now() - new Date(ranAt).getTime() > SANCTIONS_FRESHNESS_MS) {
      return {
        code: "COMP_002_SANCTIONS_STALE",
        holdType: "compliance_hold_sanctions_rescreen",
        reason: `Sanctions screening is ${ageDays(ranAt)} days old (threshold ${SANCTIONS_FRESHNESS_DAYS} days).`,
        orgId: side.org_id,
        side: side.side,
        entityId,
        sourceCheckId: (run as { id: string }).id,
        sourceCheckType: "screening_run",
      };
    }

    const { data: kase, error: caseErr } = await supabase
      .from("compliance_cases")
      .select("id, status, decided_at, created_at")
      .eq("org_id", side.org_id)
      .eq("entity_id", entityId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (caseErr) {
      return {
        code: "COMP_012_VERIFICATION_MISSING",
        holdType: "verification_refresh_required",
        reason: "Compliance case table unreadable; failing closed.",
        orgId: side.org_id,
        side: side.side,
        entityId,
      };
    }
    if (!kase) {
      return {
        code: "COMP_012_VERIFICATION_MISSING",
        holdType: "verification_refresh_required",
        reason: "No compliance case exists for this entity.",
        orgId: side.org_id,
        side: side.side,
        entityId,
      };
    }
    const cStatus = (kase as { status: string }).status;
    const decidedAt = (kase as { decided_at: string | null }).decided_at;
    if (cStatus === "REJECTED" || cStatus === "SUSPENDED") {
      return {
        code: "COMP_012_VERIFICATION_FAILED",
        holdType: "compliance_hold_verification_failed",
        reason: `Compliance case status '${cStatus}'.`,
        orgId: side.org_id,
        side: side.side,
        entityId,
        sourceCheckId: (kase as { id: string }).id,
        sourceCheckType: "compliance_case",
      };
    }
    if (cStatus !== "APPROVED") {
      return {
        code: "COMP_012_VERIFICATION_MISSING",
        holdType: "verification_refresh_required",
        reason: `Compliance case status '${cStatus}' is not APPROVED.`,
        orgId: side.org_id,
        side: side.side,
        entityId,
        sourceCheckId: (kase as { id: string }).id,
        sourceCheckType: "compliance_case",
      };
    }
    if (!decidedAt || Date.now() - new Date(decidedAt).getTime() > VERIFICATION_FRESHNESS_MS) {
      return {
        code: "COMP_012_VERIFICATION_STALE",
        holdType: "compliance_hold_verification_refresh",
        reason: `Verification is ${ageDays(decidedAt) ?? "unknown"} days old (threshold ${VERIFICATION_FRESHNESS_DAYS} days).`,
        orgId: side.org_id,
        side: side.side,
        entityId,
        sourceCheckId: (kase as { id: string }).id,
        sourceCheckType: "compliance_case",
      };
    }

    const { data: ubos, error: uboErr } = await supabase
      .from("ubo_links")
      .select("id, status, expires_at")
      .eq("org_id", side.org_id)
      .eq("company_entity_id", entityId);
    if (uboErr) {
      return {
        code: "COMP_012_VERIFICATION_MISSING",
        holdType: "verification_refresh_required",
        reason: "UBO links unreadable; failing closed.",
        orgId: side.org_id,
        side: side.side,
        entityId,
      };
    }
    for (const u of ubos ?? []) {
      const ur = u as { id: string; status: string; expires_at: string | null };
      if (ur.status !== "verified") {
        return {
          code: "COMP_012_VERIFICATION_FAILED",
          holdType: "compliance_hold_verification_failed",
          reason: `UBO link status '${ur.status}' is not verified.`,
          orgId: side.org_id,
          side: side.side,
          entityId,
          sourceCheckId: ur.id,
          sourceCheckType: "ubo_link",
        };
      }
      if (ur.expires_at && new Date(ur.expires_at).getTime() < Date.now()) {
        return {
          code: "COMP_012_VERIFICATION_STALE",
          holdType: "compliance_hold_verification_refresh",
          reason: "UBO verification has expired.",
          orgId: side.org_id,
          side: side.side,
          entityId,
          sourceCheckId: ur.id,
          sourceCheckType: "ubo_link",
        };
      }
    }
  }

  return null;
}

export async function assertCompliantFreshness(
  args: AssertCompliantFreshnessArgs,
): Promise<ComplianceFreshnessDecision> {
  const { supabase, matchId, action, sourceFunction, actorUserId, actorOrgId } = args;

  const loaded = await loadSides(supabase, matchId);
  if (!loaded) {
    return {
      allowed: false,
      matchId,
      code: "COMP_HOLD_ACTIVE",
      httpStatus: 409,
      message: "Match could not be loaded for compliance freshness evaluation.",
      details: { action, source_function: sourceFunction, reason: "match_load_failed" },
    };
  }

  for (const side of loaded.sides) {
    const outcome = await evaluateSide(supabase, side);
    if (!outcome) continue;

    let holdId: string | null = null;
    if (outcome.code !== "COMP_HOLD_ACTIVE") {
      holdId = await openHoldAndQueue(supabase, {
        orgId: outcome.orgId,
        entityId: outcome.entityId ?? null,
        holdType: outcome.holdType,
        reason: outcome.reason,
        sourceCheckId: outcome.sourceCheckId ?? null,
        sourceCheckType: outcome.sourceCheckType ?? null,
        matchId,
        subjectName: loaded.subjectNames[outcome.orgId] ?? outcome.orgId,
        metadata: {
          action,
          source_function: sourceFunction,
          side: outcome.side,
          actor_user_id: actorUserId ?? null,
          actor_org_id: actorOrgId ?? null,
        },
      });
    }

    const blockAudit =
      outcome.code.startsWith("COMP_002")
        ? COMP_PROGRESSION_BLOCKED_SANCTIONS_STALE
        : COMP_PROGRESSION_BLOCKED_VERIFICATION_STALE;
    await writeAudit(supabase, blockAudit, matchId, outcome.orgId, {
      action_attempted: action,
      source_function: sourceFunction,
      block_code: outcome.code,
      hold_type: outcome.holdType,
      hold_id: holdId,
      side: outcome.side,
      entity_id: outcome.entityId ?? null,
      reason: outcome.reason,
      actor_user_id: actorUserId ?? null,
    });

    return {
      allowed: false,
      matchId,
      code: outcome.code,
      httpStatus: 409,
      message: outcome.reason,
      details: {
        action,
        source_function: sourceFunction,
        hold_type: outcome.holdType,
        hold_id: holdId,
        side: outcome.side,
        entity_id: outcome.entityId ?? null,
      },
    };
  }

  return { allowed: true, matchId };
}

export function buildComplianceFreshnessResponse(
  decision: ComplianceFreshnessDecision,
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
