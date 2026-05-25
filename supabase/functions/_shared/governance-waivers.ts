/**
 * Batch D — Governance waiver/bypass lifecycle helpers.
 *
 * Binding rules (from David's approved waiver/bypass expiry decision):
 *   - A waiver/bypass applies ONLY to the specific record and action approved.
 *   - It expires after ONE use or 7 calendar days, whichever comes first.
 *   - Renewal requires a NEW HQ decision event and reason (a new row in
 *     governance_waivers referencing renewed_from).
 *   - It must appear in the Governance Record with posture label, actor,
 *     reason, affected step, expiry and whether progression was allowed.
 *
 * Architecture:
 *   - This module is the ONLY supported path for granting / asserting /
 *     consuming / expiring governance waivers. All writes are service_role.
 *   - It emits governance events via the canonical writer (fail-closed for
 *     grant/renew/consume/expire — those event types are in
 *     CRITICAL_SPECIFIC_NAMES).
 *   - It NEVER changes business outcomes by itself. Callers must call
 *     `assertWaiverActive` before letting a posture-gated step proceed, and
 *     `consumeGovernanceWaiver` AFTER the step succeeds.
 *
 * No browser-side direct insert. RLS only grants SELECT to platform_admin,
 * and no INSERT/UPDATE/DELETE policy exists for authenticated users.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  buildPostureSnapshot,
  writeCriticalEventWithPosture,
} from "./governance-audit-integration.ts";
import { GOVERNANCE_WAIVER_POLICY_VERSION } from "./governance-policy-versions.ts";

export type WaiverPosture = "waiver" | "bypass";
export type WaiverStatus = "active" | "consumed" | "expired" | "revoked";

/** Default cap per binding decision: 1 use, 7 days. */
export const WAIVER_DEFAULT_MAX_USES = 1;
export const WAIVER_MAX_DAYS = 7;
export const WAIVER_MAX_MS = WAIVER_MAX_DAYS * 24 * 60 * 60 * 1000;

export interface GovernanceWaiverRow {
  waiver_id: string;
  org_id: string;
  posture: WaiverPosture;
  scope: string;
  scope_id: string | null;
  match_id: string | null;
  poi_id: string | null;
  wad_id: string | null;
  granted_by: string;
  granted_at: string;
  expires_at: string;
  max_uses: number;
  uses: number;
  status: WaiverStatus;
  reason_code: string;
  note: string | null;
  renewed_from: string | null;
}

export interface GrantWaiverInput {
  org_id: string;
  posture: WaiverPosture;
  scope: string;
  scope_id?: string | null;
  match_id?: string | null;
  poi_id?: string | null;
  wad_id?: string | null;
  granted_by: string;       // actor user id (platform_admin)
  reason_code: string;      // must be on APPROVED_REASON_CODES
  note?: string | null;
  /** Optional override; clamped to <= WAIVER_MAX_MS. */
  expires_at?: string | null;
  /** Optional override; min 1, default 1. */
  max_uses?: number;
  /** For renewals; points at the prior waiver row. */
  renewed_from?: string | null;
  /** Optional idempotency anchor for the governance event write. */
  request_id?: string | null;
}

/** Result returned to callers when asserting / consuming. */
export interface AssertWaiverResult {
  allowed: boolean;
  waiver?: GovernanceWaiverRow;
  /** When allowed=false. One of: waiver_missing | waiver_expired | waiver_consumed | waiver_revoked. */
  reason_code?: "waiver_missing" | "waiver_expired" | "waiver_consumed" | "waiver_revoked";
}

/** Clamp expiry to no more than WAIVER_MAX_DAYS from now. */
export function clampExpiry(
  proposed: string | Date | null | undefined,
  nowMs = Date.now(),
): string {
  const maxMs = nowMs + WAIVER_MAX_MS;
  if (!proposed) return new Date(maxMs).toISOString();
  const t = typeof proposed === "string" ? Date.parse(proposed) : proposed.getTime();
  if (!Number.isFinite(t) || t <= nowMs) return new Date(maxMs).toISOString();
  return new Date(Math.min(t, maxMs)).toISOString();
}

function deriveAggregate(input: {
  match_id?: string | null;
  poi_id?: string | null;
  wad_id?: string | null;
  scope: string;
  scope_id?: string | null;
}): { aggregate_type: string; aggregate_id: string } {
  if (input.match_id) return { aggregate_type: "match", aggregate_id: input.match_id };
  if (input.poi_id) return { aggregate_type: "poi", aggregate_id: input.poi_id };
  if (input.wad_id) return { aggregate_type: "wad", aggregate_id: input.wad_id };
  if (input.scope_id) return { aggregate_type: input.scope, aggregate_id: input.scope_id };
  throw new Error(
    "WAIVER_ANCHOR_REQUIRED: grant requires at least one of match_id, poi_id, wad_id, or scope_id",
  );
}

function postureLabel(p: WaiverPosture): "Waiver Applied" | "Bypass Applied" {
  return p === "waiver" ? "Waiver Applied" : "Bypass Applied";
}

function eventName(p: WaiverPosture, action: "granted" | "renewed" | "consumed" | "expired"): string {
  return `governance.${p}_${action}`;
}

// deno-lint-ignore no-explicit-any
type Admin = SupabaseClient<any, any, any>;

/**
 * Grant a NEW waiver/bypass row, then emit the canonical
 * `governance.{waiver|bypass}_granted` event. Fail-closed.
 */
export async function grantGovernanceWaiver(
  admin: Admin,
  input: GrantWaiverInput,
): Promise<GovernanceWaiverRow> {
  const max_uses = Math.max(1, Math.floor(input.max_uses ?? WAIVER_DEFAULT_MAX_USES));
  const granted_at = new Date().toISOString();
  const expires_at = clampExpiry(input.expires_at ?? null, Date.parse(granted_at));

  const insertRow = {
    org_id: input.org_id,
    posture: input.posture,
    scope: input.scope,
    scope_id: input.scope_id ?? null,
    match_id: input.match_id ?? null,
    poi_id: input.poi_id ?? null,
    wad_id: input.wad_id ?? null,
    granted_by: input.granted_by,
    granted_at,
    expires_at,
    max_uses,
    uses: 0,
    status: "active" as WaiverStatus,
    reason_code: input.reason_code,
    note: input.note ?? null,
    renewed_from: input.renewed_from ?? null,
  };

  const { data, error } = await admin
    .from("governance_waivers")
    .insert(insertRow)
    .select("*")
    .single();
  if (error || !data) {
    throw new Error(`WAIVER_INSERT_FAILED: ${error?.message ?? "unknown"}`);
  }
  const row = data as GovernanceWaiverRow;

  const isRenewal = !!input.renewed_from;
  const ev = eventName(input.posture, isRenewal ? "renewed" : "granted");
  const { aggregate_type, aggregate_id } = deriveAggregate({
    match_id: row.match_id,
    poi_id: row.poi_id,
    wad_id: row.wad_id,
    scope: row.scope,
    scope_id: row.scope_id,
  });

  await writeCriticalEventWithPosture(admin, {
    event_type: ev,
    org_id: row.org_id,
    aggregate_type,
    aggregate_id,
    actor_user_id: input.granted_by,
    actor_role: "platform_admin",
    source_function: "governance-waivers",
    request_id: input.request_id ?? null,
    match_id: row.match_id,
    poi_id: row.poi_id,
    wad_id: row.wad_id,
    allowed_or_blocked: "allowed",
    reason_code: input.reason_code,
    posture: buildPostureSnapshot(postureLabel(row.posture), {
      policy_version: GOVERNANCE_WAIVER_POLICY_VERSION,
      waiver_applied: row.posture === "waiver",
      bypass_applied: row.posture === "bypass",
    }),
    metadata: {
      waiver_id: row.waiver_id,
      scope: row.scope,
      scope_id: row.scope_id,
      expires_at: row.expires_at,
      max_uses: row.max_uses,
      uses: row.uses,
      renewed_from: row.renewed_from,
      note: row.note,
    },
    idempotency_extra: `${row.waiver_id}|${isRenewal ? "renewed" : "granted"}`,
  });

  return row;
}

/**
 * Renew an existing waiver. Convenience wrapper that copies scope/anchors
 * from the prior row and inserts a new row that references `renewed_from`.
 */
export async function renewGovernanceWaiver(
  admin: Admin,
  input: {
    prior_waiver_id: string;
    granted_by: string;
    reason_code: string;
    note?: string | null;
    expires_at?: string | null;
    max_uses?: number;
    request_id?: string | null;
  },
): Promise<GovernanceWaiverRow> {
  const { data: prior, error } = await admin
    .from("governance_waivers")
    .select("*")
    .eq("waiver_id", input.prior_waiver_id)
    .maybeSingle();
  if (error || !prior) {
    throw new Error(`WAIVER_RENEW_PRIOR_NOT_FOUND: ${input.prior_waiver_id}`);
  }
  const p = prior as GovernanceWaiverRow;
  return await grantGovernanceWaiver(admin, {
    org_id: p.org_id,
    posture: p.posture,
    scope: p.scope,
    scope_id: p.scope_id,
    match_id: p.match_id,
    poi_id: p.poi_id,
    wad_id: p.wad_id,
    granted_by: input.granted_by,
    reason_code: input.reason_code,
    note: input.note ?? null,
    expires_at: input.expires_at ?? null,
    max_uses: input.max_uses ?? p.max_uses,
    renewed_from: p.waiver_id,
    request_id: input.request_id ?? null,
  });
}

/**
 * Returns the freshest matching active waiver for the given anchors, or a
 * blocked result with the appropriate governance reason_code.
 *
 * Performs lazy expiry: if the freshest row is past expires_at it is flipped
 * to status='expired' and the `governance.{posture}_expired` event is
 * emitted (best-effort — the assert still returns blocked).
 *
 * Matching rules (most → least specific):
 *   1. Same (posture, scope) AND (match_id OR poi_id OR wad_id OR scope_id) match.
 *   2. Returns the freshest row by granted_at desc.
 *
 * NEVER auto-grants. NEVER changes business outcomes on its own.
 */
export async function assertWaiverActive(
  admin: Admin,
  query: {
    posture: WaiverPosture;
    scope: string;
    org_id: string;
    match_id?: string | null;
    poi_id?: string | null;
    wad_id?: string | null;
    scope_id?: string | null;
  },
): Promise<AssertWaiverResult> {
  let q = admin
    .from("governance_waivers")
    .select("*")
    .eq("posture", query.posture)
    .eq("scope", query.scope)
    .eq("org_id", query.org_id)
    .order("granted_at", { ascending: false })
    .limit(1);

  if (query.match_id) q = q.eq("match_id", query.match_id);
  else if (query.poi_id) q = q.eq("poi_id", query.poi_id);
  else if (query.wad_id) q = q.eq("wad_id", query.wad_id);
  else if (query.scope_id) q = q.eq("scope_id", query.scope_id);
  else {
    return { allowed: false, reason_code: "waiver_missing" };
  }

  const { data, error } = await q.maybeSingle();
  if (error) throw new Error(`WAIVER_LOOKUP_FAILED: ${error.message}`);
  if (!data) return { allowed: false, reason_code: "waiver_missing" };

  const row = data as GovernanceWaiverRow;

  if (row.status === "revoked") return { allowed: false, waiver: row, reason_code: "waiver_revoked" };
  if (row.status === "consumed") return { allowed: false, waiver: row, reason_code: "waiver_consumed" };
  if (row.status === "expired") return { allowed: false, waiver: row, reason_code: "waiver_expired" };

  const now = Date.now();
  if (Date.parse(row.expires_at) <= now) {
    await markExpired(admin, row).catch((e) =>
      console.error("[governance-waivers] lazy expire failed:", e),
    );
    return { allowed: false, waiver: { ...row, status: "expired" }, reason_code: "waiver_expired" };
  }
  if (row.uses >= row.max_uses) {
    // Defensive: status should have flipped on consume, but cover the
    // case of a stale row where consume never ran.
    return { allowed: false, waiver: row, reason_code: "waiver_consumed" };
  }
  return { allowed: true, waiver: row };
}

/**
 * Increment uses and flip status to consumed when uses >= max_uses. Emits
 * `governance.{posture}_consumed`. Fail-closed.
 *
 * Callers MUST call this AFTER the gated step succeeds, not before.
 */
export async function consumeGovernanceWaiver(
  admin: Admin,
  args: { waiver_id: string; consumer_user_id: string | null; request_id?: string | null },
): Promise<GovernanceWaiverRow> {
  // Read for update via two-step (Postgres RLS bypassed by service_role).
  const { data: cur, error: rErr } = await admin
    .from("governance_waivers")
    .select("*")
    .eq("waiver_id", args.waiver_id)
    .maybeSingle();
  if (rErr || !cur) throw new Error(`WAIVER_CONSUME_NOT_FOUND: ${args.waiver_id}`);
  const row = cur as GovernanceWaiverRow;
  if (row.status !== "active") {
    throw new Error(`WAIVER_CONSUME_INACTIVE: status=${row.status}`);
  }
  const newUses = row.uses + 1;
  const newStatus: WaiverStatus = newUses >= row.max_uses ? "consumed" : "active";

  const { data: upd, error: uErr } = await admin
    .from("governance_waivers")
    .update({ uses: newUses, status: newStatus })
    .eq("waiver_id", row.waiver_id)
    .eq("status", "active")            // optimistic guard
    .select("*")
    .single();
  if (uErr || !upd) throw new Error(`WAIVER_CONSUME_UPDATE_FAILED: ${uErr?.message ?? "race"}`);
  const after = upd as GovernanceWaiverRow;

  const { aggregate_type, aggregate_id } = deriveAggregate({
    match_id: after.match_id,
    poi_id: after.poi_id,
    wad_id: after.wad_id,
    scope: after.scope,
    scope_id: after.scope_id,
  });

  await writeCriticalEventWithPosture(admin, {
    event_type: eventName(after.posture, "consumed"),
    org_id: after.org_id,
    aggregate_type,
    aggregate_id,
    actor_user_id: args.consumer_user_id,
    system_actor: args.consumer_user_id ? undefined : "governance-waivers",
    actor_role: args.consumer_user_id ? null : "system",
    source_function: "governance-waivers",
    request_id: args.request_id ?? null,
    match_id: after.match_id,
    poi_id: after.poi_id,
    wad_id: after.wad_id,
    allowed_or_blocked: "allowed",
    reason_code: after.status === "consumed" ? "waiver_consumed" : after.reason_code,
    posture: buildPostureSnapshot(postureLabel(after.posture), {
      policy_version: GOVERNANCE_WAIVER_POLICY_VERSION,
      waiver_applied: after.posture === "waiver",
      bypass_applied: after.posture === "bypass",
    }),
    metadata: {
      waiver_id: after.waiver_id,
      scope: after.scope,
      uses: after.uses,
      max_uses: after.max_uses,
      status: after.status,
      expires_at: after.expires_at,
    },
    idempotency_extra: `${after.waiver_id}|consume|${newUses}`,
  });

  return after;
}

async function markExpired(admin: Admin, row: GovernanceWaiverRow): Promise<void> {
  await admin
    .from("governance_waivers")
    .update({ status: "expired" })
    .eq("waiver_id", row.waiver_id)
    .eq("status", "active");
  const { aggregate_type, aggregate_id } = deriveAggregate({
    match_id: row.match_id,
    poi_id: row.poi_id,
    wad_id: row.wad_id,
    scope: row.scope,
    scope_id: row.scope_id,
  });
  await writeCriticalEventWithPosture(admin, {
    event_type: eventName(row.posture, "expired"),
    org_id: row.org_id,
    aggregate_type,
    aggregate_id,
    system_actor: "governance-waivers",
    actor_role: "system",
    source_function: "governance-waivers",
    match_id: row.match_id,
    poi_id: row.poi_id,
    wad_id: row.wad_id,
    allowed_or_blocked: "blocked",
    reason_code: "waiver_expired",
    posture: buildPostureSnapshot(postureLabel(row.posture), {
      policy_version: GOVERNANCE_WAIVER_POLICY_VERSION,
      waiver_applied: row.posture === "waiver",
      bypass_applied: row.posture === "bypass",
    }),
    metadata: {
      waiver_id: row.waiver_id,
      scope: row.scope,
      expires_at: row.expires_at,
      uses: row.uses,
      max_uses: row.max_uses,
    },
    idempotency_extra: `${row.waiver_id}|expired`,
  });
}

/**
 * Sweeper for the lifecycle-scheduler: flip all past-expiry active rows to
 * `expired` and emit `governance.{posture}_expired` for each. Idempotent.
 */
export async function expireGovernanceWaivers(admin: Admin): Promise<{ expired: number }> {
  const { data, error } = await admin
    .from("governance_waivers")
    .select("*")
    .eq("status", "active")
    .lte("expires_at", new Date().toISOString());
  if (error) throw new Error(`WAIVER_EXPIRE_LOOKUP_FAILED: ${error.message}`);
  const rows = (data ?? []) as GovernanceWaiverRow[];
  let expired = 0;
  for (const r of rows) {
    try {
      await markExpired(admin, r);
      expired += 1;
    } catch (e) {
      console.error("[expireGovernanceWaivers] failed for", r.waiver_id, e);
    }
  }
  return { expired };
}
