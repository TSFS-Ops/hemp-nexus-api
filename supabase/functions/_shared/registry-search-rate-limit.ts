/**
 * Batch 7 hardening — per-IP and per-API-key rate limiting for public
 * and admin registry search endpoints. Prevents enumeration of
 * sensitive match signals.
 *
 * Backed by `public.registry_search_rate_limit_buckets` and the
 * SECURITY DEFINER RPC `atomic_check_registry_search_rate_limit`.
 *
 * Conservative defaults. Anonymous/IP callers are limited more
 * tightly than authenticated API-key callers. Admin callers get a
 * higher ceiling but are still capped to prevent abuse from a
 * compromised admin session.
 */
import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export type RegistrySearchScopeKind = "ip" | "api_key" | "admin_user";

export interface RegistrySearchLimits {
  perMinute: number;
  perHour: number;
}

export const REGISTRY_SEARCH_LIMITS: Record<RegistrySearchScopeKind, RegistrySearchLimits> = {
  ip:         { perMinute: 20,  perHour: 200  },
  api_key:    { perMinute: 60,  perHour: 1000 },
  admin_user: { perMinute: 120, perHour: 3000 },
};

export interface RegistrySearchRateLimitInput {
  supabase: SupabaseClient;
  endpoint: string;          // e.g. "registry-company-search"
  ip?: string | null;
  apiKeyId?: string | null;
  adminUserId?: string | null;
}

export interface RegistrySearchRateLimitDecision {
  ok: boolean;
  scopeKind: RegistrySearchScopeKind;
  scopeKey: string;
  retryAfterSeconds?: number;
  window?: "minute" | "hour";
  limit?: number;
}

/** Resolve the canonical scope key to charge for this request. */
function resolveScope(input: RegistrySearchRateLimitInput): { kind: RegistrySearchScopeKind; key: string } {
  if (input.adminUserId) return { kind: "admin_user", key: input.adminUserId };
  if (input.apiKeyId)    return { kind: "api_key",    key: input.apiKeyId };
  return { kind: "ip", key: (input.ip || "unknown").slice(0, 64) };
}

function windowEnd(minutes: number): Date {
  const now = Date.now();
  const ms = minutes * 60 * 1000;
  const start = now - (now % ms);
  return new Date(start + ms);
}

async function bump(
  supabase: SupabaseClient,
  scopeKind: RegistrySearchScopeKind,
  scopeKey: string,
  endpoint: string,
  windowMinutes: number,
  limit: number,
): Promise<number> {
  const end = windowEnd(windowMinutes);
  const { data, error } = await supabase.rpc("atomic_check_registry_search_rate_limit", {
    p_scope_kind: scopeKind,
    p_scope_key: scopeKey,
    p_endpoint: `${endpoint}:${windowMinutes}`,
    p_window_end: end.toISOString(),
    p_limit: limit,
  });
  if (error) {
    // Fail-open on infra errors to avoid blocking legitimate traffic.
    console.error("registry-search-rate-limit RPC error", error);
    return 0;
  }
  return (data as number) ?? 0;
}

export async function enforceRegistrySearchRateLimit(
  input: RegistrySearchRateLimitInput,
): Promise<RegistrySearchRateLimitDecision> {
  const { kind, key } = resolveScope(input);
  const limits = REGISTRY_SEARCH_LIMITS[kind];

  // Per-minute window
  const minuteCount = await bump(input.supabase, kind, key, input.endpoint, 1, limits.perMinute);
  if (minuteCount === -1) {
    return { ok: false, scopeKind: kind, scopeKey: key, retryAfterSeconds: 60, window: "minute", limit: limits.perMinute };
  }

  // Per-hour window
  const hourCount = await bump(input.supabase, kind, key, input.endpoint, 60, limits.perHour);
  if (hourCount === -1) {
    return { ok: false, scopeKind: kind, scopeKey: key, retryAfterSeconds: 3600, window: "hour", limit: limits.perHour };
  }

  return { ok: true, scopeKind: kind, scopeKey: key };
}

export function clientIpFromRequest(req: Request): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip");
}

export function rateLimited429(decision: RegistrySearchRateLimitDecision): Response {
  return new Response(
    JSON.stringify({
      error: "rate_limit_exceeded",
      window: decision.window,
      limit: decision.limit,
      retry_after_seconds: decision.retryAfterSeconds,
      scope_kind: decision.scopeKind,
    }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(decision.retryAfterSeconds ?? 60),
      },
    },
  );
}
