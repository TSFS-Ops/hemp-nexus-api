import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders } from "../_shared/cors.ts";
import { scoreOption } from "../_shared/scoring.ts";
import { validateApiKey } from "../_shared/api-key-middleware.ts";

const headers = corsHeaders('*');

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers });
  }

  // Validate API key
  const authError = validateApiKey(req);
  if (authError) return authError;

  try {
    const { signalId } = await req.json();

    if (!signalId) {
      return new Response(
        JSON.stringify({ ok: false, error: "signalId required" }),
        { status: 400, headers: { ...headers, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // 1. Read the signal
    console.log(`[sr-discover] Reading signal ${signalId}`);
    const { data: signal, error: signalError } = await supabase
      .from("signals")
      .select("*")
      .eq("id", signalId)
      .single();

    if (signalError || !signal) {
      console.error(`[sr-discover] Signal not found:`, signalError);
      return new Response(
        JSON.stringify({ ok: false, error: "Signal not found" }),
        { status: 404, headers: { ...headers, "Content-Type": "application/json" } }
      );
    }

    // 2. Use Brave to search
    const searchApiKey = Deno.env.get("SEARCH_API_KEY");
    const searchProvider = Deno.env.get("SEARCH_PROVIDER") || "brave";

    if (!searchApiKey) {
      console.error(`[sr-discover] SEARCH_API_KEY not configured`);
      return new Response(
        JSON.stringify({ ok: false, error: "Search API not configured" }),
        { status: 500, headers: { ...headers, "Content-Type": "application/json" } }
      );
    }

    const searchQueries = generateSearchQueries(signal);
    console.log(`[sr-discover] Generated ${searchQueries.length} search queries`);

    const allResults: any[] = [];

    for (const query of searchQueries) {
      console.log(`[sr-discover] Searching: ${query}`);
      
      if (searchProvider === "brave") {
        const braveResults = await searchWithBrave(query, searchApiKey);
        allResults.push(...braveResults);
      }
    }

    console.log(`[sr-discover] Found ${allResults.length} total results`);

    // 3. Optionally crawl top results with Firecrawl
    const crawlProvider = Deno.env.get("CRAWL_PROVIDER");
    const crawlApiKey = Deno.env.get("CRAWL_API_KEY");

    if (crawlProvider === "firecrawl" && crawlApiKey && allResults.length > 0) {
      console.log(`[sr-discover] Enriching top ${Math.min(5, allResults.length)} results with Firecrawl`);
      const topResults = allResults.slice(0, 5);
      
      for (const result of topResults) {
        if (result.url) {
          const enrichedData = await crawlWithFirecrawl(result.url, crawlApiKey);
          if (enrichedData) {
            result.enriched = enrichedData;
          }
        }
      }
    }

    // 4. Normalize into options and attach to signal
    const options = normalizeResults(allResults, signal);
    console.log(`[sr-discover] Normalized to ${options.length} options`);

    // Get or create web search data source
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
          name: "Brave Search Discovery",
          type: "web_search",
          status: "active",
          org_id: signal.org_id,
          config: { provider: searchProvider }
        })
        .select()
        .single();
      webSource = newSource;
    }

    // Insert options
    for (const option of options) {
      const score = scoreOption(option, signal);
      await supabase.from("options").insert({
        signal_id: signalId,
        data_source_id: webSource!.id,
        ...option,
        score,
      });
    }

    console.log(`[sr-discover] Successfully stored ${options.length} options`);

    // 5. Return success
    return new Response(
      JSON.stringify({ 
        ok: true, 
        resultsFound: allResults.length,
        optionsCreated: options.length 
      }),
      { status: 200, headers: { ...headers, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[sr-discover] Error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ ok: false, error: errorMessage }),
      { status: 500, headers: { ...headers, "Content-Type": "application/json" } }
    );
  }
});

function generateSearchQueries(signal: any): string[] {
  const content = signal.content;
  const product = content.product || content.what || "";
  const location = content.location || content.where_location || "";
  
  const queries = [
    `${product} suppliers ${location}`,
    `buy ${product} ${location}`,
    `${product} wholesalers ${location}`,
  ];

  return queries.filter(q => q.trim().length > 0).slice(0, 3);
}

async function searchWithBrave(query: string, apiKey: string): Promise<any[]> {
  try {
    const response = await fetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=10`,
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

function normalizeResults(results: any[], signal: any): any[] {
  const content = signal.content;
  
  return results.map(result => ({
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
