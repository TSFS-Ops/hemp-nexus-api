/**
 * Shared demo data for counterparty search results
 * Used by PublicSearch and Demo pages for unauthenticated users
 */

export interface DemoSearchResult {
  id: string;
  title: string;
  description: string;
  url?: string;
  source: string;
  score: number;
  isEnriched?: boolean;
  enrichmentReason?: string | null;
  whySurfaced?: string;
}

/**
 * Demo results organized by commodity keyword
 */
export const DEMO_RESULTS: Record<string, DemoSearchResult[]> = {
  cashew: [
    {
      id: "demo-1",
      title: "Olam Agri International",
      description: "Major cashew processor and exporter based in Singapore with operations across West Africa and India.",
      source: "Verified Trade Registry",
      score: 94,
      isEnriched: true,
      enrichmentReason: "Cross-referenced with export licenses",
      whySurfaced: "Direct keyword match for 'cashew buyers' with high trade volume signals",
    },
    {
      id: "demo-2",
      title: "Achal Industries",
      description: "Large-scale cashew processing facility in Gujarat, India. ISO certified with annual capacity of 15,000 MT.",
      source: "Industry Database",
      score: 89,
      isEnriched: true,
      enrichmentReason: "Matched compliance records",
      whySurfaced: "Supply chain adjacency: trades related commodities in same corridor",
    },
    {
      id: "demo-3",
      title: "Kenkko Foods Ltd",
      description: "Established cashew buyer with distribution network across Southeast Asia and Middle East markets.",
      source: "Trade Directory",
      score: 82,
      whySurfaced: "Company profile mentions cashew procurement interest",
    },
    {
      id: "demo-4",
      title: "Pacific Rim Foods Inc.",
      description: "US-based food distributor expanding into raw nut ingredient sourcing.",
      source: "Industry Database",
      score: 78,
      whySurfaced: "Company profile mentions cashew procurement interest",
    },
    {
      id: "demo-5",
      title: "EuroNuts Trading BV",
      description: "Netherlands-based trader with focus on sustainable and fair-trade certified nuts.",
      source: "B2B Platform",
      score: 72,
      isEnriched: true,
      enrichmentReason: "semantic_expansion",
      whySurfaced: "Semantic expansion: 'fair-trade nuts' as adjacent category",
    },
  ],
  copper: [
    {
      id: "demo-6",
      title: "Glencore International AG",
      description: "Global commodity trading and mining company. Major copper cathode trader with worldwide logistics.",
      source: "Verified Trade Registry",
      score: 96,
      isEnriched: true,
      enrichmentReason: "Verified financial standing",
      whySurfaced: "Registered copper cathode supplier with verified operations",
    },
    {
      id: "demo-7",
      title: "Jiangxi Copper Company",
      description: "One of China's largest copper producers. Imports copper concentrate and cathode for smelting operations.",
      source: "Industry Database",
      score: 91,
      isEnriched: true,
      enrichmentReason: "Cross-referenced with import records",
      whySurfaced: "Copper trading division with LME-grade inventory",
    },
    {
      id: "demo-8",
      title: "AfricaMineral Resources",
      description: "Zambian copper mining consortium with direct mine-to-market capabilities.",
      source: "Mining Directory",
      score: 87,
      isEnriched: true,
      enrichmentReason: "regional_heuristic",
      whySurfaced: "Regional mining hub: Zambia copper belt producer",
    },
  ],
  default: [
    {
      id: "demo-9",
      title: "TradeLink Partners",
      description: "Multi-commodity trading house with focus on agricultural products and base metals.",
      source: "Trade Directory",
      score: 85,
      whySurfaced: "Baseline match based on query terms and company profile",
    },
    {
      id: "demo-10",
      title: "Global Commodities Ltd",
      description: "Established commodity broker with verified track record in cross-border trade facilitation.",
      source: "Verified Trade Registry",
      score: 78,
      isEnriched: true,
      enrichmentReason: "Verified trade history",
      whySurfaced: "Semantic expansion: found related trading activity",
    },
  ],
};

/**
 * Get demo results based on a search query
 * Matches keywords to return appropriate demo data
 */
export function getDemoResultsForQuery(query: string): DemoSearchResult[] {
  const lowerQuery = query.toLowerCase();
  
  if (lowerQuery.includes("cashew") || lowerQuery.includes("nut")) {
    return DEMO_RESULTS.cashew;
  }
  
  if (lowerQuery.includes("copper") || lowerQuery.includes("metal") || lowerQuery.includes("cathode")) {
    return DEMO_RESULTS.copper;
  }
  
  return DEMO_RESULTS.default;
}

/**
 * Calculate metrics from search results
 */
export function calculateSearchMetrics(results: DemoSearchResult[]) {
  const baselineCount = results.filter(r => !r.isEnriched).length;
  const enrichedCount = results.filter(r => r.isEnriched).length;
  const totalCount = results.length;
  const upliftPct = baselineCount > 0 ? Math.round((enrichedCount / baselineCount) * 100) : 0;
  
  return { baselineCount, enrichedCount, totalCount, upliftPct };
}
