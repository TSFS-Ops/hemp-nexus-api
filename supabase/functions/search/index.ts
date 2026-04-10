import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { authenticateRequest, requireScope } from "../_shared/auth.ts";
import { enforceTokenMetering } from "../_shared/token-metering.ts";
import { errorResponse } from "../_shared/errors.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  const allowedOrigins = Deno.env.get("ALLOWED_ORIGINS") || "*";
  const origin = req.headers.get("origin");
  const headers = corsHeaders(allowedOrigins, origin);

  const corsResponse = handleCors(req, allowedOrigins);
  if (corsResponse) return corsResponse;

  const searchStart = performance.now();
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authCtx = await authenticateRequest(req, supabaseUrl, supabaseKey);
    if (authCtx.isApiKey) {
      requireScope(authCtx, "search");
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Rate limit: protect Postgres CPU from search spam
    await checkRateLimit(
      supabase,
      authCtx.orgId,
      authCtx.isApiKey ? authCtx.userId : null,
      "/search",
      "search"
    );

    // Enforce token metering
    await enforceTokenMetering(
      supabase,
      authCtx.orgId,
      authCtx.isApiKey ? authCtx.userId : null,
      "/search",
      requestId
    );

    const rawBody = await req.json();
    const { query, role, limit = 20, location: filterLocation } = rawBody;

    if (!query || typeof query !== "string") {
      return new Response(
        JSON.stringify({ ok: false, error: "Query is required" }),
        { status: 400, headers: { ...headers, "Content-Type": "application/json" } }
      );
    }

    // Parse intent
    let signalType: "buyer" | "seller" = role === "seller" ? "seller" : "buyer";
    const lowerQuery = query.toLowerCase();
    if (lowerQuery.includes("buyer") || lowerQuery.includes("looking for") || lowerQuery.includes("want to buy")) {
      signalType = "seller";
    } else if (lowerQuery.includes("seller") || lowerQuery.includes("supplier") || lowerQuery.includes("want to sell")) {
      signalType = "buyer";
    }

    const { product, location } = parseNaturalLanguageQuery(query);
    const effectiveLocation = filterLocation || location;
    console.log(`[search] Parsed: product="${product}", location="${effectiveLocation}", role=${signalType}`);

    // Audit: search started
    await supabase.from("audit_logs").insert({
      org_id: authCtx.orgId,
      actor_user_id: authCtx.isApiKey ? null : authCtx.userId,
      actor_api_key_id: authCtx.isApiKey ? authCtx.userId : null,
      action: "search_initiated",
      entity_type: "search",
      metadata: { query, parsed_product: product, parsed_location: effectiveLocation, signal_type: signalType },
    });

    // ── 1. Trading Partners table (Postgres full-text search) ──
    const tsQuery = product
      .split(/\s+/)
      .filter((w: string) => w.length > 1)
      .map((w: string) => w.replace(/[^a-zA-Z0-9]/g, ""))
      .filter(Boolean)
      .join(" & ");

    let counterpartyResults: any[] = [];
    let ftsResultCount = 0;
    let ilikeFallbackUsed = false;
    let ilikeResultCount = 0;

    if (tsQuery) {
      let cpQuery = supabase
        .from("trading partners")
        .select("id, company_name, website, jurisdiction, registration_number, product_categories, description, contact_email, verified, org_id, created_at")
        .textSearch("fts", tsQuery, { type: "plain", config: "english" })
        .neq("org_id", authCtx.orgId)
        .limit(limit);

      if (effectiveLocation) {
        cpQuery = cpQuery.ilike("jurisdiction", `%${effectiveLocation.replace(/[%_\\]/g, "")}%`);
      }

      const { data: cpData, error: cpError } = await cpQuery;
      if (cpError) {
        console.error("[search] Counterparty FTS error:", cpError.message);
      }
      counterpartyResults = cpData || [];
    }

    // If FTS returned nothing, try a simple ILIKE fallback
    if (counterpartyResults.length === 0 && product) {
      let fallbackQuery = supabase
        .from("trading partners")
        .select("id, company_name, website, jurisdiction, registration_number, product_categories, description, contact_email, verified, org_id, created_at")
        .neq("org_id", authCtx.orgId)
        .or(`company_name.ilike.%${product.replace(/[%_\\]/g, "")}%,description.ilike.%${product.replace(/[%_\\]/g, "")}%`)
        .limit(limit);

      if (effectiveLocation) {
        fallbackQuery = fallbackQuery.ilike("jurisdiction", `%${effectiveLocation.replace(/[%_\\]/g, "")}%`);
      }

      const { data: fallbackData } = await fallbackQuery;
      counterpartyResults = fallbackData || [];
    }

    console.log(`[search] Trading Partners table returned ${counterpartyResults.length} results`);

    // Map trading partners to search result shape
    const cpResults = counterpartyResults.map((cp: any) => ({
      id: cp.id,
      title: cp.company_name,
      description: [
        cp.description,
        cp.jurisdiction ? `Jurisdiction: ${cp.jurisdiction}` : null,
        cp.registration_number ? `Reg: ${cp.registration_number}` : null,
        cp.product_categories?.length > 0 ? `Products: ${cp.product_categories.join(", ")}` : null,
      ].filter(Boolean).join(" · "),
      url: cp.website || "#",
      source: cp.verified ? "verified_registry" : "counterparty_registry",
      score: cp.verified ? 0.9 : 0.7,
      isEnriched: false,
      enrichmentReason: null,
      whySurfaced: "Matched from counterparty registry via full-text search",
      coherence: {
        score: cp.verified ? 0.95 : 0.7,
        passed: true,
        factors: [
          ...(cp.verified ? ["Verified entity"] : []),
          ...(cp.jurisdiction ? [`Jurisdiction: ${cp.jurisdiction}`] : []),
          ...(cp.product_categories?.length > 0 ? ["Product match"] : []),
        ],
      },
      metadata: {
        org_id: cp.org_id,
        contact_email: cp.contact_email,
        verified: cp.verified,
        registration_number: cp.registration_number,
      },
    }));

    // ── 2. Order Book Augmentation ──
    const orderSide = signalType === "buyer" ? "offer" : "bid";
    let orderBookQuery = supabase
      .from("trade_orders")
      .select("id, side, product, price, price_currency, volume, volume_unit, location, org_id, created_at, expires_at")
      .eq("status", "active")
      .eq("side", orderSide)
      .neq("org_id", authCtx.orgId)
      .limit(20);

    if (product) {
      orderBookQuery = orderBookQuery.ilike("product", `%${product.replace(/[%_\\]/g, "")}%`);
    }

    const { data: orderBookHits } = await orderBookQuery;
    const validOrders = (orderBookHits || []).filter((o: any) =>
      !o.expires_at || new Date(o.expires_at) > new Date()
    );
    const orderBookResults = validOrders.map((o: any) => ({
      id: o.id,
      title: `${o.side.toUpperCase()}: ${o.product}`,
      description: [
        o.price != null ? `${o.price_currency} ${Number(o.price).toLocaleString()}` : null,
        o.volume != null ? `${Number(o.volume).toLocaleString()} ${o.volume_unit}` : null,
        o.location,
      ].filter(Boolean).join(" · "),
      url: "#",
      source: "order_book",
      score: 0.8,
      isEnriched: false,
      enrichmentReason: null,
      whySurfaced: "Active order on the platform order book",
      coherence: { score: 0.85, passed: true, factors: ["Active order", "Product match"] },
      metadata: { order_id: o.id, org_id: o.org_id, side: o.side, price: o.price, volume: o.volume, location: o.location },
    }));

    console.log(`[search] Order book matched ${orderBookResults.length} active orders`);

    // ── 3. Merge, sort, return ──
    const allResults = [...cpResults, ...orderBookResults];
    allResults.sort((a, b) => b.score - a.score);
    const finalResults = allResults.slice(0, limit);

    // Audit: search completed
    await supabase.from("audit_logs").insert({
      org_id: authCtx.orgId,
      actor_user_id: authCtx.isApiKey ? null : authCtx.userId,
      actor_api_key_id: authCtx.isApiKey ? authCtx.userId : null,
      action: "search_completed",
      entity_type: "search",
      metadata: {
        query,
        counterparty_count: cpResults.length,
        order_book_count: orderBookResults.length,
        results_returned: finalResults.length,
      },
    });

    return new Response(
      JSON.stringify({
        ok: true,
        query,
        parsedQuery: { product, location: effectiveLocation, role: signalType },
        results: finalResults,
        metrics: {
          baselineCount: cpResults.length,
          enrichedCount: 0,
          upliftPct: 0,
          enrichmentReasons: {},
          orderBookMatches: orderBookResults.length,
        },
      }),
      { status: 200, headers: { ...headers, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[search] Error:", error);
    return errorResponse(error instanceof Error ? error : new Error("Unknown error"), requestId, headers);
  }
});

function parseNaturalLanguageQuery(query: string): { product: string; location: string } {
  const locationPatterns = [
    /\bin\s+([a-zA-Z\s]+?)(?:\s+for|\s+with|\s*$)/i,
    /\bfrom\s+([a-zA-Z\s]+?)(?:\s+for|\s+with|\s*$)/i,
    /\bto\s+([a-zA-Z\s]+?)(?:\s+for|\s+with|\s*$)/i,
  ];

  let location = "";
  for (const pattern of locationPatterns) {
    const match = query.match(pattern);
    if (match) {
      location = match[1].trim();
      break;
    }
  }

  let product = query
    .replace(/\b(buyers?|sellers?|suppliers?|for|in|from|to|looking|want|need|find|get)\b/gi, " ")
    .replace(new RegExp(location, "gi"), "")
    .replace(/\s+/g, " ")
    .trim();

  if (!product) product = query;

  return { product, location };
}
