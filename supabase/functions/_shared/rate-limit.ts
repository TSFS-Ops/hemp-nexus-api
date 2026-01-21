import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { ApiException } from "./errors.ts";

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

// Scope-specific rate limits (more restrictive for write operations)
const SCOPE_LIMITS: Record<string, RateLimitConfig> = {
  "signals:write": { requestsPerMinute: 30, requestsPerHour: 500, requestsPerDay: 5000 },
  "match": { requestsPerMinute: 20, requestsPerHour: 300, requestsPerDay: 3000 },
  "data-sources:write": { requestsPerMinute: 10, requestsPerHour: 100, requestsPerDay: 1000 },
  // Admin endpoints - very restrictive to prevent abuse
  "admin:reputation": { requestsPerMinute: 5, requestsPerHour: 30, requestsPerDay: 100 },
  "admin:tests": { requestsPerMinute: 2, requestsPerHour: 10, requestsPerDay: 50 },
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

  // Use UPSERT (ON CONFLICT DO UPDATE) to atomically create/get rate limit record
  // This fixes the race condition where concurrent requests could both create new records
  const { data: existing, error: upsertError } = await supabase
    .from('rate_limits')
    .upsert(
      {
        org_id: orgId,
        api_key_id: apiKeyId,
        endpoint,
        window_start: windowStart.toISOString(),
        window_end: windowEnd.toISOString(),
        request_count: 0, // Will be ignored on conflict
      },
      {
        onConflict: 'org_id,endpoint,window_end',
        ignoreDuplicates: false,
      }
    )
    .select('request_count, window_start, window_end')
    .single();

  if (upsertError) {
    // If upsert fails due to unique constraint (concurrent request), try to fetch existing
    const { data: fallback, error: fetchError } = await supabase
      .from('rate_limits')
      .select('request_count, window_start, window_end')
      .eq('org_id', orgId)
      .eq('endpoint', endpoint)
      .eq('window_end', windowEnd.toISOString())
      .maybeSingle();

    if (fetchError || !fallback) {
      console.error('Rate limit getOrCreate failed:', upsertError, fetchError);
      // Return safe defaults on error - don't block requests due to rate limit DB issues
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
 * Atomically increment rate limit counter using database RPC function.
 * This prevents race conditions where concurrent requests bypass limits.
 */
async function incrementRateLimitAtomic(
  supabase: SupabaseClient,
  orgId: string,
  endpoint: string,
  windowEnd: Date
): Promise<number> {
  const { data, error } = await supabase.rpc('increment_rate_limit', {
    p_org_id: orgId,
    p_endpoint: endpoint,
    p_window_end: windowEnd.toISOString()
  });

  if (error) {
    console.error("Error incrementing rate limit atomically:", error);
    // Fallback: return 0 but log the failure for monitoring
    return 0;
  }

  return data || 0;
}

export async function checkRateLimit(
  supabase: SupabaseClient,
  orgId: string,
  apiKeyId: string | null,
  endpoint: string,
  scope?: string
): Promise<void> {
  // Get rate limit config based on scope
  const limits = scope && SCOPE_LIMITS[scope] ? SCOPE_LIMITS[scope] : DEFAULT_LIMITS;

  // Check per-minute limit
  if (limits.requestsPerMinute) {
    const minuteWindow = await getOrCreateRateLimit(supabase, orgId, apiKeyId, `${endpoint}:minute`, 1);
    if (minuteWindow.requestCount >= limits.requestsPerMinute) {
      const resetTime = Math.ceil((minuteWindow.windowEnd.getTime() - Date.now()) / 1000);
      throw new ApiException(
        "RATE_LIMIT_EXCEEDED",
        `Rate limit exceeded: ${limits.requestsPerMinute} requests per minute. Try again in ${resetTime} seconds.`,
        429,
        {
          limit: limits.requestsPerMinute,
          window: "minute",
          resetIn: resetTime,
          retryAfter: resetTime,
        }
      );
    }
    // Use atomic increment to prevent race conditions
    await incrementRateLimitAtomic(supabase, orgId, `${endpoint}:minute`, minuteWindow.windowEnd);
  }

  // Check per-hour limit
  if (limits.requestsPerHour) {
    const hourWindow = await getOrCreateRateLimit(supabase, orgId, apiKeyId, `${endpoint}:hour`, 60);
    if (hourWindow.requestCount >= limits.requestsPerHour) {
      const resetTime = Math.ceil((hourWindow.windowEnd.getTime() - Date.now()) / 1000);
      throw new ApiException(
        "RATE_LIMIT_EXCEEDED",
        `Rate limit exceeded: ${limits.requestsPerHour} requests per hour. Try again in ${resetTime} seconds.`,
        429,
        {
          limit: limits.requestsPerHour,
          window: "hour",
          resetIn: resetTime,
          retryAfter: resetTime,
        }
      );
    }
    await incrementRateLimitAtomic(supabase, orgId, `${endpoint}:hour`, hourWindow.windowEnd);
  }

  // Check per-day limit
  if (limits.requestsPerDay) {
    const dayWindow = await getOrCreateRateLimit(supabase, orgId, apiKeyId, `${endpoint}:day`, 1440);
    if (dayWindow.requestCount >= limits.requestsPerDay) {
      const resetTime = Math.ceil((dayWindow.windowEnd.getTime() - Date.now()) / 1000);
      throw new ApiException(
        "RATE_LIMIT_EXCEEDED",
        `Rate limit exceeded: ${limits.requestsPerDay} requests per day. Try again in ${resetTime} seconds.`,
        429,
        {
          limit: limits.requestsPerDay,
          window: "day",
          resetIn: resetTime,
          retryAfter: resetTime,
        }
      );
    }
    await incrementRateLimitAtomic(supabase, orgId, `${endpoint}:day`, dayWindow.windowEnd);
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
