/**
 * Sanitizes raw search results from the API to prevent UI crashes
 * when the external Brave/AI APIs return degraded or malformed data.
 */

interface RawResult {
  id?: unknown;
  title?: unknown;
  description?: unknown;
  url?: unknown;
  source?: unknown;
  score?: unknown;
  isEnriched?: unknown;
  enrichmentReason?: unknown;
  whySurfaced?: unknown;
  coherence?: unknown;
  metadata?: unknown;
  [key: string]: unknown;
}

export interface SanitizedResult {
  id: string;
  title: string;
  description: string;
  url: string;
  source: string;
  score: number;
  isEnriched: boolean;
  enrichmentReason: string | null;
  whySurfaced: string;
  coherence: {
    score: number;
    passed: boolean;
    factors: string[];
  };
  metadata?: Record<string, any>;
}

const DEFAULT_COHERENCE = { score: 0, passed: false, factors: [] };

function sanitizeCoherence(raw: unknown): SanitizedResult["coherence"] {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_COHERENCE };
  const c = raw as Record<string, unknown>;
  return {
    score: typeof c.score === "number" ? c.score : 0,
    passed: typeof c.passed === "boolean" ? c.passed : false,
    factors: Array.isArray(c.factors) ? c.factors.filter((f): f is string => typeof f === "string") : [],
  };
}

export function sanitizeSearchResults(raw: unknown): SanitizedResult[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .filter((item): item is RawResult => item != null && typeof item === "object")
    .map((item, idx) => ({
      id: typeof item.id === "string" && item.id ? item.id : `result-${idx}-${Date.now()}`,
      title: typeof item.title === "string" ? item.title : "Unknown Company",
      description: typeof item.description === "string" ? item.description : "",
      url: typeof item.url === "string" ? item.url : "#",
      source: typeof item.source === "string" ? item.source : "unknown",
      score: typeof item.score === "number" ? item.score : 0,
      isEnriched: item.isEnriched === true,
      enrichmentReason: typeof item.enrichmentReason === "string" ? item.enrichmentReason : null,
      whySurfaced: typeof item.whySurfaced === "string" ? item.whySurfaced : "Matched from search",
      coherence: sanitizeCoherence(item.coherence),
      metadata: item.metadata && typeof item.metadata === "object" ? item.metadata as Record<string, any> : undefined,
    }));
}

export interface DegradationInfo {
  isPartiallyDegraded: boolean;
  webDiscoveryDown: boolean;
  message: string | null;
}

/**
 * Analyzes search metrics to determine if external APIs are degraded.
 */
export function detectDegradation(metrics: Record<string, any> | null): DegradationInfo {
  if (!metrics) return { isPartiallyDegraded: false, webDiscoveryDown: false, message: null };

  const baseline = typeof metrics.baselineCount === "number" ? metrics.baselineCount : 0;
  const enriched = typeof metrics.enrichedCount === "number" ? metrics.enrichedCount : 0;
  const orderBook = typeof metrics.orderBookMatches === "number" ? metrics.orderBookMatches : 0;

  // If we got internal results but zero web results, web discovery likely failed
  const webDiscoveryDown = (baseline > 0 || orderBook > 0) && enriched === 0;

  // If we got zero results everywhere, everything might be down
  const totalDown = baseline === 0 && enriched === 0 && orderBook === 0;

  if (webDiscoveryDown) {
    return {
      isPartiallyDegraded: true,
      webDiscoveryDown: true,
      message: "Web discovery is temporarily unavailable. Showing results from the internal registry only.",
    };
  }

  return { isPartiallyDegraded: false, webDiscoveryDown: false, message: null };
}
