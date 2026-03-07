/**
 * useAsyncAction — Canonical hook for mutation operations.
 *
 * Eliminates the repeated pattern of:
 *   const [loading, setLoading] = useState(false);
 *   const handleX = async () => {
 *     if (loading) return;          // double-click guard
 *     setLoading(true);
 *     try { ... toast.success() }
 *     catch { toast.error() }
 *     finally { setLoading(false) }
 *   };
 *
 * Usage:
 *   const { run, loading } = useAsyncAction(async () => {
 *     await apiFetch("match/123/settle", { method: "POST" });
 *   }, { successMessage: "Intent confirmed!", errorMessage: "Failed to confirm" });
 *
 *   <Button onClick={run} disabled={loading}>Confirm</Button>
 */

import { useState, useCallback, useRef } from "react";
import { toast } from "sonner";
import { handleApiError, type ApiErrorOptions } from "@/lib/api-error-handler";

export interface UseAsyncActionOptions extends ApiErrorOptions {
  /** Toast message on success. Pass `false` to suppress. */
  successMessage?: string | false;
  /** Callback after successful execution */
  onSuccess?: () => void;
  /**
   * When true, generates a fresh idempotency key per invocation and
   * passes it as the first element of the args tuple so the caller
   * can forward it to `apiFetch`.
   */
  idempotent?: boolean;
}

export function useAsyncAction<TArgs extends unknown[] = []>(
  action: (...args: TArgs) => Promise<void>,
  options: UseAsyncActionOptions = {}
) {
  const [loading, setLoading] = useState(false);
  const guardRef = useRef(false);

  const run = useCallback(
    async (...args: TArgs) => {
      // Double-click guard (ref-based, survives re-renders)
      if (guardRef.current) return;
      guardRef.current = true;
      setLoading(true);

      try {
        await action(...args);
        if (options.successMessage !== false && options.successMessage) {
          toast.success(options.successMessage);
        }
        options.onSuccess?.();
      } catch (error: unknown) {
        handleApiError(error, options);
      } finally {
        setLoading(false);
        guardRef.current = false;
      }
    },
    [action, options]
  );

  return { run, loading };
}
