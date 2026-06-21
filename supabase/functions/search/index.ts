import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { authenticateRequest, requireScope } from "../_shared/auth.ts";
import { enforceTokenMetering } from "../_shared/token-metering.ts";
import { errorResponse } from "../_shared/errors.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  const allowedOrigins = Deno.env.get("ALLOWED_ORIGINS") || '';
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

    // ── FAILURE MODE 5: Corrupted request body ──
    let rawBody: any;
    try {
      rawBody = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ ok: false, error: "Invalid JSON in request body" }),
        { status: 400, headers: { ...headers, "Content-Type": "application/json" } }
      );
    }
    const { query, role, limit = 20, location: filterLocation } = rawBody;

    if (!query || typeof query !== "string") {
      return new Response(
        JSON.stringify({ ok: false, error: "Query is required" }),
        { status: 400, headers: { ...headers, "Content-Type": "application/json" } }
      );
    }

    // ── FAILURE MODE 4: Oversized / malicious input ──
    if (query.length > 500) {
      return new Response(
        JSON.stringify({ ok: false, error: "Query too long (max 500 characters)" }),
        { status: 400, headers: { ...headers, "Content-Type": "application/json" } }
      );
    }
    if (typeof filterLocation === "string" && filterLocation.length > 200) {
      return new Response(
        JSON.stringify({ ok: false, error: "Location too long (max 200 characters)" }),
        { status: 400, headers: { ...headers, "Content-Type": "application/json" } }
      );
    }

    // Parse intent
    // OWNERSHIP: `signalType` is the **initiator's own side** (= the
    // searching user's own buyer/seller stance), normalised by either the
    // explicit "I am a buyer/seller" toggle (`role` param) or by free-text
    // heuristics ("looking for buyers" → searcher is a SELLER). It is
    // NEVER the counterparty's side. Downstream this value is exposed on
    // the wire as `parsedQuery.role` / `parsed_role` / `signal_type`,
    // each of which carries the same "initiator's own side" meaning —
    // see src/lib/role-confirmation.ts:21-30 for the client-side contract.
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
    const parseTokens = tsQuery ? tsQuery.split(" & ").length : 0;

    let counterpartyResults: any[] = [];
    let ftsResultCount = 0;
    let ilikeFallbackUsed = false;
    let ilikeResultCount = 0;

    if (tsQuery) {
      let cpQuery = supabase
        .from("counterparties")
        .select("id, company_name, website, jurisdiction, registration_number, product_categories, description, verified, org_id, created_at")
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
      ftsResultCount = counterpartyResults.length;
    }

    // If FTS returned nothing, try a simple ILIKE fallback
    if (counterpartyResults.length === 0 && product) {
      ilikeFallbackUsed = true;
      let fallbackQuery = supabase
        .from("counterparties")
        .select("id, company_name, website, jurisdiction, registration_number, product_categories, description, verified, org_id, created_at")
        .neq("org_id", authCtx.orgId)
        .or(`company_name.ilike.%${product.replace(/[%_\\]/g, "")}%,description.ilike.%${product.replace(/[%_\\]/g, "")}%`)
        .limit(limit);

      if (effectiveLocation) {
        fallbackQuery = fallbackQuery.ilike("jurisdiction", `%${effectiveLocation.replace(/[%_\\]/g, "")}%`);
      }

      const { data: fallbackData } = await fallbackQuery;
      counterpartyResults = fallbackData || [];
      ilikeResultCount = counterpartyResults.length;
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

    // ── 3. Web Discovery (Brave + AI enrichment) ──
    let webDiscoveryResults: any[] = [];
    let webDiscoveryCount = 0;

    const searchApiKey = Deno.env.get("SEARCH_API_KEY");
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");

    // Only run web discovery if we have the necessary keys and product is meaningful
    if (searchApiKey && lovableApiKey && product && product.length >= 2) {
      try {
        const searchRole = signalType === "buyer" ? "suppliers" : "buyers";
        const searchQuery = `${product} ${searchRole}${effectiveLocation ? ` ${effectiveLocation}` : ""} company`;
        
        console.log(`[search] Web discovery query: "${searchQuery}"`);

        // Search Brave
        const braveResults = await searchBrave(searchQuery, searchApiKey);
        console.log(`[search] Brave returned ${braveResults.length} raw web results`);

        if (braveResults.length > 0) {
          // Send to Lovable AI for structured extraction
          const extracted = await extractCounterpartiesWithAI(braveResults, product, effectiveLocation, signalType, lovableApiKey);
          console.log(`[search] AI extracted ${extracted.length} structured counterparties`);

          webDiscoveryResults = extracted.map((cp: any, idx: number) => ({
            id: `web-${crypto.randomUUID()}`,
            title: cp.company_name,
            description: [
              cp.description,
              cp.location ? `Location: ${cp.location}` : null,
              cp.products ? `Products: ${cp.products}` : null,
            ].filter(Boolean).join(" · "),
            url: cp.website || "#",
            source: "web_discovery",
            score: Math.max(0.3, Math.min(0.65, cp.relevance_score || 0.5)),
            isEnriched: true,
            enrichmentReason: "Discovered via AI-enriched web search",
            whySurfaced: `Found searching for "${product}" ${searchRole}${effectiveLocation ? ` in ${effectiveLocation}` : ""}`,
            coherence: {
              score: cp.relevance_score || 0.5,
              passed: (cp.relevance_score || 0.5) >= 0.4,
              factors: [
                "Web discovered",
                ...(cp.location ? [`Location: ${cp.location}`] : []),
                ...(cp.has_contact ? ["Contact available"] : []),
              ],
            },
            metadata: {
              web_discovered: true,
              has_contact: cp.has_contact || false,
              contact_masked: true, // Contacts are ALWAYS hidden
              source_urls: cp.source_urls || [],
            },
          }));

          webDiscoveryCount = webDiscoveryResults.length;
        }
      } catch (webErr) {
        // Web discovery is best-effort — don't fail the whole search
        console.error("[search] Web discovery error (non-fatal):", webErr);
      }
    }

    console.log(`[search] Web discovery yielded ${webDiscoveryCount} structured counterparties`);

    // ── 4. Merge, sort, return ──
    const allResults = [...cpResults, ...orderBookResults, ...webDiscoveryResults];
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
        web_discovery_count: webDiscoveryCount,
        results_returned: finalResults.length,
      },
    });

    // ── 5. Discovery baseline metrics log (non-blocking) ──
    const responseTimeMs = Math.round(performance.now() - searchStart);
    supabase.from("discovery_search_logs").insert({
      org_id: authCtx.orgId,
      request_id: requestId,
      raw_query: query,
      parsed_product: product || null,
      parsed_location: effectiveLocation || null,
      parsed_role: signalType,
      search_method: ilikeFallbackUsed ? 'ilike_fallback' : 'fts',
      fts_result_count: ftsResultCount,
      ilike_fallback_used: ilikeFallbackUsed,
      ilike_result_count: ilikeResultCount,
      order_book_result_count: orderBookResults.length,
      total_results_returned: finalResults.length,
      response_time_ms: responseTimeMs,
      parse_token_count: parseTokens,
    }).then(({ error: logErr }) => {
      if (logErr) console.error("[search] Discovery log insert error:", logErr.message);
    });

    return new Response(
      JSON.stringify({
        ok: true,
        query,
        // OWNERSHIP: `parsedQuery.role` is the **searcher's own side**
        // (initiator/viewer side), already normalised server-side. Clients
        // MUST NOT invert it to derive the counterparty side; see
        // src/lib/role-confirmation.ts.
        parsedQuery: { product, location: effectiveLocation, role: signalType },
        results: finalResults,
        metrics: {
          baselineCount: cpResults.length,
          enrichedCount: webDiscoveryCount,
          upliftPct: cpResults.length > 0 ? Math.round((webDiscoveryCount / cpResults.length) * 100) : (webDiscoveryCount > 0 ? 100 : 0),
          enrichmentReasons: webDiscoveryCount > 0 ? { "AI web discovery": webDiscoveryCount } : {},
          orderBookMatches: orderBookResults.length,
          ftsHitCount: ftsResultCount,
          ilikeFallbackUsed,
          ilikeHitCount: ilikeResultCount,
          parseTokenCount: parseTokens,
          responseTimeMs,
        },
      }),
      { status: 200, headers: { ...headers, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[search] Error:", error);
    return errorResponse(error instanceof Error ? error : new Error("Unknown error"), requestId, headers);
  }
});

// ── Brave Search ──
async function searchBrave(query: string, apiKey: string): Promise<Array<{ title: string; url: string; description: string }>> {
  // ── FAILURE MODE 1: Brave API hangs — 8s hard timeout ──
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=20`,
      {
        headers: {
          "Accept": "application/json",
          "X-Subscription-Token": apiKey,
        },
        signal: controller.signal,
      }
    );

    if (!response.ok) {
      console.error(`[search] Brave API error: ${response.status}`);
      const body = await response.text();
      console.error(`[search] Brave response: ${body.substring(0, 200)}`);
      return [];
    }

    const data = await response.json();
    return (data.web?.results || []).map((r: any) => ({
      title: r.title || "",
      url: r.url || "",
      description: r.description || "",
    }));
  } catch (error: any) {
    if (error?.name === "AbortError") {
      console.error("[search] Brave API timed out after 8s");
    } else {
      console.error("[search] Brave search error:", error);
    }
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

// ── AI Counterparty Extraction ──
async function extractCounterpartiesWithAI(
  webResults: Array<{ title: string; url: string; description: string }>,
  product: string,
  location: string,
  role: "buyer" | "seller",
  apiKey: string
): Promise<any[]> {
  const searchRole = role === "buyer" ? "suppliers/sellers" : "buyers/importers";

  const prompt = `You are a trade intelligence analyst. From the following web search results, extract ONLY actual companies that are ${searchRole} of "${product}"${location ? ` in or near ${location}` : ""}.

RULES:
- Extract ONLY real companies (not news sites, Wikipedia, industry associations, or directories)
- Each result must have a company_name and ideally a website
- If you find a contact email on the page, set has_contact to true but do NOT include the actual email
- Assign a relevance_score from 0.0 to 1.0 based on how likely this company actually trades ${product}
- Skip results that are clearly news articles, blog posts, or educational content
- If a result is a directory listing multiple companies, extract each individually

WEB SEARCH RESULTS:
${webResults.slice(0, 15).map((r, i) => `[${i + 1}] Title: ${r.title}\n    URL: ${r.url}\n    Snippet: ${r.description}`).join("\n\n")}`;

  // ── FAILURE MODE 1b: AI gateway hangs — 15s hard timeout ──
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          {
            role: "system",
            content: "You extract structured company data from web search results. Return ONLY the tool call, nothing else."
          },
          { role: "user", content: prompt }
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "extract_counterparties",
              description: "Extract structured counterparty company records from web search results",
              parameters: {
                type: "object",
                properties: {
                  counterparties: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        company_name: { type: "string", description: "Official company name" },
                        website: { type: "string", description: "Company website URL" },
                        description: { type: "string", description: "Brief description of what they do, max 100 chars" },
                        location: { type: "string", description: "City/country where they operate" },
                        products: { type: "string", description: "Relevant products/commodities they deal in" },
                        has_contact: { type: "boolean", description: "Whether contact info was found (do NOT include actual email)" },
                        relevance_score: { type: "number", description: "0.0-1.0 how relevant this company is to the query" },
                        source_urls: { type: "array", items: { type: "string" }, description: "URLs where this company was found" }
                      },
                      required: ["company_name", "relevance_score"],
                      additionalProperties: false
                    }
                  }
                },
                required: ["counterparties"],
                additionalProperties: false
              }
            }
          }
        ],
        tool_choice: { type: "function", function: { name: "extract_counterparties" } },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`[search] AI gateway error ${response.status}: ${errText.substring(0, 200)}`);
      return [];
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) {
      console.error("[search] AI returned no tool call");
      return [];
    }

    // ── FAILURE MODE 2: AI returns malformed JSON ──
    let parsed: any;
    try {
      parsed = JSON.parse(toolCall.function.arguments);
    } catch (parseErr) {
      console.error("[search] AI returned unparseable JSON:", toolCall.function.arguments?.substring(0, 200));
      return [];
    }
    const counterparties = Array.isArray(parsed?.counterparties) ? parsed.counterparties : [];

    // Filter out low-relevance results and deduplicate by company name
    const seen = new Set<string>();
    return counterparties
      .filter((cp: any) => {
        if (!cp.company_name || typeof cp.company_name !== "string") return false;
        if (typeof cp.relevance_score !== "number" || cp.relevance_score < 0.3) return false;
        const key = cp.company_name.toLowerCase().trim();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 10);
  } catch (error: any) {
    if (error?.name === "AbortError") {
      console.error("[search] AI gateway timed out after 15s");
    } else {
      console.error("[search] AI extraction error:", error);
    }
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

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
