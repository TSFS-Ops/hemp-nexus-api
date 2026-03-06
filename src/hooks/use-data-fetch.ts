/**
 * useDataFetch — Canonical hook for read operations with loading/error/empty states.
 *
 * Eliminates the repeated pattern of:
 *   const [data, setData] = useState(null);
 *   const [loading, setLoading] = useState(true);
 *   const [error, setError] = useState(null);
 *   useEffect(() => { fetchData(); }, [dep]);
 *   const fetchData = async () => {
 *     try { setLoading(true); ... setData(result); }
 *     catch { setError(err); toast.error("Failed to load ..."); }
 *     finally { setLoading(false); }
 *   };
 *
 * Usage:
 *   const { data, loading, error, refetch } = useDataFetch(
 *     async () => {
 *       const { data, error } = await supabase.from("matches").select("*");
 *       if (error) throw error;
 *       return data;
 *     },
 *     { deps: [matchId], errorMessage: "Failed to load matches" }
 *   );
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";

export interface UseDataFetchOptions {
  /** Dependencies that trigger a refetch (like useEffect deps) */
  deps?: unknown[];
  /** Toast message on error. Pass `false` to suppress toast. */
  errorMessage?: string | false;
  /** If true, don't fetch on mount */
  lazy?: boolean;
}

export interface UseDataFetchResult<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

export function useDataFetch<T>(
  fetcher: () => Promise<T>,
  options: UseDataFetchOptions = {}
): UseDataFetchResult<T> {
  const { deps = [], errorMessage = "Failed to load data", lazy = false } = options;
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(!lazy);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useRef(true);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetcher();
      if (mountedRef.current) {
        setData(result);
      }
    } catch (err) {
      if (mountedRef.current) {
        const e = err instanceof Error ? err : new Error(String(err));
        setError(e);
        console.error(errorMessage, err);
        if (errorMessage !== false) {
          toast.error(errorMessage);
        }
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [fetcher, errorMessage]);

  useEffect(() => {
    mountedRef.current = true;
    if (!lazy) {
      refetch();
    }
    return () => {
      mountedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, loading, error, refetch };
}
