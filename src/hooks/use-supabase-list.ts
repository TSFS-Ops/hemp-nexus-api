/**
 * useSupabaseList - Replaces the repeated pattern of:
 *   const [items, setItems] = useState<T[]>([]);
 *   const [loading, setLoading] = useState(true);
 *   useEffect(() => { fetchData(); }, []);
 *   const fetchData = async () => { setLoading(true); ... setLoading(false); }
 *
 * Found in 20+ admin panels. This hook wraps TanStack Query + Supabase,
 * giving free caching, deduplication, retry, and stale-while-revalidate.
 *
 * Usage:
 *   const { data, isLoading, isError, refetch } = useSupabaseList("entities", {
 *     columns: "id, legal_name, status",
 *     order: { column: "created_at", ascending: false },
 *     limit: 200,
 *     filters: (query) => query.eq("status", "active"),
 *   });
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type TableName = keyof Database["public"]["Tables"];

interface SupabaseListOptions {
  /** Columns to select (default: "*") */
  columns?: string;
  /** Order clause */
  order?: { column: string; ascending?: boolean };
  /** Row limit (default: 200) */
  limit?: number;
  /** Additional filters applied to the query builder */
  filters?: (query: any) => any;
  /** Extra cache key segments for filter-dependent invalidation */
  queryKeyExtra?: unknown[];
  /** Passed through to useQuery */
  enabled?: boolean;
  /** Stale time in ms (default: 30_000) */
  staleTime?: number;
}

export function useSupabaseList<T = Record<string, unknown>>(
  table: TableName,
  options: SupabaseListOptions = {},
) {
  const {
    columns = "*",
    order = { column: "created_at", ascending: false },
    limit = 200,
    filters,
    queryKeyExtra = [],
    enabled = true,
    staleTime = 30_000,
  } = options;

  return useQuery<T[]>({
    queryKey: [table, columns, order, limit, ...queryKeyExtra],
    queryFn: async () => {
      let query = (supabase
        .from(table) as any)
        .select(columns, { count: "exact" })
        .order(order.column, { ascending: order.ascending ?? false })
        .limit(limit);

      if (filters) {
        query = filters(query);
      }

      const { data, error, count } = await query;
      if (error) throw error;
      const items = (data as T[]) ?? [];
      // Attach totalCount to the array for truncation disclosure
      (items as any).__totalCount = count ?? items.length;
      (items as any).__limit = limit;
      return items;
    },
    enabled,
    staleTime,
  });
}
