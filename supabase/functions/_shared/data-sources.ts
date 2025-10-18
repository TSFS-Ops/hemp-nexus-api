// Data source search logic
import { scoreOption, generateMockOptions } from "./scoring.ts";

export async function searchDataSources(signalId: string, orgId: string, supabase: any) {
  console.log(`[${signalId}] Starting background search for signal`);

  try {
    // Get signal
    const { data: signal } = await supabase.from("signals").select("*").eq("id", signalId).single();

    if (!signal) return;

    // FIRST: Execute real web search using AI
    console.log(`[${signalId}] Initiating AI-powered web search`);
    await executeWebSearch(signalId, signal, supabase);

    // SECOND: Get active data sources
    const { data: dataSources } = await supabase
      .from("data_sources")
      .select("*")
      .eq("status", "active")
      .eq("org_id", orgId);

    if (!dataSources || dataSources.length === 0) {
      console.log(`[${signalId}] No active data sources found (web search already completed)`);
      return;
    }

    console.log(`[${signalId}] Found ${dataSources.length} active data sources`);

    const internalKey = Deno.env.get("INTERNAL_SEARCH_KEY");

    // Query each data source
    for (const dataSource of dataSources) {
      console.log(`[${signalId}] Querying ${dataSource.name} (${dataSource.type})`);

      let options: any[] = [];

      try {
        if (dataSource.type === "http" && dataSource.config?.base_url) {
          // Call external HTTP endpoint
          const requestPayload = {
            signalId,
            product: signal.content.product,
            quantity: signal.content.quantity,
            unit: signal.content.unit,
            location: signal.content.location,
            deliveryWindow: signal.content.deliveryWindow,
            budget: signal.content.budget,
            notes: signal.content.notes,
          };

          console.log(`[${signalId}] Calling ${dataSource.config.base_url}`);

          const response = await fetch(dataSource.config.base_url, {
            method: dataSource.config.method || "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Internal-Key": internalKey || "",
              ...(dataSource.config.headers || {}),
            },
            body: JSON.stringify(requestPayload),
          });

          if (!response.ok) {
            console.error(`[${signalId}] HTTP ${response.status} from ${dataSource.name}`);
            continue;
          }

          const result = await response.json();
          options = result.options || [];
          console.log(`[${signalId}] Received ${options.length} options from ${dataSource.name}`);
        } else {
          // Use mock data for non-HTTP sources
          options = generateMockOptions(signal, dataSource);
        }

        // Insert options with scores
        for (const opt of options) {
          const score = scoreOption(opt, signal);

          await supabase.from("options").insert({
            signal_id: signalId,
            data_source_id: dataSource.id,
            ...opt,
            score,
          });
        }

        // Update last queried time
        await supabase.from("data_sources").update({ last_queried_at: new Date().toISOString() }).eq("id", dataSource.id);
      } catch (error) {
        console.error(`[${signalId}] Error querying ${dataSource.name}:`, error);
      }
    }

    console.log(`[${signalId}] Background search complete`);
  } catch (error) {
    console.error(`[${signalId}] Background search failed:`, error);
  }
}

async function executeWebSearch(signalId: string, signal: any, supabase: any) {
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      console.error(`[${signalId}] Missing Supabase credentials for web search`);
      return;
    }

    console.log(`[${signalId}] Calling web-search function`);
    
    const searchResponse = await fetch(`${SUPABASE_URL}/functions/v1/web-search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        signal,
        searchType: "buyers"
      })
    });

    if (!searchResponse.ok) {
      console.error(`[${signalId}] Web search failed: ${searchResponse.status}`);
      return;
    }

    const searchData = await searchResponse.json();
    console.log(`[${signalId}] Web search found ${searchData.resultsCount} results`);

    if (searchData.results && searchData.results.length > 0) {
      // Create a virtual "web-search" data source entry
      let webSearchSource = await supabase
        .from("data_sources")
        .select("*")
        .eq("type", "web_search")
        .eq("name", "AI Web Search")
        .single();

      if (!webSearchSource.data) {
        const { data: newSource } = await supabase
          .from("data_sources")
          .insert({
            name: "AI Web Search",
            type: "web_search",
            status: "active",
            org_id: signal.org_id,
            config: { description: "AI-powered web crawling and discovery" }
          })
          .select()
          .single();
        
        webSearchSource = { data: newSource };
      }

      // Convert web search results to options
      for (const result of searchData.results) {
        const option = {
          what: signal.content.what || signal.content.product,
          how_much: signal.content.how_much || signal.content.quantity,
          unit: signal.content.unit,
          where_location: result.location,
          when_available: "Contact for availability",
          price: null,
          currency: signal.content.currency || "USD",
          quality_flags: {
            verified: false,
            web_discovered: true,
            source: result.source
          },
          confidence_score: result.confidence,
          source_link: result.sourceLink,
          freshness: new Date().toISOString(),
          metadata: {
            contact: result.contact,
            relevance: result.relevance,
            search_queries: searchData.searchQueries
          }
        };

        const score = scoreOption(option, signal);

        await supabase.from("options").insert({
          signal_id: signalId,
          data_source_id: webSearchSource.data.id,
          ...option,
          score,
        });
      }

      console.log(`[${signalId}] Inserted ${searchData.results.length} web-discovered options`);
    }
  } catch (error) {
    console.error(`[${signalId}] Web search execution failed:`, error);
  }
}
