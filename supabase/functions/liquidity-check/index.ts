import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

/**
 * Public liquidity check — no auth required.
 * Returns aggregate counts only (no identities, no company names).
 * Used by the landing page to show real market signals before sign-up.
 *
 * Rate-limited: max 20 requests per IP per minute (enforced in-memory).
 */

const QuerySchema = z.object({
  product: z.string().min(1).max(200),
  location: z.string().max(200).optional(),
});

// Simple in-memory rate limiter (per-isolate, resets on cold start — acceptable for landing page)
const ipCounts = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 20;
const WINDOW_MS = 60_000;

function checkIpRate(ip: string): boolean {
  const now = Date.now();
  const entry = ipCounts.get(ip);
  if (!entry || now > entry.resetAt) {
    ipCounts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count++;
  return true;
}

Deno.serve(async (req: Request) => {
  const allowedOrigins = Deno.env.get("ALLOWED_ORIGINS") || "*";
  const corsResp = handleCors(req, allowedOrigins);
  if (corsResp) return corsResp;

  const origin = req.headers.get("origin");
  const headers = {
    ...corsHeaders(allowedOrigins, origin),
    "Content-Type": "application/json",
  };

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers,
    });
  }

  // Rate limit by IP
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("cf-connecting-ip") ||
    "unknown";
  if (!checkIpRate(ip)) {
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
        JSON.stringify({ error: "Invalid input", details: parsed.error.flatten().fieldErrors }),
        { status: 400, headers }
      );
    }

    const { product, location } = parsed.data;
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    // Build FTS query from product
    const tsQuery = product
      .trim()
      .split(/\s+/)
      .filter((w) => w.length > 1)
      .map((w) => `${w}:*`)
      .join(" & ");

    // 1. Count matching trading partners (FTS on the GIN index)
    let partnerCount = 0;
    let regionCount = 0;

    if (tsQuery) {
      // Count partners matching product (counterparties table has FTS GIN index)
      const { count: ftsCount } = await admin
        .from("counterparties")
        .select("id", { count: "exact", head: true })
        .textSearch("fts", tsQuery);

      partnerCount = ftsCount || 0;

      // Count distinct regions
      const { data: regions } = await admin
        .from("counterparties")
        .select("jurisdiction")
        .textSearch("fts", tsQuery)
        .not("jurisdiction", "is", null)
        .limit(100);

      if (regions) {
        const uniqueRegions = new Set(
          regions.map((r: { jurisdiction: string }) => r.jurisdiction).filter(Boolean)
        );
        regionCount = uniqueRegions.size;
      }
    }

    // 2. Count active trade orders for this product
    const { count: orderCount } = await admin
      .from("trade_orders")
      .select("id", { count: "exact", head: true })
      .ilike("product", `%${product.trim()}%`)
      .eq("status", "open");

    const activeOrders = orderCount || 0;

    // 3. If location provided, check location-specific matches
    let locationMatches = 0;
    if (location && location.trim()) {
      const { count: locCount } = await admin
        .from("trading_partners")
        .select("id", { count: "exact", head: true })
        .textSearch("fts", tsQuery || product)
        .ilike("jurisdiction", `%${location.trim()}%`);

      locationMatches = locCount || 0;
    }

    return new Response(
      JSON.stringify({
        partner_count: partnerCount,
        region_count: regionCount,
        active_orders: activeOrders,
        location_matches: locationMatches,
        has_liquidity: partnerCount > 0 || activeOrders > 0,
        checked_at: new Date().toISOString(),
      }),
      { status: 200, headers }
    );
  } catch (err) {
    console.error("liquidity-check error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers }
    );
  }
});
