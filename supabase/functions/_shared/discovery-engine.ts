/**
 * 12% Discovery Engine
 * 
 * This module implements an enhanced discovery layer that finds additional
 * relevant buyers/sellers that baseline AI search might miss. It uses:
 * - Alternate prompts and synonyms
 * - Supply chain adjacency heuristics
 * - Different data source strategies
 * 
 * The engine tracks "why surfaced" explanations and measures uplift vs baseline.
 */

export interface DiscoveryResult {
  id: string;
  title: string;
  url: string;
  description: string;
  source: string;
  is_enriched: boolean; // true = from 12% engine, false = baseline
  enrichment_reason?: string; // "why surfaced" explanation
  confidence_score: number;
  metadata?: Record<string, any>;
}

export interface DiscoveryMetrics {
  baseline_count: number;
  enriched_count: number;
  uplift_pct: number;
  enrichment_reasons: Record<string, number>; // reason -> count
}

// Supply chain adjacency mappings
const SUPPLY_CHAIN_ADJACENCIES: Record<string, string[]> = {
  "copper cathode": ["copper wire", "copper sheet", "copper scrap", "refined copper"],
  "cashew": ["cashew nut", "cashew kernel", "cashew shell", "processed cashew"],
  "industrial fiber": ["textile fiber", "synthetic fiber", "natural fiber", "fiber composite"],
  "steel": ["steel coil", "steel sheet", "steel bar", "stainless steel", "steel scrap"],
  "aluminum": ["aluminium", "aluminum ingot", "aluminum sheet", "aluminum scrap"],
  "wheat": ["flour", "grain", "wheat flour", "wheat bran"],
  "coffee": ["coffee beans", "green coffee", "roasted coffee", "arabica", "robusta"],
  "cotton": ["cotton lint", "cotton fiber", "raw cotton", "cotton bale"],
  "sugar": ["raw sugar", "refined sugar", "sugarcane", "molasses"],
  "soybean": ["soy", "soybean oil", "soy meal", "soy protein"],
};

// Synonym expansions for search enhancement
const SYNONYMS: Record<string, string[]> = {
  "buyer": ["importer", "purchaser", "procurement", "sourcing"],
  "seller": ["supplier", "exporter", "vendor", "manufacturer", "producer"],
  "wholesale": ["bulk", "commercial", "industrial", "large quantity"],
  "supplier": ["manufacturer", "producer", "exporter", "distributor"],
};

// Regions for geographic expansion
const REGIONAL_EXPANSIONS: Record<string, string[]> = {
  "india": ["mumbai", "delhi", "chennai", "kolkata", "gujarat"],
  "china": ["shanghai", "guangzhou", "shenzhen", "hong kong"],
  "south africa": ["johannesburg", "cape town", "durban", "pretoria"],
  "usa": ["new york", "los angeles", "chicago", "houston", "texas", "california"],
  "europe": ["germany", "netherlands", "uk", "france", "italy", "rotterdam"],
};

/**
 * Generate enhanced search queries using the 12% discovery engine
 */
export function generateEnrichedQueries(
  product: string,
  location: string,
  signalType: "buyer" | "seller",
  baseQueries: string[]
): { query: string; reason: string }[] {
  const enrichedQueries: { query: string; reason: string }[] = [];
  const productLower = product.toLowerCase();
  const locationLower = location?.toLowerCase() || "";
  
  // 1. Supply chain adjacency expansion
  for (const [key, adjacencies] of Object.entries(SUPPLY_CHAIN_ADJACENCIES)) {
    if (productLower.includes(key)) {
      adjacencies.slice(0, 2).forEach(adj => {
        const counterparty = signalType === "buyer" ? "supplier" : "buyer";
        enrichedQueries.push({
          query: `${adj} ${counterparty} ${location || ""}`.trim(),
          reason: `Supply chain adjacency: ${adj} is related to ${product}`
        });
      });
    }
  }
  
  // 2. Synonym expansion
  const counterpartyTerms = signalType === "buyer" 
    ? SYNONYMS["seller"] 
    : SYNONYMS["buyer"];
  
  counterpartyTerms.slice(0, 2).forEach(term => {
    enrichedQueries.push({
      query: `${product} ${term} ${location || "wholesale"}`.trim(),
      reason: `Synonym expansion: searching for ${term} instead of standard term`
    });
  });
  
  // 3. Regional expansion
  for (const [region, cities] of Object.entries(REGIONAL_EXPANSIONS)) {
    if (locationLower.includes(region) || locationLower === "") {
      cities.slice(0, 2).forEach(city => {
        enrichedQueries.push({
          query: `${product} ${signalType === "buyer" ? "supplier" : "buyer"} ${city}`,
          reason: `Regional expansion: ${city} is a trade hub in ${region}`
        });
      });
      break; // Only expand one region
    }
  }
  
  // 4. Industry-specific heuristics
  if (productLower.includes("metal") || productLower.includes("steel") || productLower.includes("copper")) {
    enrichedQueries.push({
      query: `${product} trading company ${location || "international"}`,
      reason: "Metal trading: adding trading company search for B2B metals market"
    });
  }
  
  if (productLower.includes("food") || productLower.includes("agri") || 
      productLower.includes("grain") || productLower.includes("cashew")) {
    enrichedQueries.push({
      query: `${product} exporter certified ${location || ""}`,
      reason: "Agri-commodity: searching for certified exporters for food safety compliance"
    });
  }
  
  // 5. B2B platform searches
  enrichedQueries.push({
    query: `${product} alibaba ${signalType === "buyer" ? "supplier" : "buyer"}`,
    reason: "B2B platform: Alibaba is a major B2B trade platform"
  });
  
  enrichedQueries.push({
    query: `${product} indiamart ${signalType === "buyer" ? "supplier" : "buyer"}`,
    reason: "B2B platform: IndiaMART for South Asian trade"
  });
  
  // Remove duplicates with base queries
  const baseQuerySet = new Set(baseQueries.map(q => q.toLowerCase()));
  return enrichedQueries.filter(eq => 
    !baseQuerySet.has(eq.query.toLowerCase()) && eq.query.length > 5
  );
}

/**
 * Merge baseline and enriched results into a single ranked list
 */
export function mergeResults(
  baselineResults: any[],
  enrichedResults: DiscoveryResult[]
): DiscoveryResult[] {
  // Mark baseline results
  const markedBaseline: DiscoveryResult[] = baselineResults.map(r => ({
    id: r.id || crypto.randomUUID(),
    title: r.title,
    url: r.url,
    description: r.description,
    source: r.source,
    is_enriched: false,
    confidence_score: r.confidence_score || 0.5,
    metadata: r.metadata
  }));
  
  // Deduplicate by URL
  const seenUrls = new Set(markedBaseline.map(r => r.url?.toLowerCase()));
  const uniqueEnriched = enrichedResults.filter(
    r => r.url && !seenUrls.has(r.url.toLowerCase())
  );
  
  // Merge and sort by confidence
  const merged = [...markedBaseline, ...uniqueEnriched];
  merged.sort((a, b) => (b.confidence_score || 0) - (a.confidence_score || 0));
  
  return merged;
}

/**
 * Calculate discovery metrics (uplift)
 */
export function calculateMetrics(
  baselineCount: number,
  enrichedResults: DiscoveryResult[]
): DiscoveryMetrics {
  const enrichedFromEngine = enrichedResults.filter(r => r.is_enriched);
  const totalEnriched = baselineCount + enrichedFromEngine.length;
  
  // Count enrichment reasons
  const reasonCounts: Record<string, number> = {};
  enrichedFromEngine.forEach(r => {
    if (r.enrichment_reason) {
      const key = r.enrichment_reason.split(":")[0]; // Get category
      reasonCounts[key] = (reasonCounts[key] || 0) + 1;
    }
  });
  
  return {
    baseline_count: baselineCount,
    enriched_count: totalEnriched,
    uplift_pct: baselineCount > 0 
      ? ((totalEnriched - baselineCount) / baselineCount) * 100 
      : 0,
    enrichment_reasons: reasonCounts
  };
}

/**
 * Score coherence between a signal and a potential match option
 * Uses intention vector features: price band, volume, timing, compliance, logistics, readiness
 */
export function scoreCoherence(
  signal: any,
  option: any,
  threshold: number = 0.6
): { score: number; passed: boolean; factors: Record<string, number> } {
  const factors: Record<string, number> = {};
  const signalContent = signal.content || signal;
  
  // Price band match (if both have price info)
  if (signalContent.budget && option.price) {
    const priceDiff = Math.abs(signalContent.budget - option.price) / signalContent.budget;
    factors.price_band = priceDiff < 0.2 ? 1.0 : priceDiff < 0.5 ? 0.7 : 0.3;
  } else {
    factors.price_band = 0.5; // Neutral if no price info
  }
  
  // Volume match
  if (signalContent.quantity && option.how_much) {
    const volumeRatio = Math.min(signalContent.quantity, option.how_much) / 
                        Math.max(signalContent.quantity, option.how_much);
    factors.volume = volumeRatio;
  } else {
    factors.volume = 0.5;
  }
  
  // Location/logistics match
  if (signalContent.location && option.where_location) {
    const signalLoc = signalContent.location.toLowerCase();
    const optionLoc = option.where_location.toLowerCase();
    factors.logistics = signalLoc.includes(optionLoc) || optionLoc.includes(signalLoc) 
      ? 1.0 
      : 0.4;
  } else {
    factors.logistics = 0.5;
  }
  
  // Compliance/quality
  factors.compliance = option.quality_flags?.verified ? 1.0 : 0.5;
  
  // Readiness (freshness of data)
  if (option.freshness) {
    const freshnessDate = new Date(option.freshness);
    const daysSinceFresh = (Date.now() - freshnessDate.getTime()) / (1000 * 60 * 60 * 24);
    factors.readiness = daysSinceFresh < 7 ? 1.0 : daysSinceFresh < 30 ? 0.7 : 0.4;
  } else {
    factors.readiness = 0.5;
  }
  
  // Timing match (if delivery window specified)
  factors.timing = option.when_available ? 0.8 : 0.5;
  
  // Calculate weighted score
  const weights = {
    price_band: 0.25,
    volume: 0.2,
    logistics: 0.2,
    compliance: 0.15,
    readiness: 0.1,
    timing: 0.1
  };
  
  let score = 0;
  for (const [factor, weight] of Object.entries(weights)) {
    score += (factors[factor] || 0.5) * weight;
  }
  
  return {
    score,
    passed: score >= threshold,
    factors
  };
}
