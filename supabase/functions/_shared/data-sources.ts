// Data source search logic
import { scoreOptionSync } from "./scoring.ts";
import { logPerformance, getSourceRankings } from "./performance.ts";

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

    // Get performance-based rankings
    const rankings = await getSourceRankings(supabase, orgId, {
      productCategory: signal.content.product,
      location: signal.content.location,
      signalType: signal.type,
    });

    // Sort data sources by ranking (if available)
    if (rankings.length > 0) {
      dataSources.sort((a: any, b: any) => {
        const rankA = rankings.find(r => r.dataSourceId === a.id);
        const rankB = rankings.find(r => r.dataSourceId === b.id);
        if (!rankA && !rankB) return 0;
        if (!rankA) return 1;
        if (!rankB) return -1;
        return rankB.score - rankA.score;
      });
      console.log(`[${signalId}] Prioritized sources based on historical performance`);
    }

    // Query each data source
    for (const dataSource of dataSources) {
      console.log(`[${signalId}] Querying ${dataSource.name} (${dataSource.type})`);

      let options: any[] = [];
      const startTime = Date.now();

      try {
        if (dataSource.type === "http" && dataSource.config?.base_url) {
          // SSRF guard: only allow https:// to public hosts. Reject any
          // localhost / loopback / link-local / RFC1918 / cloud-metadata target.
          // We never forward INTERNAL_SEARCH_KEY (or any other platform secret)
          // to org-controlled URLs — third-party providers must authenticate
          // via their own per-source headers in `config.headers`.
          if (!isPublicHttpsUrl(dataSource.config.base_url)) {
            console.error(
              `[${signalId}] Rejecting data source "${dataSource.name}" — base_url is not a public https URL`,
            );
            continue;
          }

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
              // Per-source headers only. Platform-internal keys are intentionally
              // NOT included — those would leak to attacker-controlled endpoints.
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
          // Non-HTTP sources without an endpoint cannot produce real results - skip
          console.log(`[${signalId}] Skipping non-HTTP data source "${dataSource.name}" - no endpoint configured`);
          continue;
        }

        // Insert options with scores
        for (const opt of options) {
          const score = scoreOptionSync(opt, signal);

          await supabase.from("options").insert({
            signal_id: signalId,
            data_source_id: dataSource.id,
            ...opt,
            score,
          });
        }

        // Update last queried time
        await supabase.from("data_sources").update({ last_queried_at: new Date().toISOString() }).eq("id", dataSource.id);

        // Log performance
        const responseTime = Date.now() - startTime;
        await logPerformance(supabase, {
          dataSourceId: dataSource.id,
          signalId,
          orgId,
          optionsReturned: options.length,
          optionsSelected: 0, // Will be updated when option is selected
          responseTimeMs: responseTime,
          searchSuccess: options.length > 0,
          productCategory: signal.content.product,
          location: signal.content.location,
          signalType: signal.type,
        });
      } catch (error) {
        console.error(`[${signalId}] Error querying ${dataSource.name}:`, error);
        
        // Log failure
        const responseTime = Date.now() - startTime;
        await logPerformance(supabase, {
          dataSourceId: dataSource.id,
          signalId,
          orgId,
          optionsReturned: 0,
          optionsSelected: 0,
          responseTimeMs: responseTime,
          searchSuccess: false,
          productCategory: signal.content.product,
          location: signal.content.location,
          signalType: signal.type,
        });
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
      console.error(`[${signalId}] Web search failed: ${searchResponse.status} - returning empty results (no synthetic data)`);
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
        webSearchSource = { data: newSource } as any;
      }

      // Convert web search results to options
      let insertedCount = 0;
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
            source: result.source,
            sahpra_verified: false, // Web results default to not verified
            contact: result.contact,
            relevance: result.relevance
          },
          confidence_score: result.confidence,
          source_link: result.sourceLink,
          freshness: new Date().toISOString()
        };

        const score = scoreOptionSync(option, signal);

        const { error: insertError } = await supabase.from("options").insert({
          signal_id: signalId,
          data_source_id: webSearchSource.data.id,
          what: option.what,
          how_much: option.how_much,
          unit: option.unit,
          where_location: option.where_location,
          when_available: option.when_available,
          price: option.price,
          currency: option.currency,
          quality_flags: option.quality_flags,
          confidence_score: option.confidence_score,
          source_link: option.source_link,
          freshness: option.freshness,
          score
        });

        if (insertError) {
          console.error(`[${signalId}] Failed to insert option:`, insertError);
        } else {
          insertedCount++;
        }
      }

      console.log(`[${signalId}] Inserted ${insertedCount}/${searchData.results.length} web-discovered options`);
    } else {
      console.log(`[${signalId}] Web search returned no results - no synthetic fallback`);
    }
  } catch (error) {
    console.error(`[${signalId}] Web search execution failed:`, error);
  }
}
