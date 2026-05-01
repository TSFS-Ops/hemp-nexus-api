/**
 * Test-mode bypass + maintenance-mode helpers.
 *
 * While external compliance providers (IDV, sanctions/PEP, KYB, UBO, authority-to-bind)
 * are still being integrated, platform admins can flip per-gate flags in
 * `admin_settings.test_mode_bypass` so the rest of the platform stays testable.
 *
 * This file also exposes a thin `enforceMaintenanceMode` middleware so callers
 * can short-circuit requests when maintenance mode is active, with structured
 * decision logs in either case.
 *
 * Every bypass MUST:
 *   1. Be explicitly enabled by an admin (master switch + per-gate flag).
 *   2. Write a `test_mode.bypass_used` row to `admin_audit_logs` so the
 *      bypass is fully visible in audit history.
 *   3. Tag any returned payload with `bypass: true` so downstream
 *      evidence packs can render a "TEST MODE" annotation.
 *
 * NEVER use this in production once real providers are wired in — gate
 * the master switch off and let normal validation run.
 */

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

export type BypassGate =
  | "idv"
  | "sanctions"
  | "kyb"
  | "ubo"
  | "authority"
  // ── WaD-internal gates (added to let test mode reach the evidence pack) ──
  | "risk_scoring"          // bypass dd_risk_scores high/critical block in WaD
  | "webhook_connectivity"  // bypass WaD Gate 10 (broken primary webhooks)
  | "screening_recentness"; // bypass the 30-day staleness check on screening_results

/**
 * Production lockout (RBAC Stage 3G).
 *
 * Test-mode bypass is a SANDBOX/TEST tool only. It must NEVER fire in
 * production. Two layers enforce this:
 *
 *   1. Edge layer  — `isProductionTier()` reads ENVIRONMENT_TIER from the
 *                    edge runtime. If "production" / "live" / "prod", every
 *                    bypass call short-circuits with `decision: "real"` and
 *                    a `production_tier_lockout` reason, AND writes a
 *                    `test_mode.production_lockout_denied` audit row.
 *   2. DB layer    — `is_test_mode_bypass_enabled(_gate)` checks
 *                    `is_production_environment()` (admin_settings.environment.tier)
 *                    and returns false in production no matter what flags say.
 *
 * Production override is NOT test-mode bypass. It must use the future
 * break-glass / second-approval workflow (see Stage 3 plan).
 *
 * Exported so call-sites and tests can detect the lockout uniformly.
 */
export function isProductionTier(): boolean {
  const tier = (Deno.env.get("ENVIRONMENT_TIER") ?? "").toLowerCase();
  return tier === "production" || tier === "live" || tier === "prod";
}

/** Stable error reason returned to callers when production lockout fires. */
export const PRODUCTION_LOCKOUT_REASON =
  "test_mode_bypass_locked_in_production: use the break-glass / second-approval workflow instead";

export interface BypassAuditContext {
  gate: BypassGate;
  /** Function name (e.g. "idv-verify") for audit traceability. */
  source: string;
  /** Org context for the audit row, if known. */
  orgId?: string | null;
  /** Acting user (null if invoked by API key / service role). */
  actorUserId?: string | null;
  /** Free-form metadata describing what was bypassed. */
  details?: Record<string, unknown>;
  /** Optional request id so logs and audit rows can be correlated. */
  requestId?: string;
}

interface DecisionLogFields {
  source: string;
  gate?: BypassGate | "maintenance";
  decision: "bypass" | "real" | "block" | "allow" | "error";
  requestId?: string;
  orgId?: string | null;
  actorUserId?: string | null;
  reason?: string;
  details?: Record<string, unknown>;
}

/**
 * Single structured logger so every middleware/test-mode call lands in the
 * edge function logs in a greppable, parseable shape.
 *
 * Example log line:
 *   [decision] {"tag":"test-mode","source":"idv-verify","gate":"idv","decision":"bypass","requestId":"..."}
 */
export function logDecision(tag: "test-mode" | "maintenance", fields: DecisionLogFields): void {
  try {
    console.log(
      `[decision] ${JSON.stringify({
        tag,
        ts: new Date().toISOString(),
        ...fields,
      })}`,
    );
  } catch {
    // Never let logging break the request.
    console.log(`[decision] ${tag} ${fields.source} ${fields.decision}`);
  }
}

/**
 * Returns true when the master switch AND the requested gate flag are both on.
 * Uses the SECURITY DEFINER RPC so it works under any role (service / anon / authed).
 *
 * Always emits a structured decision log so we can see WHY a bypass did or
 * didn't fire when debugging client tickets.
 */
export async function isBypassEnabled(
  client: SupabaseClient,
  gate: BypassGate,
  source = "unknown",
  requestId?: string,
): Promise<boolean> {
  // Production lockout — refuse bypasses on the live tier no matter what the DB says.
  if (isProductionTier()) {
    logDecision("test-mode", {
      source,
      gate,
      decision: "real",
      requestId,
      reason: "production_tier_lockout",
      details: { hint: PRODUCTION_LOCKOUT_REASON },
    });
    // Best-effort audit write — never block the request if the audit fails.
    try {
      await client.from("admin_audit_logs").insert({
        action: "test_mode.production_lockout_denied",
        target_type: "compliance_gate",
        details: {
          gate,
          source,
          request_id: requestId ?? null,
          reason: PRODUCTION_LOCKOUT_REASON,
        },
      });
    } catch (_err) {
      // Audit failure must not break callers; the decision log above is the source of truth.
    }
    return false;
  }

  try {
    // Expiry check — read the JSON directly so the helper can self-disable
    // bypasses past expires_at without requiring a cron job.
    const { data: settingsRow } = await client
      .from("admin_settings")
      .select("value")
      .eq("key", "test_mode_bypass")
      .maybeSingle();
    const settings = (settingsRow?.value ?? {}) as Record<string, unknown>;
    const expiresAt = typeof settings.expires_at === "string" ? settings.expires_at : null;
    if (expiresAt) {
      const expiry = new Date(expiresAt).getTime();
      if (Number.isFinite(expiry) && Date.now() > expiry) {
        logDecision("test-mode", {
          source,
          gate,
          decision: "real",
          requestId,
          reason: "expired",
          details: { expires_at: expiresAt },
        });
        return false;
      }
    }

    const { data, error } = await client.rpc("is_test_mode_bypass_enabled", { _gate: gate });
    if (error) {
      logDecision("test-mode", {
        source,
        gate,
        decision: "error",
        requestId,
        reason: `rpc_failed: ${error.message}`,
      });
      return false;
    }
    const enabled = data === true;
    logDecision("test-mode", {
      source,
      gate,
      decision: enabled ? "bypass" : "real",
      requestId,
      reason: enabled ? "flag_on" : "flag_off",
    });
    return enabled;
  } catch (err) {
    logDecision("test-mode", {
      source,
      gate,
      decision: "error",
      requestId,
      reason: `unexpected: ${err instanceof Error ? err.message : String(err)}`,
    });
    return false;
  }
}

/**
 * One-shot helper for "check + audit + return decision" used by call-sites
 * that just need to know "may I skip this hard-gate?". Returns true when the
 * bypass actually fired (and an audit row was written), false otherwise.
 *
 * Designed for hard-gates inside the WaD function and similar — you call this
 * inside the failure branch and short-circuit your own throw if it returns true.
 */
export async function tryBypass(
  client: SupabaseClient,
  ctx: BypassAuditContext,
): Promise<boolean> {
  const enabled = await isBypassEnabled(client, ctx.gate, ctx.source, ctx.requestId);
  if (!enabled) return false;
  await recordBypassUsage(client, ctx);
  return true;
}

/**
 * Writes a high-visibility audit row whenever a bypass is actually used.
 * Failure to write the audit must NOT block the request — we log and continue.
 */
export async function recordBypassUsage(
  client: SupabaseClient,
  ctx: BypassAuditContext,
): Promise<void> {
  try {
    const { error } = await client.from("admin_audit_logs").insert({
      action: "test_mode.bypass_used",
      target_type: "compliance_gate",
      target_id: ctx.orgId ?? null,
      admin_user_id: ctx.actorUserId ?? null,
      details: {
        gate: ctx.gate,
        source: ctx.source,
        org_id: ctx.orgId ?? null,
        request_id: ctx.requestId ?? null,
        ...ctx.details,
      },
    });
    if (error) {
      logDecision("test-mode", {
        source: ctx.source,
        gate: ctx.gate,
        decision: "error",
        requestId: ctx.requestId,
        orgId: ctx.orgId,
        actorUserId: ctx.actorUserId,
        reason: `audit_insert_failed: ${error.message}`,
      });
    } else {
      logDecision("test-mode", {
        source: ctx.source,
        gate: ctx.gate,
        decision: "bypass",
        requestId: ctx.requestId,
        orgId: ctx.orgId,
        actorUserId: ctx.actorUserId,
        reason: "audit_recorded",
        details: ctx.details,
      });
    }
  } catch (err) {
    logDecision("test-mode", {
      source: ctx.source,
      gate: ctx.gate,
      decision: "error",
      requestId: ctx.requestId,
      reason: `audit_exception: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}

/**
 * Convenience: returns a bypass result envelope for callers that want a
 * uniform shape across gates. Extend per-gate as needed.
 */
export function bypassEnvelope<T extends Record<string, unknown>>(
  payload: T,
): T & { bypass: true; bypass_reason: string } {
  return {
    ...payload,
    bypass: true,
    bypass_reason:
      "Test-mode bypass active — external integration not yet enabled. Result is for platform testing only.",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Settlement guard for test-mode WaDs
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Inspects a WaD's evidence_bundle to determine whether it was issued under any
 * test-mode bypass. The bypass record lives inside `evidence_bundle.test_mode`
 * and — because evidence_bundle is hashed into the seal — is cryptographically
 * bound to the WaD and impossible to retroactively scrub.
 *
 * Returns null if the WaD is clean (i.e. all gates passed under real conditions).
 * Returns the bypass list if the WaD is demo-grade and must NOT be progressed
 * to settlement-grade actions (final commercial certificate, director sign-off).
 */
export function inspectWadTestMode(wad: { evidence_bundle?: unknown } | null | undefined): {
  isTestMode: boolean;
  bypassedGates: Array<{ gate: string; org_id?: string | null; detail?: Record<string, unknown> }>;
  bypassedAt: string | null;
} {
  const bundle = (wad?.evidence_bundle ?? {}) as Record<string, unknown>;
  const tm = (bundle.test_mode ?? {}) as Record<string, unknown>;
  const isTestMode = tm.issued_under_test_mode === true;
  const bypassedGates = Array.isArray(tm.bypassed_gates)
    ? (tm.bypassed_gates as Array<{ gate: string; org_id?: string | null; detail?: Record<string, unknown> }>)
    : [];
  const bypassedAt = typeof tm.bypassed_at === "string" ? tm.bypassed_at : null;
  return { isTestMode, bypassedGates, bypassedAt };
}

export interface WadSettlementGuardOptions {
  /** Calling function name (audit + log traceability). */
  source: string;
  /** Acting user, if known. */
  actorUserId?: string | null;
  /** Org context, if known. */
  orgId?: string | null;
  /** Request id for log/audit correlation. */
  requestId?: string;
  /** Action verb being attempted ("director_attestation", "deal_certificate"). */
  action: string;
}

export interface WadSettlementDecision {
  blocked: boolean;
  reason: string;
  isTestMode: boolean;
  bypassedGates: Array<{ gate: string }>;
}

/**
 * Refuses settlement-grade actions on test-mode WaDs.
 *
 * Workflow steps that are still ALLOWED under test mode (so the client gets the
 * full visual walkthrough): WaD creation, party attestations, sealing, evidence
 * pack assembly, certificate-PDF download (the PDF carries the TEST MODE banner).
 *
 * Workflow steps that are BLOCKED under test mode (the irrevocable commercial
 * acts that confer real legal weight): director sign-off attestations and the
 * final deal certificate.
 *
 * The block is recorded in `admin_audit_logs` with action `test_mode.settlement_blocked`
 * and the recommended remediation: revoke the test WaD, disable test mode, re-issue.
 */
export async function assertWadIsSettleable(
  client: SupabaseClient,
  wad: { id?: string; evidence_bundle?: unknown } | null | undefined,
  opts: WadSettlementGuardOptions,
): Promise<WadSettlementDecision> {
  const { isTestMode, bypassedGates } = inspectWadTestMode(wad);

  if (!isTestMode) {
    logDecision("test-mode", {
      source: opts.source,
      decision: "allow",
      requestId: opts.requestId,
      orgId: opts.orgId,
      actorUserId: opts.actorUserId,
      reason: "wad_clean",
      details: { action: opts.action, wad_id: wad?.id ?? null },
    });
    return { blocked: false, reason: "wad_clean", isTestMode: false, bypassedGates: [] };
  }

  // BLOCK. Loud structured log + audit row.
  const gateNames = bypassedGates.map((b) => b.gate);
  logDecision("test-mode", {
    source: opts.source,
    decision: "block",
    requestId: opts.requestId,
    orgId: opts.orgId,
    actorUserId: opts.actorUserId,
    reason: "test_mode_wad_not_settleable",
    details: { action: opts.action, wad_id: wad?.id ?? null, bypassed_gates: gateNames },
  });

  try {
    await client.from("admin_audit_logs").insert({
      action: "test_mode.settlement_blocked",
      target_type: "wad",
      target_id: wad?.id ?? null,
      admin_user_id: opts.actorUserId ?? null,
      details: {
        source: opts.source,
        action: opts.action,
        org_id: opts.orgId ?? null,
        request_id: opts.requestId ?? null,
        bypassed_gates: gateNames,
        remediation: "Revoke this WaD, disable the relevant test-mode flags, then re-issue under live conditions.",
      },
    });
  } catch (err) {
    console.error("[settlement-guard] audit insert failed:", err);
  }

  return {
    blocked: true,
    reason: "test_mode_wad_not_settleable",
    isTestMode: true,
    bypassedGates: bypassedGates.map((b) => ({ gate: b.gate })),
  };
}

/** Build a service-role client from env (helper used by edge functions). */
export function createServiceClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, key);
}

// ─────────────────────────────────────────────────────────────────────────────
// Maintenance-mode middleware
// ─────────────────────────────────────────────────────────────────────────────

export interface MaintenanceCheckOptions {
  /** Function name doing the check (used in logs + audit). */
  source: string;
  /** Optional request id so logs and audit rows can be correlated. */
  requestId?: string;
  /** Acting user id, if known. */
  actorUserId?: string | null;
  /** Org id, if known. */
  orgId?: string | null;
  /**
   * Action verb being attempted (e.g. "send_outreach_email", "download_waiver").
   * Surfaced in the log + block reason so support can answer "why was I
   * blocked?" without spelunking source.
   */
  action?: string;
  /**
   * If true, platform admins are exempt from the maintenance block (default true).
   * The check uses the `has_role(_user_id, 'platform_admin')` SECURITY DEFINER RPC.
   */
  allowPlatformAdmins?: boolean;
}

export interface MaintenanceDecision {
  /** True ⇒ caller should respond with 503. */
  blocked: boolean;
  reason: string;
  isMaintenanceModeOn: boolean;
  isAdminExempt: boolean;
}

/**
 * Reads the saved `general.maintenanceMode` flag from `admin_settings`,
 * decides whether the current request must be blocked, and emits a
 * structured decision log either way.
 *
 * NOTE: This is intentionally a soft helper — callers that opt in must check
 * `decision.blocked` and return a 503 themselves. We don't want every edge
 * function to silently inherit blocking behaviour.
 */
export async function checkMaintenanceMode(
  client: SupabaseClient,
  opts: MaintenanceCheckOptions,
): Promise<MaintenanceDecision> {
  const allowPlatformAdmins = opts.allowPlatformAdmins ?? true;
  let isMaintenanceModeOn = false;
  let isAdminExempt = false;

  try {
    const { data, error } = await client
      .from("admin_settings")
      .select("value")
      .eq("key", "general")
      .maybeSingle();

    if (error) {
      logDecision("maintenance", {
        source: opts.source,
        gate: "maintenance",
        decision: "error",
        requestId: opts.requestId,
        orgId: opts.orgId,
        actorUserId: opts.actorUserId,
        reason: `settings_read_failed: ${error.message}`,
        details: { action: opts.action },
      });
      // Fail OPEN — never break the platform because settings can't be read.
      return { blocked: false, reason: "settings_read_failed", isMaintenanceModeOn: false, isAdminExempt: false };
    }

    const value = (data?.value ?? {}) as Record<string, unknown>;
    isMaintenanceModeOn = value.maintenanceMode === true;

    if (!isMaintenanceModeOn) {
      logDecision("maintenance", {
        source: opts.source,
        gate: "maintenance",
        decision: "allow",
        requestId: opts.requestId,
        orgId: opts.orgId,
        actorUserId: opts.actorUserId,
        reason: "maintenance_off",
        details: { action: opts.action },
      });
      return { blocked: false, reason: "maintenance_off", isMaintenanceModeOn, isAdminExempt };
    }

    if (allowPlatformAdmins && opts.actorUserId) {
      const { data: hasRole, error: roleErr } = await client.rpc("has_role", {
        _user_id: opts.actorUserId,
        _role: "platform_admin",
      });
      if (!roleErr && hasRole === true) {
        isAdminExempt = true;
        logDecision("maintenance", {
          source: opts.source,
          gate: "maintenance",
          decision: "allow",
          requestId: opts.requestId,
          orgId: opts.orgId,
          actorUserId: opts.actorUserId,
          reason: "admin_exempt",
          details: { action: opts.action },
        });
        return { blocked: false, reason: "admin_exempt", isMaintenanceModeOn, isAdminExempt };
      }
    }

    // Block. Write a loud audit row + structured log.
    logDecision("maintenance", {
      source: opts.source,
      gate: "maintenance",
      decision: "block",
      requestId: opts.requestId,
      orgId: opts.orgId,
      actorUserId: opts.actorUserId,
      reason: "maintenance_on",
      details: { action: opts.action },
    });

    try {
      await client.from("admin_audit_logs").insert({
        action: "maintenance_mode.request_blocked",
        target_type: "edge_function",
        target_id: opts.orgId ?? null,
        admin_user_id: opts.actorUserId ?? null,
        details: {
          source: opts.source,
          action: opts.action ?? null,
          request_id: opts.requestId ?? null,
        },
      });
    } catch (err) {
      console.error("[maintenance] audit insert failed:", err);
    }

    return {
      blocked: true,
      reason: "maintenance_on",
      isMaintenanceModeOn,
      isAdminExempt,
    };
  } catch (err) {
    logDecision("maintenance", {
      source: opts.source,
      gate: "maintenance",
      decision: "error",
      requestId: opts.requestId,
      orgId: opts.orgId,
      actorUserId: opts.actorUserId,
      reason: `unexpected: ${err instanceof Error ? err.message : String(err)}`,
      details: { action: opts.action },
    });
    return { blocked: false, reason: "exception", isMaintenanceModeOn, isAdminExempt };
  }
}
