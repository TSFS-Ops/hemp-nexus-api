/**
 * Public API V1 · Batch 6 — Usage limits, monthly allowance controls and
 * threshold notifications.
 *
 * Centralises:
 *   • Default limits (per-minute, concurrency, monthly production / sandbox).
 *   • Monthly usage derivation from api_request_logs (single source of truth).
 *   • Active temporary override resolution (api_usage_overrides).
 *   • 80% / 100% / 120% threshold detection + idempotent notification dispatch.
 *   • Lightweight, best-effort concurrency guard via api_active_requests.
 *
 * Hard exclusions kept: no commercial pricing plans, no invoices, no payment
 * rails, no /v1/usage endpoint, no client/internal monitoring dashboards, no
 * docs/OpenAPI, no support intake, no webhook changes, no write API, no
 * evidence/document exposure, no POI/WaD/payment/credit/compliance/
 * verification decisions. Notifications never include raw API keys/secrets.
 */

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import type { V1RequestCtx } from "./public-api-v1.ts";

// ─── Defaults ─────────────────────────────────────────────────────────────
export const V1_DEFAULT_RPM = 60;                  // confirmed: reuses Batch-3 gateway 60 rpm
export const V1_DEFAULT_CONCURRENCY = 3;           // per API key
export const V1_DEFAULT_MONTHLY_PROD = 5_000;      // per api_client / month
export const V1_DEFAULT_MONTHLY_SANDBOX = 10_000;  // per api_client / month

// Endpoints that COUNT toward the monthly allowance. Health/status/docs-type
// calls deliberately omitted — they never consume the monthly allowance.
export const V1_COUNTABLE_ENDPOINTS = new Set<string>([
  "/v1/counterparty/lookup",
  "/v1/counterparty/summary",
]);

export function isCountableEndpoint(endpointPath: string): boolean {
  return V1_COUNTABLE_ENDPOINTS.has(endpointPath);
}

export function defaultMonthlyLimit(env: "sandbox" | "production"): number {
  return env === "production" ? V1_DEFAULT_MONTHLY_PROD : V1_DEFAULT_MONTHLY_SANDBOX;
}

// First day of the current UTC month — used both for usage windows and the
// threshold-dedupe key. UTC keeps the window stable across regions.
export function currentPeriodStart(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

// ─── Override resolution ──────────────────────────────────────────────────
export interface ActiveOverride {
  id: string;
  override_limit: number;
  expires_at: string;
  approved_by: string;
}

export async function getActiveOverride(
  supabase: SupabaseClient,
  apiClientId: string,
  env: "sandbox" | "production",
): Promise<ActiveOverride | null> {
  const { data, error } = await supabase
    .from("api_usage_overrides")
    .select("id, override_limit, expires_at, approved_by")
    .eq("api_client_id", apiClientId)
    .eq("environment", env)
    .eq("active", true)
    .gt("expires_at", new Date().toISOString())
    .order("expires_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return (data as ActiveOverride | null) ?? null;
}

// ─── Monthly usage derivation ─────────────────────────────────────────────
// SINGLE SOURCE OF TRUTH = api_request_logs. We never maintain a separate
// usage counter (the threshold-dedupe table is NOT a billing ledger).
//
// Rules (Batch 6 §"Production monthly allowance rule"):
//   • Only successful rows (error_code IS NULL) count.
//   • Only countable endpoints count (lookup + summary). Health/status excluded.
//   • Auth failures, validation failures, suspended/revoked/expired key
//     attempts, and internal errors all carry error_code != NULL → excluded.
//   • Sandbox requests count toward the sandbox allowance only.
//   • Production requests count toward the production allowance only.
//   • Usage is scoped to the api_client (via its api_keys); never mixes clients.
export async function getMonthlyUsage(
  supabase: SupabaseClient,
  apiClientId: string,
  env: "sandbox" | "production",
): Promise<number> {
  const periodStart = currentPeriodStart().toISOString();

  // Resolve all api_keys owned by this api_client.
  const { data: keys } = await supabase
    .from("api_keys")
    .select("id")
    .eq("api_client_id", apiClientId);
  const keyIds = (keys ?? []).map((k: { id: string }) => k.id);
  if (keyIds.length === 0) return 0;

  const { count } = await supabase
    .from("api_request_logs")
    .select("id", { count: "exact", head: true })
    .in("api_key_id", keyIds)
    .eq("environment", env)
    .is("error_code", null)
    .in("endpoint", Array.from(V1_COUNTABLE_ENDPOINTS))
    .gte("created_at", periodStart);
  return count ?? 0;
}

// ─── Threshold logic ──────────────────────────────────────────────────────
export type Threshold = 80 | 100 | 120;
export const THRESHOLDS: Threshold[] = [80, 100, 120];

// Returns thresholds NEWLY crossed when usage moves prev → current.
export function thresholdsCrossed(prev: number, current: number, limit: number): Threshold[] {
  if (limit <= 0) return [];
  const crossed: Threshold[] = [];
  for (const t of THRESHOLDS) {
    const mark = Math.ceil((t / 100) * limit);
    if (prev < mark && current >= mark) crossed.push(t);
  }
  return crossed;
}

export interface MonthlyAllowanceState {
  current: number;
  limit: number;
  effectiveLimit: number;   // includes override if any
  override: ActiveOverride | null;
  blocked: boolean;         // true when current >= 120% effective limit AND no override
}

export async function evaluateMonthlyAllowance(
  supabase: SupabaseClient,
  apiClientId: string,
  env: "sandbox" | "production",
): Promise<MonthlyAllowanceState> {
  const [current, override] = await Promise.all([
    getMonthlyUsage(supabase, apiClientId, env),
    getActiveOverride(supabase, apiClientId, env),
  ]);
  const baseLimit = defaultMonthlyLimit(env);
  const effectiveLimit = override?.override_limit ?? baseLimit;
  const blockMark = Math.ceil((120 / 100) * baseLimit);
  // Override raises the ceiling: when override is active, the 120% block is
  // measured against the override_limit instead.
  const effectiveBlockMark = override
    ? override.override_limit
    : blockMark;
  const blocked = current >= effectiveBlockMark;
  return { current, limit: baseLimit, effectiveLimit, override, blocked };
}

// ─── Idempotent threshold notification dispatch ───────────────────────────
// Writes one notification + audit per (client, env, period, threshold).
// The unique index on api_usage_notifications_state guarantees no duplicates
// even under concurrent requests.
export async function recordThresholdOnce(
  supabase: SupabaseClient,
  ctx: V1RequestCtx,
  apiClientId: string,
  env: "sandbox" | "production",
  threshold: Threshold,
  state: MonthlyAllowanceState,
): Promise<void> {
  const period = currentPeriodStart().toISOString().slice(0, 10);
  const { data: inserted, error: insErr } = await supabase
    .from("api_usage_notifications_state")
    .insert({
      api_client_id: apiClientId,
      environment: env,
      period_start: period,
      threshold,
    })
    .select("id")
    .maybeSingle();
  if (insErr || !inserted) return; // already notified (unique violation) — idempotent skip

  // Fetch client identity for the notification payload. No raw keys.
  const { data: client } = await supabase
    .from("api_clients")
    .select("id, org_id, legal_entity_name, authorised_commercial_contact_email, billing_contact_email")
    .eq("id", apiClientId)
    .maybeSingle();
  const clientName = client?.legal_entity_name ?? "API client";

  const title = `API usage at ${threshold}% — ${clientName} (${env})`;
  const body =
    `${clientName} has reached ${threshold}% of its monthly ${env} allowance ` +
    `(${state.current}/${state.effectiveLimit}). Endpoint category: counterparty.\n` +
    (threshold === 120
      ? "Production lookup/summary requests are now blocked unless an override is approved."
      : threshold === 100
        ? "Monthly allowance reached. Block at 120% unless an override is approved."
        : "Approaching monthly allowance.");

  // In-app notification to the api_client's org (best-effort).
  if (client?.org_id) {
    try {
      // Find an org member to notify (first admin we can find for that org).
      const { data: targets } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", "org_admin")
        .limit(5);
      const orgMembers = (targets ?? []) as Array<{ user_id: string }>;
      for (const t of orgMembers) {
        await supabase.from("notifications").insert({
          user_id: t.user_id,
          org_id: client.org_id,
          type: "api_usage_threshold",
          title,
          body,
          entity_type: "api_client",
          entity_id: apiClientId,
        });
      }
    } catch (_e) { /* notifications are best-effort */ }
  }

  // Internal platform notification — notify all platform_admins.
  try {
    const { data: admins } = await supabase
      .from("user_roles")
      .select("user_id")
      .eq("role", "platform_admin");
    for (const a of (admins ?? []) as Array<{ user_id: string }>) {
      await supabase.from("notifications").insert({
        user_id: a.user_id,
        type: "api_usage_threshold_internal",
        title,
        body,
        entity_type: "api_client",
        entity_id: apiClientId,
      });
    }
  } catch (_e) { /* best-effort */ }

  // Canonical audit. Action names are Batch-6-scoped.
  await supabase.from("audit_logs").insert({
    action: `api_usage.threshold_${threshold}_reached`,
    entity_type: "api_client",
    entity_id: apiClientId,
    org_id: client?.org_id ?? ctx.orgId,
    metadata: {
      environment: env,
      current: state.current,
      limit: state.limit,
      effective_limit: state.effectiveLimit,
      override_id: state.override?.id ?? null,
      request_id: ctx.requestId,
      endpoint: ctx.endpointTag,
      // NEVER include raw key / secret / other-client usage.
    },
  }).then(() => {}, () => {});
}

export async function auditMonthlyBlock(
  supabase: SupabaseClient,
  ctx: V1RequestCtx,
  apiClientId: string,
  env: "sandbox" | "production",
  state: MonthlyAllowanceState,
): Promise<void> {
  await supabase.from("audit_logs").insert({
    action: "api_usage.monthly_limit_blocked",
    entity_type: "api_client",
    entity_id: apiClientId,
    org_id: ctx.orgId,
    metadata: {
      environment: env,
      current: state.current,
      limit: state.limit,
      effective_limit: state.effectiveLimit,
      override_id: state.override?.id ?? null,
      request_id: ctx.requestId,
      endpoint: ctx.endpointTag,
    },
  }).then(() => {}, () => {});
}

// ─── Concurrency guard (best-effort, conservative) ────────────────────────
// Limitation: this is a database-backed counter with a 30s TTL, NOT a true
// distributed semaphore. Two requests arriving within the same millisecond
// can both read count < limit before either inserts. We accept that limited
// race window as the conservative trade-off documented in Batch 6 scope —
// the alternative (advisory locks per key) would impose unreliable cross-
// region behaviour. The TTL guarantees forward progress even if a request
// crashes before finishApiActiveRequest() runs.
export async function beginApiActiveRequest(
  supabase: SupabaseClient,
  apiKeyId: string,
  apiClientId: string | null,
  environment: string | null,
  requestId: string,
): Promise<{ ok: true } | { ok: false; active: number }> {
  // Opportunistic cleanup — keep table small.
  await supabase
    .from("api_active_requests")
    .delete()
    .lt("expires_at", new Date().toISOString())
    .then(() => {}, () => {});

  const { count } = await supabase
    .from("api_active_requests")
    .select("request_id", { count: "exact", head: true })
    .eq("api_key_id", apiKeyId)
    .gt("expires_at", new Date().toISOString());

  if ((count ?? 0) >= V1_DEFAULT_CONCURRENCY) {
    return { ok: false, active: count ?? 0 };
  }

  await supabase.from("api_active_requests").insert({
    request_id: requestId,
    api_key_id: apiKeyId,
    api_client_id: apiClientId,
    environment,
  }).then(() => {}, () => {});
  return { ok: true };
}

export async function finishApiActiveRequest(
  supabase: SupabaseClient,
  requestId: string,
): Promise<void> {
  await supabase
    .from("api_active_requests")
    .delete()
    .eq("request_id", requestId)
    .then(() => {}, () => {});
}
