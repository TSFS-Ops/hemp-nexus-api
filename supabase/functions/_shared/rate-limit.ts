import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { ApiException } from "./errors.ts";
import { writeSecurityAudit } from "./security-audit.ts";

export interface RateLimitConfig {
  requestsPerMinute?: number;
  requestsPerHour?: number;
  requestsPerDay?: number;
}

// Default rate limits
const DEFAULT_LIMITS: RateLimitConfig = {
  requestsPerMinute: 60,
  requestsPerHour: 1000,
  requestsPerDay: 10000,
};

// Scope-specific rate limits
const SCOPE_LIMITS: Record<string, RateLimitConfig> = {
  "search": { requestsPerMinute: 10, requestsPerHour: 100, requestsPerDay: 500 },
  "signals:write": { requestsPerMinute: 30, requestsPerHour: 500, requestsPerDay: 5000 },
  "match": { requestsPerMinute: 20, requestsPerHour: 300, requestsPerDay: 3000 },
  "collapse": { requestsPerMinute: 10, requestsPerHour: 100, requestsPerDay: 1000 },
  "preflight": { requestsPerMinute: 30, requestsPerHour: 500, requestsPerDay: 5000 },
  "data-sources:write": { requestsPerMinute: 10, requestsPerHour: 100, requestsPerDay: 1000 },
  "admin:reputation": { requestsPerMinute: 5, requestsPerHour: 30, requestsPerDay: 100 },
  "admin:tests": { requestsPerMinute: 2, requestsPerHour: 10, requestsPerDay: 50 },
  "pois:write": { requestsPerMinute: 15, requestsPerHour: 200, requestsPerDay: 2000 },
  "pois:read": { requestsPerMinute: 60, requestsPerHour: 1000, requestsPerDay: 10000 },
  "pois:transition": { requestsPerMinute: 20, requestsPerHour: 300, requestsPerDay: 3000 },
};

interface RateLimitWindow {
  windowStart: Date;
  windowEnd: Date;
  requestCount: number;
}

async function getOrCreateRateLimit(
  supabase: SupabaseClient,
  orgId: string,
  apiKeyId: string | null,
  endpoint: string,
  windowMinutes: number
): Promise<RateLimitWindow> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - (now.getTime() % (windowMinutes * 60 * 1000)));
  const windowEnd = new Date(windowStart.getTime() + windowMinutes * 60 * 1000);

  const { data: existing, error: upsertError } = await supabase
    .from('rate_limits')
    .upsert(
      {
        org_id: orgId,
        api_key_id: apiKeyId,
        endpoint,
        window_start: windowStart.toISOString(),
        window_end: windowEnd.toISOString(),
        request_count: 0,
      },
      {
        onConflict: 'org_id,endpoint,window_end',
        ignoreDuplicates: false,
      }
    )
    .select('request_count, window_start, window_end')
    .single();

  if (upsertError) {
    const { data: fallback, error: fetchError } = await supabase
      .from('rate_limits')
      .select('request_count, window_start, window_end')
      .eq('org_id', orgId)
      .eq('endpoint', endpoint)
      .eq('window_end', windowEnd.toISOString())
      .maybeSingle();

    if (fetchError || !fallback) {
      console.error('Rate limit getOrCreate failed:', upsertError, fetchError);
      return { windowStart, windowEnd, requestCount: 0 };
    }

    return {
      windowStart: new Date(fallback.window_start),
      windowEnd: new Date(fallback.window_end),
      requestCount: fallback.request_count,
    };
  }

  return {
    windowStart: existing ? new Date(existing.window_start) : windowStart,
    windowEnd: existing ? new Date(existing.window_end) : windowEnd,
    requestCount: existing?.request_count ?? 0,
  };
}

/**
 * Atomic check-and-increment: combines the limit check and increment
 * in a single Postgres row-level lock to prevent TOCTOU races.
 * Returns the new count, or -1 if the limit was already reached.
 */
async function atomicCheckAndIncrement(
  supabase: SupabaseClient,
  orgId: string,
  endpoint: string,
  windowEnd: Date,
  limit: number
): Promise<number> {
  const { data, error } = await supabase.rpc('atomic_check_and_increment_rate_limit', {
    p_org_id: orgId,
    p_endpoint: endpoint,
    p_window_end: windowEnd.toISOString(),
    p_limit: limit,
  });

  if (error) {
    console.error("Error in atomic rate limit check:", error);
    // Fail open on DB errors to avoid blocking all traffic
    return 0;
  }

  return data ?? 0;
}

// ── §22 Circuit Breaker ──
// Trips when an org exceeds 10x its per-minute limit within a window,
// blocking all requests from that org for a cooldown period.
const CIRCUIT_BREAKER_MULTIPLIER = 10;
const CIRCUIT_BREAKER_COOLDOWN_MS = 60_000; // 1 minute cooldown
const circuitBreakerState = new Map<string, { trippedAt: number }>();

export async function checkRateLimit(
  supabase: SupabaseClient,
  orgId: string,
  apiKeyId: string | null,
  endpoint: string,
  scope?: string
): Promise<void> {
  const limits = scope && SCOPE_LIMITS[scope] ? SCOPE_LIMITS[scope] : DEFAULT_LIMITS;

  // Circuit breaker check - if tripped, reject immediately
  const cbKey = `${orgId}:${endpoint}`;
  const cbState = circuitBreakerState.get(cbKey);
  if (cbState) {
    const elapsed = Date.now() - cbState.trippedAt;
    if (elapsed < CIRCUIT_BREAKER_COOLDOWN_MS) {
      throw new ApiException(
        "CIRCUIT_BREAKER_OPEN",
        `Circuit breaker tripped for this endpoint. Try again in ${Math.ceil((CIRCUIT_BREAKER_COOLDOWN_MS - elapsed) / 1000)}s.`,
        429,
        { retryAfter: Math.ceil((CIRCUIT_BREAKER_COOLDOWN_MS - elapsed) / 1000) }
      );
    }
    // Cooldown expired - reset
    circuitBreakerState.delete(cbKey);
  }

  // ── Per-minute check ──
  if (limits.requestsPerMinute) {
    const minuteWindow = await getOrCreateRateLimit(supabase, orgId, apiKeyId, `${endpoint}:minute`, 1);
    const result = await atomicCheckAndIncrement(
      supabase, orgId, `${endpoint}:minute`, minuteWindow.windowEnd, limits.requestsPerMinute
    );
    if (result === -1) {
      // Trip circuit breaker if massively over limit (check current count)
      if (minuteWindow.requestCount >= limits.requestsPerMinute * CIRCUIT_BREAKER_MULTIPLIER) {
        circuitBreakerState.set(cbKey, { trippedAt: Date.now() });
      }
      const resetTime = Math.ceil((minuteWindow.windowEnd.getTime() - Date.now()) / 1000);
      throw new ApiException(
        "RATE_LIMIT_EXCEEDED",
        `Rate limit exceeded: ${limits.requestsPerMinute} requests per minute. Try again in ${resetTime} seconds.`,
        429,
        { limit: limits.requestsPerMinute, window: "minute", resetIn: resetTime, retryAfter: resetTime }
      );
    }
  }

  // ── Per-hour check ──
  if (limits.requestsPerHour) {
    const hourWindow = await getOrCreateRateLimit(supabase, orgId, apiKeyId, `${endpoint}:hour`, 60);
    const result = await atomicCheckAndIncrement(
      supabase, orgId, `${endpoint}:hour`, hourWindow.windowEnd, limits.requestsPerHour
    );
    if (result === -1) {
      const resetTime = Math.ceil((hourWindow.windowEnd.getTime() - Date.now()) / 1000);
      throw new ApiException(
        "RATE_LIMIT_EXCEEDED",
        `Rate limit exceeded: ${limits.requestsPerHour} requests per hour. Try again in ${resetTime} seconds.`,
        429,
        { limit: limits.requestsPerHour, window: "hour", resetIn: resetTime, retryAfter: resetTime }
      );
    }
  }

  // ── Per-day check ──
  if (limits.requestsPerDay) {
    const dayWindow = await getOrCreateRateLimit(supabase, orgId, apiKeyId, `${endpoint}:day`, 1440);
    const result = await atomicCheckAndIncrement(
      supabase, orgId, `${endpoint}:day`, dayWindow.windowEnd, limits.requestsPerDay
    );
    if (result === -1) {
      const resetTime = Math.ceil((dayWindow.windowEnd.getTime() - Date.now()) / 1000);
      throw new ApiException(
        "RATE_LIMIT_EXCEEDED",
        `Rate limit exceeded: ${limits.requestsPerDay} requests per day. Try again in ${resetTime} seconds.`,
        429,
        { limit: limits.requestsPerDay, window: "day", resetIn: resetTime, retryAfter: resetTime }
      );
    }
  }
}

export function getRateLimitHeaders(limits: RateLimitConfig, currentCount: number): Record<string, string> {
  const headers: Record<string, string> = {};
  
  if (limits.requestsPerMinute) {
    headers["X-RateLimit-Limit"] = limits.requestsPerMinute.toString();
    headers["X-RateLimit-Remaining"] = Math.max(0, limits.requestsPerMinute - currentCount).toString();
  }
  
  return headers;
}
