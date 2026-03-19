/**
 * useMatchDetails — Data fetching & mutation hook for the Match Details page.
 *
 * Single Responsibility: owns all async state for one match (load, settle, error, retry).
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
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("INSUFFICIENT_TOKENS") || msg.includes("insufficient")) {
          throw new Error("Insufficient credits. Purchase more credits from the Billing page before confirming intent.");
        }
        if (msg.includes("ELIGIBILITY_FAILED") || msg.includes("eligibility")) {
          // Extract denial reasons if present in the error body
          let guidance = "This match is missing required data fields (e.g. buyer name, seller name, commodity, price, or quantity). All fields must be complete before you can confirm intent. This is not a credit issue — your credits are safe.";
          try {
            // Try to parse structured error details
            const parsed = JSON.parse(msg.replace(/^.*?(\{.*)$/, '$1'));
            if (parsed?.denialReasons?.length) {
              guidance = `Cannot confirm intent — missing or invalid fields:\n• ${parsed.denialReasons.join('\n• ')}\n\nFix the match data and try again. Your credits have not been deducted.`;
            }
          } catch { /* use default guidance */ }
          throw new Error(guidance);
        }
        if (msg.includes("DISPUTE_ACTIVE") || msg.includes("dispute")) {
          throw new Error("Cannot confirm intent while an active dispute exists on this match. Resolve the dispute first, then try again.");
        }
        if (msg.includes("INVALID_STATE") || msg.includes("STATE_CONFLICT") || msg.includes("already")) {
          throw new Error("This match has already been confirmed or is not in the correct state. Refresh the page to see the latest status.");
        }
        if (msg.includes("FORBIDDEN") || msg.includes("permission")) {
          throw new Error("You do not have permission to confirm this match. It may belong to a different organisation.");
        }
        throw new Error(`Intent confirmation failed: ${msg}. If this persists, contact support@izenzo.co.za.`);
      }

      if (!updated || !updated.id || !updated.status) {
        throw new Error("Server returned an invalid confirmation response. Contact support@izenzo.co.za if credits were deducted.");
      }

      if (mountedRef.current) {
        setMatch(updated);
        // Invalidate balance caches so sidebar and confirm dialog show updated balance
        queryClient.invalidateQueries({ queryKey: ["token-balance"] });
        queryClient.invalidateQueries({ queryKey: ["token-balance-confirm-single"] });
        toast.success("Intent confirmed. 500 credits deducted. View the Proof tab for your evidence record.");
      }
    },
    {
      successMessage: undefined,
      errorMessage: "Failed to confirm intent. Please try again or contact support@izenzo.co.za.",
    }
  );

  return {
    match,
    loading,
    fetchError,
    isValidMatchId,
    confirming,
    fetchMatch,
    handleSettle,
  };
}
