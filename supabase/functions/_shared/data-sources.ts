// Data source search logic
import { scoreOption, generateMockOptions } from "./scoring.ts";

export async function searchDataSources(signalId: string, orgId: string, supabase: any) {
  console.log(`[${signalId}] Starting background search for signal`);

  try {
    // Get signal
    const { data: signal } = await supabase.from("signals").select("*").eq("id", signalId).single();

    if (!signal) return;

    // Get active data sources
    const { data: dataSources } = await supabase
      .from("data_sources")
      .select("*")
      .eq("status", "active")
      .eq("org_id", orgId);

    if (!dataSources || dataSources.length === 0) {
      console.log(`[${signalId}] No active data sources found`);
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
