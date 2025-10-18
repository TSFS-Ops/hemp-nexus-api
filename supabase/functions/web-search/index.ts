import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { signal, searchType = "buyers" } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY not configured");
    }

    console.log(`[web-search] Searching for ${searchType} based on signal:`, signal.content);

    // Construct search queries based on signal content
    const queries = generateSearchQueries(signal, searchType);
    console.log(`[web-search] Generated ${queries.length} search queries:`, queries);

    const allResults: any[] = [];

    // Execute searches and use AI to parse results
    for (const query of queries) {
      console.log(`[web-search] Executing query: "${query}"`);
      
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

      const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
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
        })
      });

      if (!aiResponse.ok) {
        console.error(`[web-search] AI search failed: ${aiResponse.status}`);
        continue;
      }

      const aiData = await aiResponse.json();
      const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
      
      if (toolCall?.function?.arguments) {
        const parsed = JSON.parse(toolCall.function.arguments);
        if (parsed.results && Array.isArray(parsed.results)) {
          console.log(`[web-search] Found ${parsed.results.length} results for query: "${query}"`);
          allResults.push(...parsed.results);
        }
      }
    }

    // Deduplicate and rank results
    const uniqueResults = deduplicateResults(allResults);
    const rankedResults = rankResults(uniqueResults, signal);

    console.log(`[web-search] Total unique results: ${uniqueResults.length}, Top ranked: ${rankedResults.length}`);

    return new Response(
      JSON.stringify({
        success: true,
        query: signal.content,
        resultsCount: rankedResults.length,
        results: rankedResults,
        searchQueries: queries
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[web-search] Error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error"
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      }
    );
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
