/**
 * useMatchDetails - Data fetching & mutation hook for the Match Details page.
 *
 * Single Responsibility: owns all async state for one match (load, settle, error, retry).
 * Supports the full V3 lifecycle: Discovery → Intent → Reveal → Commit → Complete.
 */

import { useEffect, useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { apiFetch, generateIdempotencyKey } from "@/lib/api-client";
import { useAsyncAction } from "@/hooks/use-async-action";
import { queryClient } from "@/lib/query-client";
import { toast } from "sonner";
import type { Tables } from "@/integrations/supabase/types";

export type Match = Tables<"matches">;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Sentinel class so callers can detect state conflicts and auto-refetch */
class StateConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StateConflictError";
  }
}

function handleApiError(err: unknown): never {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("INSUFFICIENT_TOKENS") || msg.includes("insufficient")) {
    throw new Error("Insufficient credits. Purchase more credits from the Billing page.");
  }
  if (msg.includes("ELIGIBILITY_FAILED") || msg.includes("eligibility")) {
    throw new Error("Missing required data fields (buyer, seller, quantity, or price). Complete these in the Terms tab before proceeding. No credits were deducted - your credits are safe.");
  }
  if (msg.includes("DISPUTE_ACTIVE") || msg.includes("dispute")) {
    throw new Error("Cannot proceed while an active dispute exists. Resolve the dispute first.");
  }
  if (msg.includes("INVALID_STATE") || msg.includes("STATE_CONFLICT") || msg.includes("already")) {
    throw new StateConflictError("This match has been updated by another action. Refreshing now…");
  }
  if (msg.includes("FORBIDDEN") || msg.includes("permission")) {
    throw new Error("You do not have permission to modify this match.");
  }
  throw new Error(`Action failed: ${msg}. If this persists, contact support@izenzo.co.za.`);
}

export function useMatchDetails(matchId: string | undefined) {
  const navigate = useNavigate();
  const [match, setMatch] = useState<Match | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const isValidMatchId = matchId ? UUID_RE.test(matchId) : false;

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const fetchMatch = useCallback(async () => {
    if (!matchId || !UUID_RE.test(matchId)) {
      if (mountedRef.current) {
        setFetchError("Invalid match ID format.");
        setLoading(false);
      }
      return;
    }

    try {
      setLoading(true);
      setFetchError(null);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);

      const { data, error } = await supabase
        .from("matches")
        .select("*")
        .eq("id", matchId)
        .abortSignal(controller.signal)
        .maybeSingle();

      clearTimeout(timeout);

      if (!mountedRef.current) return;

      if (error) throw error;
      if (!data) {
        setMatch(null);
        setLoading(false);
        return;
      }

      if (!data.id || !data.commodity) {
        throw new Error("Received malformed match data from the server.");
      }

      setMatch(data);
    } catch (error: unknown) {
      if (!mountedRef.current) return;

      console.error("Error fetching match:", error);

      if (error instanceof DOMException && error.name === "AbortError") {
        setFetchError("Request timed out. Please check your connection and try again.");
        toast.error("Request timed out.");
      } else if (error instanceof TypeError && error.message.includes("fetch")) {
        setFetchError("Network error. You may be offline.");
        toast.error("Network error. Please check your connection.");
      } else {
        const msg = error instanceof Error ? error.message : "Failed to load match";
        setFetchError(msg);
        toast.error(msg);
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [matchId, navigate]);

  useEffect(() => {
    if (matchId) fetchMatch();
  }, [matchId, fetchMatch]);

  // ── Intent declaration (discovery → intent_declared) ──
  const { run: handleSettle, loading: confirming } = useAsyncAction(
    async () => {
      if (!match) return;

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error("Your session has expired. Please sign in again.");
        navigate("/auth");
        return;
      }

      const idempotencyKey = generateIdempotencyKey("settle");

      let updated: Match;
      try {
        updated = await apiFetch<Match>(`match/${match.id}/settle`, {
          method: "POST",
          idempotencyKey,
        });
      } catch (err: unknown) {
        if (err instanceof StateConflictError || (err instanceof Error && (err.message.includes("STATE_CONFLICT") || err.message.includes("INVALID_STATE")))) {
          toast.warning("This match has been updated by another action. Refreshing now…");
          await fetchMatch();
          return;
        }
        handleApiError(err);
      }

      if (!updated || !updated.id || !updated.status) {
        throw new Error("Server returned an invalid response. Contact support@izenzo.co.za if credits were deducted.");
      }

      if (mountedRef.current) {
        setMatch(updated);
        queryClient.invalidateQueries({ queryKey: ["token-balance"] });
        queryClient.invalidateQueries({ queryKey: ["token-balance-confirm-single"] });
        queryClient.invalidateQueries({ queryKey: ["token-balance-progression"] });
        toast.success("POI generated. 1 credit deducted.");
      }
    },
    {
      successMessage: undefined,
      errorMessage: "Failed to confirm intent. Please try again.",
    }
  );

  // ── Generic state progression action ──
  const { run: handleStateAction, loading: stateActionLoading } = useAsyncAction(
    async (actionPath: string) => {
      if (!match) return;

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error("Your session has expired. Please sign in again.");
        navigate("/auth");
        return;
      }

      const idempotencyKey = generateIdempotencyKey(actionPath);

      let updated: Match;
      try {
        updated = await apiFetch<Match>(`match/${match.id}/${actionPath}`, {
          method: "POST",
          idempotencyKey,
        });
      } catch (err: unknown) {
        if (err instanceof StateConflictError || (err instanceof Error && (err.message.includes("STATE_CONFLICT") || err.message.includes("INVALID_STATE")))) {
          toast.warning("This match has been updated by another action. Refreshing now…");
          await fetchMatch();
          return;
        }
        handleApiError(err);
      }

      if (!updated || !updated.id) {
        throw new Error("Server returned an invalid response. Contact support@izenzo.co.za.");
      }

      if (mountedRef.current) {
        setMatch(updated);
        queryClient.invalidateQueries({ queryKey: ["token-balance"] });
        queryClient.invalidateQueries({ queryKey: ["token-balance-confirm-single"] });
        queryClient.invalidateQueries({ queryKey: ["token-balance-progression"] });

        const labels: Record<string, string> = {
          "generate-poi": "POI generated. 1 credit deducted.",
          "reveal-counterparty": "Counterparty revealed.",
          "commit": "Deal committed.",
          "complete": "Transaction completed. Evidence record sealed.",
        };
        toast.success(labels[actionPath] || "Action completed.");
      }
    },
    {
      successMessage: undefined,
      errorMessage: "Action failed. Please try again.",
    }
  );

  return {
    match,
    loading,
    fetchError,
    isValidMatchId,
    confirming,
    stateActionLoading,
    fetchMatch,
    handleSettle,
    handleStateAction,
  };
}
