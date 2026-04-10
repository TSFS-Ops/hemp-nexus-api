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

export interface SupabaseListResult<T> {
  data: T[];
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
  /** True when total rows exceed the query limit */
  isTruncated: boolean;
  /** Total row count from the server (if available) */
  totalCount: number;
  /** The limit used for the query */
  queryLimit: number;
}

export function useSupabaseList<T = Record<string, unknown>>(
  table: TableName,
  options: SupabaseListOptions = {},
): SupabaseListResult<T> {
  const {
    columns = "*",
    order = { column: "created_at", ascending: false },
    limit = 200,
    filters,
    queryKeyExtra = [],
    enabled = true,
    staleTime = 30_000,
  } = options;

  const query = useQuery<{ items: T[]; totalCount: number }>({
    queryKey: [table, columns, order, limit, ...queryKeyExtra],
    queryFn: async () => {
      let q = (supabase
        .from(table) as any)
        .select(columns, { count: "exact" })
        .order(order.column, { ascending: order.ascending ?? false })
        .limit(limit);

      if (filters) {
        q = filters(q);
      }

      const { data, error, count } = await q;
      if (error) throw error;
      return { items: (data as T[]) ?? [], totalCount: count ?? (data?.length ?? 0) };
    },
    enabled,
    staleTime,
  });

  const items = query.data?.items ?? [];
  const totalCount = query.data?.totalCount ?? 0;

  return {
    data: items,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
    isTruncated: totalCount > limit,
    totalCount,
    queryLimit: limit,
  };
}
