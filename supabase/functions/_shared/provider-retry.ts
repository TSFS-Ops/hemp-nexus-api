/**
 * Batch I Fix 6 — Provider retry cooldown helpers.
 *
 * Prevents unlimited resubmit spam against IDV / sanctions providers when the
 * upstream is down. Each failure bumps a counter via `bump_provider_retry`;
 * once a per-(entity,provider,gate) threshold is reached, a cooldown_until
 * timestamp is set and `assertNotInCooldown` returns a typed
 * `PROVIDER_RETRY_COOLDOWN` error until it expires.
 *
 * Callsites:
 *   - idv-verify (gate="idv")
 *   - dilisense-screen (gate="sanctions")
 */

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

export interface ProviderRetryScope {
  gate: "idv" | "sanctions";
  provider: string;
  entityId: string | null;
  orgId: string | null;
}

export function buildScopeKey(s: ProviderRetryScope): string {
  return `${s.gate}:${s.provider}:${s.entityId ?? "noentity"}:${s.orgId ?? "noorg"}`;
}

export interface CooldownDecision {
  inCooldown: boolean;
  cooldownUntil: string | null;
  failureCount: number;
  scopeKey: string;
}

/**
 * Returns the current cooldown status WITHOUT mutating state.
 * Callers should short-circuit with a typed 429 when `inCooldown` is true.
 */
export async function checkProviderCooldown(
  client: SupabaseClient,
  scope: ProviderRetryScope,
): Promise<CooldownDecision> {
  const scopeKey = buildScopeKey(scope);
  const { data } = await client
    .from("provider_retry_state")
    .select("cooldown_until, failure_count")
    .eq("scope_key", scopeKey)
    .maybeSingle();

  const cooldownUntil = (data?.cooldown_until as string | null) ?? null;
  const inCooldown =
    !!cooldownUntil && new Date(cooldownUntil).getTime() > Date.now();
  return {
    inCooldown,
    cooldownUntil,
    failureCount: (data?.failure_count as number | null) ?? 0,
    scopeKey,
  };
}

/**
 * Records a provider failure. After `threshold` consecutive failures a
 * `cooldownSeconds` cooldown is set on the (entity, provider, gate) tuple.
 *
 * Defaults: threshold=3, cooldown=24h.
 */
export async function recordProviderFailure(
  client: SupabaseClient,
  scope: ProviderRetryScope,
  opts: { threshold?: number; cooldownSeconds?: number } = {},
): Promise<CooldownDecision> {
  const scopeKey = buildScopeKey(scope);
  const threshold = opts.threshold ?? 3;
  const cooldownSeconds = opts.cooldownSeconds ?? 24 * 60 * 60;

  const { data } = await client.rpc("bump_provider_retry", {
    _scope_key: scopeKey,
    _gate: scope.gate,
    _provider: scope.provider,
    _entity_id: scope.entityId,
    _org_id: scope.orgId,
    _threshold: threshold,
    _cooldown_seconds: cooldownSeconds,
  });

  const row = (Array.isArray(data) ? data[0] : data) as
    | { cooldown_until: string | null; failure_count: number }
    | null;

  const cooldownUntil = row?.cooldown_until ?? null;
  return {
    inCooldown: !!cooldownUntil && new Date(cooldownUntil).getTime() > Date.now(),
    cooldownUntil,
    failureCount: row?.failure_count ?? 0,
    scopeKey,
  };
}

/**
 * Audit row + envelope to return to the client when a cooldown bites.
 */
export function cooldownResponseEnvelope(d: CooldownDecision, requestId: string) {
  return {
    success: false,
    error: "PROVIDER_RETRY_COOLDOWN",
    code: "PROVIDER_RETRY_COOLDOWN",
    message:
      "This provider has returned repeated errors for this entity. Retries are temporarily disabled. An admin can review the failure and retry once the cooldown expires.",
    cooldown_until: d.cooldownUntil,
    failure_count: d.failureCount,
    scope_key: d.scopeKey,
    requestId,
  };
}
