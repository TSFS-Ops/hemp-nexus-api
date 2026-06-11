import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { scoreOption } from "../_shared/scoring.ts";
import { authenticateRequest } from "../_shared/auth.ts";
import { srDiscoverSchema, validateInput } from "../_shared/validation.ts";
import { multiProviderSearch, generateEnhancedQueries } from "../_shared/multi-search.ts";
import { generateEmbedding, signalToText, cosineSimilarity } from "../_shared/embeddings.ts";
import { 
  generateEnrichedQueries, 
  mergeResults, 
  calculateMetrics, 
  scoreCoherence,
  type DiscoveryResult,
  type DiscoveryMetrics
} from "../_shared/discovery-engine.ts";
import { errorResponse } from "../_shared/errors.ts";

const allowedOrigins = Deno.env.get('ALLOWED_ORIGINS') || '';

Deno.serve(async (req) => {
  const preflight = handleCors(req, allowedOrigins);
  if (preflight) return preflight;
  const origin = req.headers.get('origin');
  const headers = corsHeaders(allowedOrigins, origin);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    
    // Authenticate request
    const authCtx = await authenticateRequest(req, supabaseUrl, supabaseKey);
    const supabase = createClient(supabaseUrl, supabaseKey);

    const rawBody = await req.json();
    
    let validatedData;
    try {
      validatedData = validateInput(srDiscoverSchema, rawBody);
    } catch (error) {
      return new Response(
        JSON.stringify({ 
          ok: false, 
          error: error instanceof Error ? error.message : "Invalid input"
        }),
        { status: 400, headers: { ...headers, "Content-Type": "application/json" } }
      );
    }

    const { signalId } = validatedData;

    // Log audit: sr-discover initiated
    await supabase.from("audit_logs").insert({
      org_id: authCtx.orgId,
      actor_user_id: authCtx.isApiKey ? null : authCtx.userId,
      actor_api_key_id: authCtx.isApiKey ? authCtx.userId : null,
      action: "sr_discover_initiated",
      entity_type: "signal",
      entity_id: signalId,
      metadata: {
        timestamp: new Date().toISOString(),
      },
    });

    // 1. Read the signal (with org validation to prevent cross-org access)
    console.log(`[sr-discover] Reading signal ${signalId} for org ${authCtx.orgId}`);
    const { data: signal, error: signalError } = await supabase
      .from("signals")
      .select("*")
      .eq("id", signalId)
      .eq("org_id", authCtx.orgId)
      .single();

    if (signalError || !signal) {
      console.error(`[sr-discover] Signal not found:`, signalError);
      
      // Log audit: sr-discover failed
      await supabase.from("audit_logs").insert({
        org_id: authCtx.orgId,
        actor_user_id: authCtx.isApiKey ? null : authCtx.userId,
        actor_api_key_id: authCtx.isApiKey ? authCtx.userId : null,
        action: "sr_discover_failed",
        entity_type: "signal",
        entity_id: signalId,
        metadata: {
          error: "Signal not found",
          timestamp: new Date().toISOString(),
        },
      });
      
      return new Response(
        JSON.stringify({ ok: false, error: "Signal not found" }),
        { status: 404, headers: { ...headers, "Content-Type": "application/json" } }
      );
    }

    const content = signal.content as Record<string, any>;
    const product = content.product || content.what || "";
    const location = content.location || "";
    const signalType = signal.type as "buyer" | "seller";

    // 2. Generate signal embedding for semantic matching
    const signalText = signalToText(signal);
    const signalEmbedding = await generateEmbedding(signalText);
    console.log(`[sr-discover] Signal embedding generated: ${signalEmbedding ? 'success' : 'failed'}`);

    // 3. Generate BASELINE search queries
    const baselineQueries = generateEnhancedQueries(signal);
    console.log(`[sr-discover] Generated ${baselineQueries.length} baseline queries`);

    // 4. Perform BASELINE multi-provider search
    console.log(`[sr-discover] Starting baseline search across Brave, DuckDuckGo, Google, Bing...`);
    const baselineResults = await multiProviderSearch(baselineQueries);
    const baselineCount = baselineResults.length;
    console.log(`[sr-discover] Baseline search returned ${baselineCount} results`);

    // 5. Generate ENRICHED queries using 12% discovery engine
    const enrichedQueryData = generateEnrichedQueries(product, location, signalType, baselineQueries);
    console.log(`[sr-discover] 12% Engine generated ${enrichedQueryData.length} enriched queries`);

    // 6. Perform ENRICHED search
    let enrichedResults: DiscoveryResult[] = [];
    if (enrichedQueryData.length > 0) {
      const enrichedQueries = enrichedQueryData.map(eq => eq.query);
      const rawEnrichedResults = await multiProviderSearch(enrichedQueries);
      
      // Mark enriched results with their reasons
      enrichedResults = rawEnrichedResults.map((r, idx) => {
        const queryIdx = Math.floor(idx / (rawEnrichedResults.length / enrichedQueryData.length));
        const reason = enrichedQueryData[Math.min(queryIdx, enrichedQueryData.length - 1)]?.reason || "12% engine discovery";
        return {
          id: crypto.randomUUID(),
          title: r.title,
          url: r.url,
          description: r.description,
          source: r.source,
          is_enriched: true,
          enrichment_reason: reason,
          confidence_score: 0.55, // Slightly lower initial confidence for enriched
          metadata: { search_query: enrichedQueries[Math.min(queryIdx, enrichedQueries.length - 1)] }
        };
      });
      console.log(`[sr-discover] 12% Engine found ${enrichedResults.length} additional results`);
    }

    // 7. Merge baseline + enriched results
    const mergedResults = mergeResults(baselineResults, enrichedResults);
    console.log(`[sr-discover] Merged to ${mergedResults.length} total results`);

    // 8. Calculate discovery metrics (uplift)
    const metrics = calculateMetrics(baselineCount, mergedResults);
    console.log(`[sr-discover] Uplift: ${metrics.uplift_pct.toFixed(1)}% (${baselineCount} -> ${metrics.enriched_count})`);

    // 9. Parallel crawling of top results with Firecrawl (if enabled)
    const crawlProvider = Deno.env.get("CRAWL_PROVIDER");
    const crawlApiKey = Deno.env.get("CRAWL_API_KEY");

    if (crawlProvider === "firecrawl" && crawlApiKey && mergedResults.length > 0) {
      const topResults = mergedResults.slice(0, 10);
      console.log(`[sr-discover] Parallel crawling ${topResults.length} results with Firecrawl`);
      
      const crawlPromises = topResults.map(result => 
        result.url ? crawlWithFirecrawl(result.url, crawlApiKey) : Promise.resolve(null)
      );
      
      const enrichedDataArray = await Promise.all(crawlPromises);
      topResults.forEach((result, index) => {
        if (enrichedDataArray[index]) {
          result.metadata = { ...result.metadata, enriched: enrichedDataArray[index] };
        }
      });
    }

    // 10. Normalize into options with embeddings and coherence scoring
    const options = await normalizeResultsWithEmbeddings(mergedResults, signal, signalEmbedding);
    console.log(`[sr-discover] Normalized to ${options.length} options with semantic scoring`);

    // Get or create multi-provider web search data source
    let { data: webSource } = await supabase
      .from("data_sources")
      .select("*")
      .eq("type", "web_search")
      .eq("org_id", signal.org_id)
      .single();

    if (!webSource) {
      const { data: newSource } = await supabase
        .from("data_sources")
        .insert({
          name: "Multi-Provider Web Discovery",
          type: "web_search",
          status: "active",
          org_id: signal.org_id,
          config: { 
            providers: ["brave", "duckduckgo", "google", "bing"],
            semantic_matching: true,
            ml_scoring: true,
            discovery_engine_enabled: true
          }
        })
        .select()
        .single();
      webSource = newSource;
    }

    // Fetch historical performance data for ML scoring
    const { data: historicalData } = await supabase
      .from("data_source_performance")
      .select("data_source_id, options_returned, options_selected")
      .eq("org_id", signal.org_id);
    
    const historicalMap: Record<string, any> = {};
    historicalData?.forEach(row => {
      if (!historicalMap[row.data_source_id]) {
        historicalMap[row.data_source_id] = { options_returned: 0, options_selected: 0 };
      }
      historicalMap[row.data_source_id].options_returned += row.options_returned;
      historicalMap[row.data_source_id].options_selected += row.options_selected;
    });

    // 11. Insert options with ML-enhanced scoring and coherence
    for (const option of options) {
      const score = await scoreOption(option, signal, signalEmbedding, historicalMap);
      const coherence = scoreCoherence(signal, option);
      
      await supabase.from("options").insert({
        signal_id: signalId,
        data_source_id: webSource!.id,
        ...option,
        score,
        quality_flags: {
          ...option.quality_flags,
          coherence_score: coherence.score,
          coherence_passed: coherence.passed,
          coherence_factors: coherence.factors,
        }
      });
    }

    console.log(`[sr-discover] Successfully stored ${options.length} options with ML + coherence scoring`);

    // 12. Log audit: sr-discover completed with 12% metrics
    await supabase.from("audit_logs").insert({
      org_id: authCtx.orgId,
      actor_user_id: authCtx.isApiKey ? null : authCtx.userId,
      actor_api_key_id: authCtx.isApiKey ? authCtx.userId : null,
      action: "sr_discover_completed",
      entity_type: "signal",
      entity_id: signalId,
      metadata: {
        baseline_results: baselineCount,
        enriched_results: metrics.enriched_count,
        uplift_pct: metrics.uplift_pct,
        enrichment_reasons: metrics.enrichment_reasons,
        options_created: options.length,
        search_queries: baselineQueries.slice(0, 5),
        enriched_queries: enrichedQueryData.slice(0, 5).map(eq => eq.query),
        data_source_id: webSource!.id,
        providers_used: ["brave", "duckduckgo", "google", "bing"],
        semantic_matching: !!signalEmbedding,
        ml_scoring: true,
        discovery_engine_enabled: true,
        crawl_enabled: crawlProvider === "firecrawl" && !!crawlApiKey,
        timestamp: new Date().toISOString(),
      },
    });

    // Return success with discovery metrics
    return new Response(
      JSON.stringify({ 
        ok: true, 
        baselineResults: baselineCount,
        enrichedResults: metrics.enriched_count,
        upliftPct: Math.round(metrics.uplift_pct * 10) / 10,
        optionsCreated: options.length,
        enrichmentReasons: metrics.enrichment_reasons
      }),
      { status: 200, headers: { ...headers, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[sr-discover] Error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    
    // Log audit: sr-discover error (best effort)
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const supabase = createClient(supabaseUrl, supabaseKey);
      
      const rawBody = await req.clone().json();
      const signalId = rawBody?.signalId;
      
      if (signalId) {
        await supabase.from("audit_logs").insert({
          org_id: "unknown",
          action: "sr_discover_error",
          entity_type: "signal",
          entity_id: signalId,
          metadata: {
            error: errorMessage,
            timestamp: new Date().toISOString(),
          },
        });
      }
    } catch (auditError) {
      console.error("[sr-discover] Failed to log audit error:", auditError);
    }
    
    return new Response(
      JSON.stringify({ ok: false, error: errorMessage }),
      { status: 500, headers: { ...headers, "Content-Type": "application/json" } }
    );
  }
});

// Enhanced normalization with embeddings, semantic scoring, and 12% engine markers
async function normalizeResultsWithEmbeddings(
  results: any[],
  signal: any,
  signalEmbedding: number[] | null
): Promise<any[]> {
  const content = signal.content;
  const normalized = [];
  
  // Process top 30 results
  for (const result of results.slice(0, 30)) {
    const optionText = `${result.title} ${result.description}`;
    const optionEmbedding = await generateEmbedding(optionText);
    
    // Calculate semantic similarity if we have both embeddings
    let confidence = result.confidence_score || 0.6;
    if (signalEmbedding && optionEmbedding) {
      const similarity = cosineSimilarity(signalEmbedding, optionEmbedding);
      confidence = 0.4 + (similarity * 0.6); // Scale to 0.4-1.0
    }
    
    normalized.push({
      what: content.product || content.what || "Product",
      how_much: content.quantity || content.how_much || 1,
      unit: content.unit || "units",
      where_location: extractLocation(result) || content.location || "Global",
      when_available: "Contact for availability",
      price: null,
      currency: content.currency || "USD",
      quality_flags: {
        verified: false,
        web_discovered: true,
        source: result.source || "web",
        multi_provider: true,
        sahpra_verified: false,
        // 12% engine markers
        is_enriched: result.is_enriched || false,
        enrichment_reason: result.enrichment_reason || null,
      },
      confidence_score: confidence,
      source_link: result.url,
      freshness: new Date().toISOString(),
      embedding: optionEmbedding,
      metadata: {
        title: result.title,
        description: result.description,
        search_provider: result.source,
        enriched: result.metadata?.enriched || null,
        is_from_discovery_engine: result.is_enriched || false,
        why_surfaced: result.enrichment_reason || null,
      },
    });
  }
  
  return normalized;
}

// Legacy Brave search function (kept for backward compatibility)
async function searchWithBrave(query: string, apiKey: string): Promise<any[]> {
  try {
    const response = await fetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=20`,
      {
        headers: {
          "Accept": "application/json",
          "X-Subscription-Token": apiKey,
        },
      }
    );

    if (!response.ok) {
      console.error(`[Brave] API error: ${response.status}`);
      return [];
    }

    const data = await response.json();
    return (data.web?.results || []).map((r: any) => ({
      title: r.title,
      url: r.url,
      description: r.description,
      source: "brave",
    }));
  } catch (error) {
    console.error(`[Brave] Search error:`, error);
    return [];
  }
}

async function crawlWithFirecrawl(url: string, apiKey: string): Promise<any | null> {
  try {
    const response = await fetch("https://api.firecrawl.dev/v0/scrape", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url }),
    });

    if (!response.ok) {
      console.error(`[Firecrawl] API error for ${url}: ${response.status}`);
      return null;
    }

    const data = await response.json();
    return {
      markdown: data.data?.markdown,
      metadata: data.data?.metadata,
    };
  } catch (error) {
    console.error(`[Firecrawl] Crawl error for ${url}:`, error);
    return null;
  }
}

// Legacy normalization (kept for backward compatibility)
function normalizeResults(results: any[], signal: any): any[] {
  const content = signal.content;
  
  return results.slice(0, 20).map(result => ({
    what: content.product || content.what || "Product",
    how_much: content.quantity || content.how_much || 1,
    unit: content.unit || "units",
    where_location: extractLocation(result) || content.location || "Unknown",
    when_available: "Contact for availability",
    price: null,
    currency: content.currency || "USD",
    quality_flags: {
      verified: false,
      web_discovered: true,
      source: result.source || "web",
      sahpra_verified: false,
    },
    confidence_score: 0.5,
    source_link: result.url,
    freshness: new Date().toISOString(),
    metadata: {
      title: result.title,
      description: result.description,
      enriched: result.enriched || null,
    },
  }));
}

function extractLocation(result: any): string | null {
  const text = `${result.title} ${result.description}`.toLowerCase();
  const locations = ["south africa", "johannesburg", "cape town", "durban", "pretoria"];
  
  for (const loc of locations) {
    if (text.includes(loc)) {
      return loc;
    }
  }
  
  return null;
}
