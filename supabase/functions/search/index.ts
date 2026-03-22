import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { authenticateRequest, requireScope } from "../_shared/auth.ts";
import { multiProviderSearch, generateEnhancedQueries } from "../_shared/multi-search.ts";
import { generateEmbedding, cosineSimilarity } from "../_shared/embeddings.ts";
import { 
  generateEnrichedQueries, 
  mergeResults, 
  calculateMetrics, 
  scoreCoherence,
  type DiscoveryResult,
} from "../_shared/discovery-engine.ts";
import { enforceTokenMetering } from "../_shared/token-metering.ts";
import { errorResponse } from "../_shared/errors.ts";

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  const allowedOrigins = Deno.env.get("ALLOWED_ORIGINS") || "*";
  const origin = req.headers.get("origin");
  const headers = corsHeaders(allowedOrigins, origin);

  const corsResponse = handleCors(req, allowedOrigins);
  if (corsResponse) return corsResponse;
  
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    
    // Authenticate request
    const authCtx = await authenticateRequest(req, supabaseUrl, supabaseKey);
    
    // SECURITY: Require 'search' scope for API key access
    if (authCtx.isApiKey) {
      requireScope(authCtx, 'search');
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // Enforce token metering - burns 1 token per request
    await enforceTokenMetering(
      supabase,
      authCtx.orgId,
      authCtx.isApiKey ? authCtx.userId : null,
      "/search",
      requestId
    );

    const rawBody = await req.json();
    const { query, role, limit = 20 } = rawBody;

    if (!query || typeof query !== "string") {
      return new Response(
        JSON.stringify({ ok: false, error: "Query is required" }),
        { status: 400, headers: { ...headers, "Content-Type": "application/json" } }
      );
    }

    // Determine signal type from role or parse from query
    let signalType: "buyer" | "seller" = role === "seller" ? "seller" : "buyer";
    const lowerQuery = query.toLowerCase();
    if (lowerQuery.includes("buyer") || lowerQuery.includes("looking for") || lowerQuery.includes("want to buy")) {
      signalType = "seller"; // Looking for buyers = I am seller
    } else if (lowerQuery.includes("seller") || lowerQuery.includes("supplier") || lowerQuery.includes("want to sell")) {
      signalType = "buyer"; // Looking for sellers = I am buyer
    }

    // Parse product and location from natural language query
    const { product, location } = parseNaturalLanguageQuery(query);
    console.log(`[search] Parsed: product="${product}", location="${location}", role=${signalType}`);

    // Log audit
    await supabase.from("audit_logs").insert({
      org_id: authCtx.orgId,
      actor_user_id: authCtx.isApiKey ? null : authCtx.userId,
      actor_api_key_id: authCtx.isApiKey ? authCtx.userId : null,
      action: "search_initiated",
      entity_type: "search",
      metadata: {
        query,
        parsed_product: product,
        parsed_location: location,
        signal_type: signalType,
        timestamp: new Date().toISOString(),
      },
    });

    // Generate query embedding for semantic matching
    const queryEmbedding = await generateEmbedding(query);
    console.log(`[search] Query embedding: ${queryEmbedding ? 'success' : 'failed'}`);

    // Create a mock signal object for query generation
    const mockSignal = {
      type: signalType,
      content: {
        product,
        location,
        what: product,
      }
    };

    // Generate baseline queries
    const baselineQueries = generateEnhancedQueries(mockSignal);
    // Add the original query
    baselineQueries.unshift(query);
    console.log(`[search] Generated ${baselineQueries.length} baseline queries`);

    // Perform baseline search
    const baselineResults = await multiProviderSearch(baselineQueries.slice(0, 5));
    const baselineCount = baselineResults.length;
    console.log(`[search] Baseline search returned ${baselineCount} results`);

    // Generate enriched queries using 12% engine
    const enrichedQueryData = generateEnrichedQueries(product, location, signalType, baselineQueries);
    console.log(`[search] 12% Engine generated ${enrichedQueryData.length} enriched queries`);

    // Perform enriched search
    let enrichedResults: DiscoveryResult[] = [];
    if (enrichedQueryData.length > 0) {
      const enrichedQueries = enrichedQueryData.map(eq => eq.query);
      const rawEnrichedResults = await multiProviderSearch(enrichedQueries.slice(0, 3));
      
      enrichedResults = rawEnrichedResults.map((r, idx) => {
        const queryIdx = Math.floor(idx / Math.max(1, rawEnrichedResults.length / enrichedQueryData.length));
        const reason = enrichedQueryData[Math.min(queryIdx, enrichedQueryData.length - 1)]?.reason || "12% engine discovery";
        return {
          id: crypto.randomUUID(),
          title: r.title,
          url: r.url,
          description: r.description,
          source: r.source,
          is_enriched: true,
          enrichment_reason: reason,
          confidence_score: 0.55,
          metadata: { search_query: enrichedQueries[Math.min(queryIdx, enrichedQueries.length - 1)] }
        };
      });
      console.log(`[search] 12% Engine found ${enrichedResults.length} additional results`);
    }

    // Merge and deduplicate results
    const mergedResults = mergeResults(baselineResults, enrichedResults);
    console.log(`[search] Merged to ${mergedResults.length} total results`);

    // ── Order Book Augmentation ──────────────────────────────────
    // Query active trade_orders that match the product/location and opposite side
    const orderSide = signalType === "buyer" ? "offer" : "bid";
    let orderBookQuery = supabase
      .from("trade_orders")
      .select("id, side, product, price, price_currency, volume, volume_unit, location, org_id, created_at, expires_at")
      .eq("status", "active")
      .eq("side", orderSide)
      .neq("org_id", authCtx.orgId) // exclude self-matches
      .limit(20);

    if (product) {
      orderBookQuery = orderBookQuery.ilike("product", `%${product.replace(/[%_\\]/g, "")}%`);
    }

    const { data: orderBookHits } = await orderBookQuery;
    // Filter out expired orders (server-side, since Supabase doesn't support OR-with-null easily)
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
      url: null,
      source: "order_book",
      is_enriched: false,
      is_order_book: true,
      confidence_score: 0.8,
      metadata: {
        order_id: o.id,
        org_id: o.org_id,
        side: o.side,
        price: o.price,
        volume: o.volume,
        location: o.location,
      },
    }));
    console.log(`[search] Order book matched ${orderBookResults.length} active orders (${(orderBookHits || []).length - validOrders.length} expired filtered)`);

    // Calculate discovery metrics
    const metrics = calculateMetrics(baselineCount, mergedResults);
    console.log(`[search] Uplift: ${metrics.uplift_pct.toFixed(1)}%`);

    // Score and rank results with embeddings (includes web + order book)
    const allResults = [...mergedResults, ...orderBookResults];
    const scoredResults = await scoreResults(allResults.slice(0, limit), queryEmbedding, mockSignal);

    // Sort by score descending
    scoredResults.sort((a, b) => b.score - a.score);

    // Log audit completion
    await supabase.from("audit_logs").insert({
      org_id: authCtx.orgId,
      actor_user_id: authCtx.isApiKey ? null : authCtx.userId,
      actor_api_key_id: authCtx.isApiKey ? authCtx.userId : null,
      action: "search_completed",
      entity_type: "search",
      metadata: {
        query,
        baseline_count: baselineCount,
        enriched_count: metrics.enriched_count,
        uplift_pct: metrics.uplift_pct,
        results_returned: scoredResults.length,
        timestamp: new Date().toISOString(),
      },
    });

    return new Response(
      JSON.stringify({
        ok: true,
        query,
        parsedQuery: { product, location, role: signalType },
        results: scoredResults,
        metrics: {
          baselineCount,
          enrichedCount: metrics.enriched_count,
          upliftPct: Math.round(metrics.uplift_pct * 10) / 10,
          enrichmentReasons: metrics.enrichment_reasons,
          orderBookMatches: orderBookResults.length,
        }
      }),
      { status: 200, headers: { ...headers, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[search] Error:", error);
    return errorResponse(error instanceof Error ? error : new Error("Unknown error"), requestId, headers);
  }
});

function parseNaturalLanguageQuery(query: string): { product: string; location: string } {
  const lowerQuery = query.toLowerCase();
  
  // Common location indicators
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
  
  // Common product extraction - remove noise words
  let product = query
    .replace(/\b(buyers?|sellers?|suppliers?|for|in|from|to|looking|want|need|find|get)\b/gi, " ")
    .replace(new RegExp(location, "gi"), "")
    .replace(/\s+/g, " ")
    .trim();
  
  // If product is empty, use the whole query
  if (!product) {
    product = query;
  }
  
  return { product, location };
}

async function scoreResults(
  results: any[],
  queryEmbedding: number[] | null,
  signal: any
): Promise<any[]> {
  const scored = [];
  
  for (const result of results) {
    let score = result.confidence_score || 0.5;
    
    // Semantic similarity scoring
    if (queryEmbedding) {
      const resultText = `${result.title} ${result.description}`;
      const resultEmbedding = await generateEmbedding(resultText);
      if (resultEmbedding) {
        const similarity = cosineSimilarity(queryEmbedding, resultEmbedding);
        score = 0.3 + (similarity * 0.7); // Scale to 0.3-1.0
      }
    }
    
    // Coherence scoring
    const coherence = scoreCoherence(signal, {
      what: signal.content.product,
      where_location: result.location || "",
      metadata: result.metadata || {},
    });
    
    // Combine scores
    const finalScore = (score * 0.7) + (coherence.score * 0.3);
    
    scored.push({
      id: result.id || crypto.randomUUID(),
      title: result.title,
      description: result.description,
      url: result.url,
      source: result.source,
      score: Math.round(finalScore * 100) / 100,
      isEnriched: result.is_enriched || false,
      enrichmentReason: result.enrichment_reason || null,
      whySurfaced: result.is_enriched ? result.enrichment_reason : "Baseline AI search",
      coherence: {
        score: coherence.score,
        passed: coherence.passed,
        factors: coherence.factors,
      },
      metadata: result.metadata || {},
    });
  }
  
  return scored;
}
