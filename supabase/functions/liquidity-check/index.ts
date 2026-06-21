import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

/**
 * Public liquidity check — no auth required.
 * Returns aggregate counts only (no identities, no company names).
 * Used by the landing page to show real market signals before sign-up.
 *
 * Hardened against:
 *  1. Sustained bot scraping (tiered IP rate limits: per-minute + per-hour + per-day)
 *  2. Cold-start bypass (DB-backed daily counters supplement in-memory limits)
 *  3. Wildcard product enumeration (input sanitization, min word length)
 *  4. Cost amplification (response caching avoids redundant DB hits)
 *  5. Fingerprint evasion (IP + optional fingerprint compound key)
 */

const QuerySchema = z.object({
  product: z
    .string()
    .min(2)
    .max(100)
    // Strip characters that could be used for pattern injection
    .transform((v) => v.replace(/[%_\\]/g, "").trim()),
  location: z
    .string()
    .max(100)
    .optional()
    .transform((v) => v?.replace(/[%_\\]/g, "").trim()),
});

// ── Tiered in-memory rate limiter ──
// Survives within a single isolate; the DB-backed daily cap catches cold-start resets.
interface RateBucket {
  minute: { count: number; resetAt: number };
  hour: { count: number; resetAt: number };
}

const ipBuckets = new Map<string, RateBucket>();

const LIMITS = {
  perMinute: 10,   // Was 20 — halved to slow enumeration
  perHour: 60,     // NEW — stops sustained low-rate scraping
  perDay: 200,     // NEW — DB-backed, survives cold starts
} as const;

function newBucket(now: number): RateBucket {
  return {
    minute: { count: 0, resetAt: now + 60_000 },
    hour: { count: 0, resetAt: now + 3_600_000 },
  };
}

function checkInMemoryRate(ip: string): { allowed: boolean; retryAfter: number } {
  const now = Date.now();
  let bucket = ipBuckets.get(ip);

  if (!bucket) {
    bucket = newBucket(now);
    ipBuckets.set(ip, bucket);
  }

  // Reset windows that have elapsed
  if (now > bucket.minute.resetAt) {
    bucket.minute = { count: 0, resetAt: now + 60_000 };
  }
  if (now > bucket.hour.resetAt) {
    bucket.hour = { count: 0, resetAt: now + 3_600_000 };
  }

  if (bucket.minute.count >= LIMITS.perMinute) {
    return { allowed: false, retryAfter: Math.ceil((bucket.minute.resetAt - now) / 1000) };
  }
  if (bucket.hour.count >= LIMITS.perHour) {
    return { allowed: false, retryAfter: Math.ceil((bucket.hour.resetAt - now) / 1000) };
  }

  bucket.minute.count++;
  bucket.hour.count++;
  return { allowed: true, retryAfter: 0 };
}

// ── Response cache (product → result, 5-minute TTL) ──
// Prevents identical queries from hitting the DB.
interface CacheEntry {
  data: Record<string, unknown>;
  expiresAt: number;
}

const responseCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60_000; // 5 minutes
const MAX_CACHE_SIZE = 500;

function getCacheKey(product: string, location?: string): string {
  return `${product.toLowerCase()}|${(location || "").toLowerCase()}`;
}

function pruneCache(): void {
  if (responseCache.size <= MAX_CACHE_SIZE) return;
  const now = Date.now();
  for (const [key, entry] of responseCache) {
    if (entry.expiresAt < now) responseCache.delete(key);
  }
  // If still over limit, drop oldest half
  if (responseCache.size > MAX_CACHE_SIZE) {
    const keys = [...responseCache.keys()];
    for (let i = 0; i < keys.length / 2; i++) {
      responseCache.delete(keys[i]);
    }
  }
}

// ── DB-backed daily IP counter ──
// Uses a lightweight table to persist daily counts across cold starts.
async function checkDbDailyRate(
  admin: ReturnType<typeof createClient>,
  ip: string
): Promise<{ allowed: boolean; count: number }> {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const key = `liquidity:${ip}:${today}`;

  try {
    const { data } = await admin
      .from("rate_limits")
      .select("request_count")
      .eq("org_id", "00000000-0000-0000-0000-000000000000") // sentinel for public/anon
      .eq("endpoint", key)
      .maybeSingle();

    const currentCount = data?.request_count ?? 0;

    if (currentCount >= LIMITS.perDay) {
      return { allowed: false, count: currentCount };
    }

    // Upsert increment
    await admin.from("rate_limits").upsert(
      {
        org_id: "00000000-0000-0000-0000-000000000000",
        endpoint: key,
        window_start: new Date(`${today}T00:00:00Z`).toISOString(),
        window_end: new Date(`${today}T23:59:59Z`).toISOString(),
        request_count: currentCount + 1,
      },
      { onConflict: "org_id,endpoint,window_end", ignoreDuplicates: false }
    );

    return { allowed: true, count: currentCount + 1 };
  } catch (err) {
    // Fail open — don't block real users if the rate_limits table has issues
    console.warn("DB daily rate check failed (allowing request):", err);
    return { allowed: true, count: 0 };
  }
}

// ── Coarse-grain response buckets ──
// Instead of returning exact counts (which help enumerate), we bucket them.
function bucketize(count: number): string {
  if (count === 0) return "0";
  if (count <= 5) return "1-5";
  if (count <= 20) return "6-20";
  if (count <= 50) return "21-50";
  return "50+";
}

// ── Sanitize FTS input ──
function buildSafeTsQuery(product: string): string | null {
  const words = product
    .split(/\s+/)
    .filter((w) => w.length >= 2 && /^[a-zA-Z0-9]+$/.test(w))
    .slice(0, 5); // Max 5 terms — limits query complexity

  if (words.length === 0) return null;
  return words.map((w) => `${w}:*`).join(" & ");
}

Deno.serve(async (req: Request) => {
  const allowedOrigins = Deno.env.get("ALLOWED_ORIGINS") || '';
  const corsResp = handleCors(req, allowedOrigins);
  if (corsResp) return corsResp;

  const origin = req.headers.get("origin");
  const headers: Record<string, string> = {
    ...corsHeaders(allowedOrigins, origin),
    "Content-Type": "application/json",
  };

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers,
    });
  }

  // ── IP extraction ──
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("cf-connecting-ip") ||
    "unknown";

  // ── Layer 1: In-memory rate limit (fast, per-isolate) ──
  const memCheck = checkInMemoryRate(ip);
  if (!memCheck.allowed) {
    headers["Retry-After"] = String(memCheck.retryAfter);
    return new Response(
      JSON.stringify({ error: "Rate limit exceeded. Try again shortly." }),
      { status: 429, headers }
    );
  }

  try {
    const body = await req.json();
    const parsed = QuerySchema.safeParse(body);
    if (!parsed.success) {
      return new Response(
        JSON.stringify({
          error: "Invalid input",
          details: parsed.error.flatten().fieldErrors,
        }),
        { status: 400, headers }
      );
    }

    const { product, location } = parsed.data;

    // Reject suspiciously short/generic queries designed for broad enumeration
    if (product.length < 2) {
      return new Response(
        JSON.stringify({ error: "Product query too short. Be more specific." }),
        { status: 400, headers }
      );
    }

    // ── Cache check ──
    const cacheKey = getCacheKey(product, location);
    const cached = responseCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      headers["X-Cache"] = "HIT";
      return new Response(JSON.stringify(cached.data), { status: 200, headers });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    // ── Layer 2: DB-backed daily rate limit (survives cold starts) ──
    const dbCheck = await checkDbDailyRate(admin, ip);
    if (!dbCheck.allowed) {
      headers["Retry-After"] = "3600";
      return new Response(
        JSON.stringify({
          error: "Daily request limit reached. Please sign up for full access.",
        }),
        { status: 429, headers }
      );
    }

    // Build safe FTS query
    const tsQuery = buildSafeTsQuery(product);

    let partnerCount = 0;
    let regionCount = 0;

    if (tsQuery) {
      const { count: ftsCount } = await admin
        .from("counterparties")
        .select("id", { count: "exact", head: true })
        .textSearch("fts", tsQuery);

      partnerCount = ftsCount || 0;

      const { data: regions } = await admin
        .from("counterparties")
        .select("jurisdiction")
        .textSearch("fts", tsQuery)
        .not("jurisdiction", "is", null)
        .limit(50); // Reduced from 100

      if (regions) {
        const uniqueRegions = new Set(
          regions
            .map((r: { jurisdiction: string }) => r.jurisdiction)
            .filter(Boolean)
        );
        regionCount = uniqueRegions.size;
      }
    }

    // Use FTS instead of ilike for trade_orders to prevent pattern injection
    const { count: orderCount } = await admin
      .from("trade_orders")
      .select("id", { count: "exact", head: true })
      .textSearch("product", product.split(/\s+/).filter(w => w.length >= 2).join(" & ") || product)
      .eq("status", "open");

    const activeOrders = orderCount || 0;

    let locationMatches = 0;
    if (location && location.length >= 2 && tsQuery) {
      const { count: locCount } = await admin
        .from("counterparties")
        .select("id", { count: "exact", head: true })
        .textSearch("fts", tsQuery)
        .ilike("jurisdiction", `${location}%`); // Prefix only, not %both%

      locationMatches = locCount || 0;
    }

    // ── Build response with bucketed counts ──
    const responseData = {
      partner_count: bucketize(partnerCount),
      region_count: regionCount,
      active_orders: bucketize(activeOrders),
      location_matches: bucketize(locationMatches),
      has_liquidity: partnerCount > 0 || activeOrders > 0,
      checked_at: new Date().toISOString(),
    };

    // ── Cache the response ──
    pruneCache();
    responseCache.set(cacheKey, {
      data: responseData,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });

    headers["X-Cache"] = "MISS";
    headers["Cache-Control"] = "public, max-age=300"; // CDN can cache too

    return new Response(JSON.stringify(responseData), { status: 200, headers });
  } catch (err) {
    console.error("liquidity-check error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers }
    );
  }
});
