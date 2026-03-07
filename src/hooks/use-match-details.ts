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
        toast.error("Match not found");
        navigate("/dashboard");
        return;
      }

      if (!data.id || !data.commodity || typeof data.price_amount !== "number") {
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

      const updated = await apiFetch<Match>(`match/${match.id}/settle`, { method: "POST" });

      if (!updated || !updated.id || !updated.status) {
        throw new Error("Server returned an invalid confirmation response.");
      }

      if (mountedRef.current) {
        setMatch(updated);
        toast.success("Status updated to Confirmed. 500 credits deducted.");
      }
    },
    {
      successMessage: undefined,
      errorMessage: "Failed to confirm intent. Please try again.",
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
