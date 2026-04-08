/**
 * useDataFetch - Canonical hook for read operations with loading/error/empty states.
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

/** Supabase PostgREST/SDK errors that indicate an expired or missing session */
const AUTH_ERROR_CODES = ["PGRST301", "401", "403"];
const AUTH_ERROR_MESSAGES = [
  "JWT expired",
  "invalid JWT",
  "not authenticated",
  "permission denied",
  "new row violates row-level security",
];

function isAuthRelatedError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as Record<string, unknown>;

  // Supabase PostgREST errors have a `code` field
  if (typeof e.code === "string" && AUTH_ERROR_CODES.includes(e.code)) return true;

  // Check message for auth-related keywords
  const msg = (typeof e.message === "string" ? e.message : "").toLowerCase();
  return AUTH_ERROR_MESSAGES.some(pattern => msg.includes(pattern.toLowerCase()));
}

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
  const redirectingRef = useRef(false);

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

        // Detect expired session from Supabase SDK errors and trigger redirect
        // Skip if the user is intentionally signing out (flag set by AppSidebar)
        if (isAuthRelatedError(err) && !redirectingRef.current && !(window as any).__izenzo_signing_out) {
          redirectingRef.current = true;
          window.dispatchEvent(new CustomEvent("izenzo:session-expiry"));
          const currentPath = window.location.pathname + window.location.search;
          const returnTo = encodeURIComponent(currentPath);
          toast.error("Your session has expired. Redirecting to sign in…", {
            description: "Unsaved form data has been preserved where possible. You will return to this page after signing in.",
            duration: Infinity,
          });
          setTimeout(() => {
            window.location.href = `/auth?returnTo=${returnTo}`;
          }, 4000);
          return; // Don't show generic error toast
        }

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
    redirectingRef.current = false;
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
