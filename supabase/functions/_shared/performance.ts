// Performance tracking and source prioritization

interface PerformanceMetrics {
  dataSourceId: string;
  signalId: string;
  orgId: string;
  optionsReturned: number;
  optionsSelected: number;
  responseTimeMs: number;
  searchSuccess: boolean;
  productCategory?: string;
  location?: string;
  /**
   * OWNERSHIP: `signalType` here is the **searcher/initiator's own side**
   * ("buyer" → the searcher is buying; "seller" → the searcher is selling).
   * It is the same value that surfaces on the wire as `signal_type` and as
   * `parsedQuery.role` from the search edge function. NEVER read it as the
   * counterparty's side.
   */
  signalType?: string;
}

export async function logPerformance(
  supabase: any,
  metrics: PerformanceMetrics
): Promise<void> {
  try {
    await supabase.from("data_source_performance").insert({
      data_source_id: metrics.dataSourceId,
      signal_id: metrics.signalId,
      org_id: metrics.orgId,
      options_returned: metrics.optionsReturned,
      options_selected: metrics.optionsSelected,
      response_time_ms: metrics.responseTimeMs,
      search_success: metrics.searchSuccess,
      product_category: metrics.productCategory,
      location: metrics.location,
      signal_type: metrics.signalType,
    });
  } catch (error) {
    console.error("Failed to log performance:", error);
    // Non-blocking - don't throw
  }
}

interface SourceRanking {
  dataSourceId: string;
  score: number;
  avgResponseTime: number;
  conversionRate: number;
  successRate: number;
}

export async function getSourceRankings(
  supabase: any,
  orgId: string,
  context?: {
    productCategory?: string;
    location?: string;
    signalType?: string;
  }
): Promise<SourceRanking[]> {
  try {
    // Build query with optional context filters
    let query = supabase
      .from("data_source_performance")
      .select("*")
      .eq("org_id", orgId)
      .gte("created_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()); // Last 30 days

    if (context?.productCategory) {
      query = query.eq("product_category", context.productCategory);
    }
    if (context?.location) {
      query = query.eq("location", context.location);
    }
    if (context?.signalType) {
      query = query.eq("signal_type", context.signalType);
    }

    const { data: perfData, error } = await query;

    if (error || !perfData || perfData.length === 0) {
      return []; // No historical data, no prioritization
    }

    // Aggregate by data source
    const bySource = new Map<string, {
      totalReturned: number;
      totalSelected: number;
      totalTime: number;
      successCount: number;
      totalQueries: number;
    }>();

    for (const record of perfData) {
      const sourceId = record.data_source_id;
      const existing = bySource.get(sourceId) || {
        totalReturned: 0,
        totalSelected: 0,
        totalTime: 0,
        successCount: 0,
        totalQueries: 0,
      };

      existing.totalReturned += record.options_returned || 0;
      existing.totalSelected += record.options_selected || 0;
      existing.totalTime += record.response_time_ms || 0;
      existing.successCount += record.search_success ? 1 : 0;
      existing.totalQueries += 1;

      bySource.set(sourceId, existing);
    }

    // Calculate rankings
    const rankings: SourceRanking[] = [];
    for (const [sourceId, stats] of bySource.entries()) {
      const conversionRate = stats.totalReturned > 0 
        ? stats.totalSelected / stats.totalReturned 
        : 0;
      const successRate = stats.totalQueries > 0 
        ? stats.successCount / stats.totalQueries 
        : 0;
      const avgResponseTime = stats.totalQueries > 0 
        ? stats.totalTime / stats.totalQueries 
        : Infinity;

      // Composite score: weighted combination
      // Higher conversion and success = better
      // Lower response time = better
      const score = 
        (conversionRate * 40) + 
        (successRate * 40) + 
        (Math.max(0, 1 - (avgResponseTime / 10000)) * 20); // Normalize response time to 0-20

      rankings.push({
        dataSourceId: sourceId,
        score,
        avgResponseTime,
        conversionRate,
        successRate,
      });
    }

    // Sort by score descending
    rankings.sort((a, b) => b.score - a.score);

    return rankings;
  } catch (error) {
    console.error("Failed to calculate source rankings:", error);
    return [];
  }
}

export async function recordSelection(
  supabase: any,
  signalId: string,
  optionId: string
): Promise<void> {
  try {
    // Get the option to find its data source
    const { data: option } = await supabase
      .from("options")
      .select("data_source_id")
      .eq("id", optionId)
      .single();

    if (!option) return;

    // Update the performance record for this signal/source
    await supabase
      .from("data_source_performance")
      .update({ options_selected: 1 })
      .eq("signal_id", signalId)
      .eq("data_source_id", option.data_source_id);
  } catch (error) {
    console.error("Failed to record selection:", error);
    // Non-blocking
  }
}
