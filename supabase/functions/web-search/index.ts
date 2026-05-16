import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { webSearchSchema, validateInput } from "../_shared/validation.ts";
import { authenticateRequest, requireScope } from "../_shared/auth.ts";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { errorResponse, ApiException } from "../_shared/errors.ts";
import { cached, cacheHeaders } from "../_shared/cache.ts";
import { guardedAiCall, aiGuardEnvelope } from "../_shared/ai-guard.ts";

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  const allowedOrigins = Deno.env.get('ALLOWED_ORIGINS') || '*';
  const origin = req.headers.get('origin');
  const headers = corsHeaders(allowedOrigins, origin);

  try {
    // Handle CORS preflight
    const corsResponse = handleCors(req, allowedOrigins);
    if (corsResponse) return corsResponse;

    // Authenticate request
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const authCtx = await authenticateRequest(req, supabaseUrl, supabaseKey);
    
    // Require signals:read scope for API keys
    if (authCtx.isApiKey) {
      requireScope(authCtx, 'signals:read');
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // Simple rate limiting: Check recent AI searches for this org (cached 30s to reduce DB load)
    const recentSearches = await cached<number>(
      `rate:web-search:${authCtx.orgId}`,
      30,
      async () => {
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
        const { count } = await supabase
          .from('audit_logs')
          .select('*', { count: 'exact', head: true })
          .eq('org_id', authCtx.orgId)
          .eq('action', 'ai.web_search')
          .gte('created_at', fiveMinutesAgo);
        return count ?? 0;
      }
    );

    if (recentSearches && recentSearches >= 10) {
      throw new ApiException(
        'RATE_LIMIT_EXCEEDED',
        'Too many AI searches. Please wait a few minutes.',
        429
      );
    }

    const rawBody = await req.json();
    
    let validatedData;
    try {
      validatedData = validateInput(webSearchSchema, rawBody);
    } catch (error) {
      throw new ApiException(
        'VALIDATION_ERROR',
        error instanceof Error ? error.message : 'Invalid input',
        400
      );
    }

    const { signal, searchType = "buyers" } = validatedData;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

    if (!LOVABLE_API_KEY) {
      throw new ApiException('CONFIGURATION_ERROR', 'LOVABLE_API_KEY not configured', 500);
    }

    console.log(`[${requestId}] Searching for ${searchType} based on signal:`, signal.content);
    
    // Log AI usage to audit trail
    await supabase.from('audit_logs').insert({
      org_id: authCtx.orgId,
      actor_user_id: authCtx.isApiKey ? null : authCtx.userId,
      actor_api_key_id: authCtx.isApiKey ? authCtx.userId : null,
      action: 'ai.web_search',
      entity_type: 'signal',
      entity_id: null,
      metadata: {
        searchType,
        product: signal.content.what || signal.content.product,
        location: signal.content.where || signal.content.location,
        requestId
      }
    });

    // Construct search queries based on signal content
    const queries = generateSearchQueries(signal, searchType);
    console.log(`[${requestId}] Generated ${queries.length} search queries:`, queries);

    const allResults: any[] = [];

    // Execute searches and use AI to parse results
    for (const query of queries) {
      console.log(`[${requestId}] Executing query: "${query}"`);
      
      // Use AI to search and parse web results
      const searchPrompt = `Search the web for: "${query}"
      
Context: We're looking for ${searchType} of ${signal.content.what || signal.content.product} in ${signal.content.where || signal.content.location}.

Instructions:
1. Find real companies, marketplaces, or platforms that match this search
2. Extract: company name, contact info, location, relevance score
3. Return ONLY real, verifiable results
4. Prioritize legal, licensed operators in legal jurisdictions
5. Include confidence score (0-1) based on result quality

Format each result as JSON:
{
  "source": "company/platform name",
  "location": "country/region",
  "contact": "email/website",
  "relevance": "why this matches the signal",
  "confidence": 0.0-1.0,
  "sourceLink": "url where found"
}`;

      const aiOutcome = await guardedAiCall(supabase as any, {
        org_id: authCtx.orgId,
        call_type: "web_search",
        body: {
          model: "google/gemini-2.5-flash",
          messages: [
            {
              role: "system",
              content: "You are a web search and data extraction expert. Parse web search results and extract structured business information. Return ONLY valid JSON arrays of results. Be precise and verify information quality."
            },
            {
              role: "user",
              content: searchPrompt
            }
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "extract_search_results",
                description: "Extract structured buyer/seller information from web search",
                parameters: {
                  type: "object",
                  properties: {
                    results: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          source: { type: "string" },
                          location: { type: "string" },
                          contact: { type: "string" },
                          relevance: { type: "string" },
                          confidence: { type: "number" },
                          sourceLink: { type: "string" }
                        },
                        required: ["source", "location", "confidence", "sourceLink"]
                      }
                    }
                  },
                  required: ["results"]
                }
              }
            }
          ],
          tool_choice: { type: "function", function: { name: "extract_search_results" } }
        },
      });

      if (aiOutcome.kind === "cooldown" || aiOutcome.kind === "quota_exceeded") {
        // Stop the loop — return what we have so far with a typed envelope.
        const env = aiGuardEnvelope(aiOutcome);
        return new Response(
          JSON.stringify({
            ...(env.body as Record<string, unknown>),
            partial_results: rankResults(deduplicateResults(allResults), signal),
            requestId,
          }),
          { status: env.status, headers: { ...headers, "Content-Type": "application/json" } }
        );
      }

      if (aiOutcome.kind !== "ok") {
        console.error(`[${requestId}] AI search failed: ${aiOutcome.kind}`);
        continue;
      }

      const aiData = aiOutcome.body as any;
      const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];

      if (toolCall?.function?.arguments) {
        const parsed = JSON.parse(toolCall.function.arguments);
        if (parsed.results && Array.isArray(parsed.results)) {
          console.log(`[${requestId}] Found ${parsed.results.length} results for query: "${query}"`);
          allResults.push(...parsed.results);
        }
      }
    }

    // Deduplicate and rank results
    const uniqueResults = deduplicateResults(allResults);
    const rankedResults = rankResults(uniqueResults, signal);

    console.log(`[${requestId}] Total unique results: ${uniqueResults.length}, Top ranked: ${rankedResults.length}`);

    return new Response(
      JSON.stringify({
        success: true,
        query: signal.content,
        resultsCount: rankedResults.length,
        results: rankedResults,
        searchQueries: queries,
        requestId
      }),
      { headers: { ...headers, ...cacheHeaders("private-short"), "Content-Type": "application/json" } }
    );

  } catch (error) {
    return errorResponse(error as Error, requestId, headers);
  }
});

function generateSearchQueries(signal: any, searchType: string): string[] {
  const product = signal.content.what || signal.content.product || "cannabis";
  const location = signal.content.where || signal.content.location || "";
  const quantity = signal.content.how_much || signal.content.quantity || "";

  const queries: string[] = [];

  // Core product search
  queries.push(`${product} ${searchType} ${location}`.trim());
  
  // Licensed/legal operators
  queries.push(`licensed ${product} ${searchType} ${location}`.trim());
  
  // Marketplaces and platforms
  queries.push(`${product} marketplace ${location}`.trim());
  queries.push(`${product} B2B platform ${location}`.trim());
  
  // Industry specific
  if (product.toLowerCase().includes("hemp") || product.toLowerCase().includes("cannabis")) {
    queries.push(`hemp ${searchType} legal countries`);
    queries.push(`cannabis wholesale ${searchType} ${location}`.trim());
    queries.push(`CBD ${searchType} ${location}`.trim());
  }

  // Wholesale/bulk if quantity specified
  if (quantity) {
    queries.push(`${product} wholesale ${searchType} ${quantity} ${location}`.trim());
  }

  return queries.filter(q => q.length > 0).slice(0, 5); // Limit to 5 queries
}

function deduplicateResults(results: any[]): any[] {
  const seen = new Set<string>();
  const unique: any[] = [];

  for (const result of results) {
    const key = `${result.source?.toLowerCase()}-${result.location?.toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(result);
    }
  }

  return unique;
}

function rankResults(results: any[], signal: any): any[] {
  // Sort by confidence score
  return results
    .sort((a, b) => (b.confidence || 0) - (a.confidence || 0))
    .slice(0, 20); // Return top 20 results
}
