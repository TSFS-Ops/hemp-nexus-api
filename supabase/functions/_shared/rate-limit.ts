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
  const windowStart = new Date(Math.floor(now.getTime() / (windowMinutes * 60 * 1000)) * (windowMinutes * 60 * 1000));
  const windowEnd = new Date(windowStart.getTime() + windowMinutes * 60 * 1000);

  // Try to find existing rate limit record for this window
  const { data: existing } = await supabase
    .from("rate_limits")
    .select("*")
    .eq("org_id", orgId)
    .eq("endpoint", endpoint)
    .gte("window_end", now.toISOString())
    .maybeSingle();

  if (existing) {
    return {
      windowStart: new Date(existing.window_start),
      windowEnd: new Date(existing.window_end),
      requestCount: existing.request_count,
    };
  }

  // Create new rate limit record
  const { data: newRecord, error } = await supabase
    .from("rate_limits")
    .insert({
      org_id: orgId,
      api_key_id: apiKeyId,
      endpoint,
      request_count: 0,
      window_start: windowStart.toISOString(),
      window_end: windowEnd.toISOString(),
    })
    .select()
    .single();

  if (error) {
    console.error("Error creating rate limit record:", error);
    // If there's an error creating, return a default window
    return {
      windowStart,
      windowEnd,
      requestCount: 0,
    };
  }

  return {
    windowStart: new Date(newRecord.window_start),
    windowEnd: new Date(newRecord.window_end),
    requestCount: newRecord.request_count,
  };
}

async function incrementRateLimit(
  supabase: SupabaseClient,
  orgId: string,
  endpoint: string,
  windowEnd: Date
): Promise<number> {
  // Fetch current count first
  const { data: current } = await supabase
    .from("rate_limits")
    .select("request_count")
    .eq("org_id", orgId)
    .eq("endpoint", endpoint)
    .eq("window_end", windowEnd.toISOString())
    .single();

  const newCount = (current?.request_count || 0) + 1;
  
  // Update with incremented count
  const { error } = await supabase
    .from("rate_limits")
    .update({ request_count: newCount })
    .eq("org_id", orgId)
    .eq("endpoint", endpoint)
    .eq("window_end", windowEnd.toISOString());

  if (error) {
    console.error("Error incrementing rate limit:", error);
  }

  return newCount;
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
    await incrementRateLimit(supabase, orgId, `${endpoint}:minute`, minuteWindow.windowEnd);
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
    await incrementRateLimit(supabase, orgId, `${endpoint}:hour`, hourWindow.windowEnd);
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
    await incrementRateLimit(supabase, orgId, `${endpoint}:day`, dayWindow.windowEnd);
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
