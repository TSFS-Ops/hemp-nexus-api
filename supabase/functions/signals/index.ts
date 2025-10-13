import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { errorResponse, ApiException } from "../_shared/errors.ts";
import { authenticateRequest } from "../_shared/auth.ts";
import { validateApiKey } from "../_shared/api-key-middleware.ts";

// Simple scoring algorithm for options
function scoreOption(option: any, signal: any): number {
  let score = 0;

  // Freshness (0-30 points): newer is better
  const ageMs = Date.now() - new Date(option.freshness).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  score += Math.max(0, 30 - ageDays * 3);

  // Confidence (0-30 points)
  score += (option.confidence_score || 0) * 30;

  // Price fit (0-20 points)
  if (signal.content.price_budget && option.price) {
    const priceDiff = Math.abs(option.price - signal.content.price_budget) / signal.content.price_budget;
    score += Math.max(0, 20 - priceDiff * 20);
  }

  // Quality match (0-20 points): simple flag check
  score += Object.keys(option.quality_flags || {}).length * 5;

  return Math.min(100, score);
}

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  const allowedOrigins = Deno.env.get("ALLOWED_ORIGINS") || "*";
  const headers = corsHeaders(allowedOrigins);

  try {
    const corsResponse = handleCors(req, allowedOrigins);
    if (corsResponse) return corsResponse;

    const url = new URL(req.url);
    const pathParts = url.pathname.split("/").filter(Boolean);

    // Check if this is a /v1/* endpoint and validate API key
    if (pathParts.length > 0 && pathParts[0] === "v1") {
      const apiKeyError = validateApiKey(req);
      if (apiKeyError) return apiKeyError;
      // Remove 'v1' from path for processing
      pathParts.shift();
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const authCtx = await authenticateRequest(req, supabaseUrl, supabaseKey);

    // POST /signals - Create new signal and trigger search
    if (req.method === "POST" && pathParts.length === 1) {
      const { product, quantity, unit, location, deliveryWindow, budget, notes } = await req.json();

      if (!product || !quantity) {
        throw new ApiException("VALIDATION_ERROR", "Product and quantity are required", 400);
      }

      // Build content object from new schema
      const content = {
        product,
        quantity,
        unit,
        location,
        deliveryWindow,
        budget,
        notes,
      };

      const { data: signal, error } = await supabase
        .from("signals")
        .insert({
          org_id: authCtx.orgId,
          type: "buyer", // Default to buyer
          content,
          expires_at: deliveryWindow?.end || null,
          created_by: authCtx.userId || null,
        })
        .select()
        .single();

      if (error) throw error;

      // Trigger background search across data sources (fire and forget)
      searchDataSources(signal.id, authCtx.orgId, supabase);

      await supabase.from("audit_logs").insert({
        org_id: authCtx.orgId,
        actor_user_id: authCtx.userId || null,
        action: "signal.created",
        entity_type: "signal",
        entity_id: signal.id,
        metadata: { product, quantity, unit },
      });

      return new Response(
        JSON.stringify({
          signalId: signal.id,
          options: [],
        }),
        { status: 201, headers: { "Content-Type": "application/json", ...headers } },
      );
    }

    // GET /signals - List signals
    if (req.method === "GET" && pathParts.length === 1) {
      const limit = parseInt(url.searchParams.get("limit") || "50");
      const status = url.searchParams.get("status");

      let query = supabase
        .from("signals")
        .select("*")
        .eq("org_id", authCtx.orgId)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (status) {
        query = query.eq("status", status);
      }

      const { data, error } = await query;
      if (error) throw error;

      return new Response(JSON.stringify({ data }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...headers },
      });
    }

    // GET /signals/:id - Get signal with options
    if (req.method === "GET" && pathParts.length === 2) {
      const signalId = pathParts[1];

      const { data: signal, error: signalError } = await supabase
        .from("signals")
        .select("*")
        .eq("id", signalId)
        .eq("org_id", authCtx.orgId)
        .single();

      if (signalError) throw signalError;

      const { data: options, error: optionsError } = await supabase
        .from("options")
        .select("*, data_source:data_sources(name, type)")
        .eq("signal_id", signalId)
        .order("score", { ascending: false });

      if (optionsError) throw optionsError;

      return new Response(JSON.stringify({ signal, options }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...headers },
      });
    }

    // POST /signals/:id/select - Select an option and hand off
    if (req.method === "POST" && pathParts.length === 3 && pathParts[2] === "select") {
      const signalId = pathParts[1];
      const { option_id } = await req.json();

      if (!option_id) {
        throw new ApiException("VALIDATION_ERROR", "option_id is required", 400);
      }

      // Verify signal belongs to org
      const { data: signal } = await supabase
        .from("signals")
        .select("*")
        .eq("id", signalId)
        .eq("org_id", authCtx.orgId)
        .single();

      if (!signal) {
        throw new ApiException("NOT_FOUND", "Signal not found", 404);
      }

      // Get option and data source
      const { data: option } = await supabase
        .from("options")
        .select("*, data_source:data_sources(*)")
        .eq("id", option_id)
        .eq("signal_id", signalId)
        .single();

      if (!option) {
        throw new ApiException("NOT_FOUND", "Option not found", 404);
      }

      // Generate short-lived handoff token
      const handoffToken = crypto.randomUUID();

      const { data: selection, error } = await supabase
        .from("selections")
        .insert({
          signal_id: signalId,
          option_id,
          selected_by: authCtx.userId || null,
          handoff_token: handoffToken,
          handoff_data: {
            data_source_id: option.data_source.id,
            data_source_type: option.data_source.type,
            source_link: option.source_link,
          },
        })
        .select()
        .single();

      if (error) throw error;

      // Update signal status
      await supabase.from("signals").update({ status: "matched" }).eq("id", signalId);

      await supabase.from("audit_logs").insert({
        org_id: authCtx.orgId,
        actor_user_id: authCtx.userId || null,
        action: "signal.option_selected",
        entity_type: "selection",
        entity_id: selection.id,
        metadata: { signal_id: signalId, option_id },
      });

      return new Response(
        JSON.stringify({
          selection_id: selection.id,
          handoff_token: handoffToken,
          handoff_url: option.source_link,
          message: "Option selected. Handoff to source system.",
        }),
        { status: 200, headers: { "Content-Type": "application/json", ...headers } },
      );
    }

    // DELETE /signals/:id - Cancel signal
    if (req.method === "DELETE" && pathParts.length === 2) {
      const signalId = pathParts[1];

      const { error } = await supabase
        .from("signals")
        .update({ status: "expired" })
        .eq("id", signalId)
        .eq("org_id", authCtx.orgId);

      if (error) throw error;

      return new Response(null, { status: 204, headers });
    }

    throw new ApiException("NOT_FOUND", "Endpoint not found", 404);
  } catch (error) {
    return errorResponse(error as Error, requestId, headers);
  }
});

// Background function to search data sources
async function searchDataSources(signalId: string, orgId: string, supabase: any) {
  console.log(`[${signalId}] Starting background search for signal`);

  try {
    // Get signal
    const { data: signal } = await supabase.from("signals").select("*").eq("id", signalId).single();

    if (!signal) return;

    // Get active data sources (now querying data_sources directly for enabled sources)
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

// Generate mock options (replace with real API calls)
function generateMockOptions(signal: any, dataSource: any): any[] {
  const baseOption = {
    what: signal.content.what || "Product",
    how_much: signal.content.how_much,
    unit: signal.content.unit || "kg",
    where_location: signal.content.where || "Unknown",
    when_available: "Available now",
    price: signal.content.price_budget ? signal.content.price_budget * (0.9 + Math.random() * 0.2) : 100,
    currency: "USD",
    quality_flags: { certified: true, tested: true },
    confidence_score: 0.8,
    source_link: `https://example.com/${dataSource.id}`,
  };

  return [baseOption];
}

// redeploy with external data source support
