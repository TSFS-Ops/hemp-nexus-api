/**
 * useMatchDetails - Data fetching & mutation hook for the Match Details page.
 *
 * Single Responsibility: owns all async state for one match (load, settle, error, retry).
 * Supports the full V3 lifecycle: Discovery → Intent → Reveal → Commit → Complete.
 */

import { useEffect, useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { apiFetch, generateIdempotencyKey, ApiError } from "@/lib/api-client";
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

/**
 * Map a server eligibility-failure payload into a precise, user-readable message.
 * Falls back to a generic hint only when the server didn't tell us why.
 */
function formatEligibilityMessage(details: Record<string, unknown> | null): string {
  const denialReasons = Array.isArray(details?.denialReasons)
    ? (details!.denialReasons as unknown[]).filter((x): x is string => typeof x === "string")
    : [];
  const failedFields = Array.isArray(details?.failedFields)
    ? (details!.failedFields as unknown[]).filter((x): x is string => typeof x === "string")
    : [];

  if (denialReasons.length > 0) {
    const list = denialReasons.slice(0, 3).join("; ");
    return `Cannot generate POI: ${list}. Fix in the Terms tab — no credits were deducted.`;
  }
  if (failedFields.length > 0) {
    return `Cannot generate POI. Invalid or missing: ${failedFields.join(", ")}. Fix in the Terms tab — no credits were deducted.`;
  }
  return "Cannot generate POI: required deal fields are missing or invalid. Complete them in the Terms tab — no credits were deducted.";
}

/**
 * Public event name for eligibility failures. UI components (e.g. DealTermsPanel)
 * can listen for this to highlight the offending fields without requiring prop drilling.
 */
export const MATCH_ELIGIBILITY_FAILED_EVENT = "izenzo:match-eligibility-failed";

export interface MatchEligibilityFailedDetail {
  matchId: string;
  failedFields: string[];
  denialReasons: string[];
}

function extractFailedFields(err: unknown): { failedFields: string[]; denialReasons: string[] } | null {
  if (!(err instanceof ApiError)) return null;
  const isEligibility =
    err.code === "ELIGIBILITY_FAILED" ||
    (err.status === 422 && err.details && (Array.isArray(err.details.failedFields) || Array.isArray(err.details.denialReasons)));
  if (!isEligibility) return null;

  const details = err.details ?? {};
  const failedFields = Array.isArray(details.failedFields)
    ? (details.failedFields as unknown[]).filter((x): x is string => typeof x === "string")
    : [];
  const denialReasons = Array.isArray(details.denialReasons)
    ? (details.denialReasons as unknown[]).filter((x): x is string => typeof x === "string")
    : [];
  return { failedFields, denialReasons };
}

function dispatchEligibilityFailed(matchId: string, err: unknown): void {
  const extracted = extractFailedFields(err);
  if (!extracted) return;
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<MatchEligibilityFailedDetail>(MATCH_ELIGIBILITY_FAILED_EVENT, {
      detail: { matchId, ...extracted },
    }),
  );
}

function handleApiError(err: unknown): never {
  // Prefer structured ApiError details so we can surface the real reason
  if (err instanceof ApiError) {
    if (err.code === "ELIGIBILITY_FAILED" || err.status === 422) {
      throw new Error(formatEligibilityMessage(err.details));
    }
    if (err.code === "INSUFFICIENT_TOKENS" || /insufficient/i.test(err.message)) {
      throw new Error("Insufficient credits. Purchase more credits from the Billing page.");
    }
    if (err.code === "DISPUTE_ACTIVE" || /dispute/i.test(err.message)) {
      throw new Error("Cannot proceed while an active dispute exists. Resolve the dispute first.");
    }
    if (err.code === "STATE_CONFLICT" || err.code === "INVALID_STATE" || /already/i.test(err.message)) {
      throw new StateConflictError("This match has been updated by another action. Refreshing now…");
    }
    if (err.status === 403 || err.code === "FORBIDDEN" || /permission/i.test(err.message)) {
      throw new Error("You do not have permission to modify this match.");
    }
    throw new Error(`${err.message} (request id: ${err.requestId ?? "n/a"}). If this persists, contact support@izenzo.co.za.`);
  }

  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("INSUFFICIENT_TOKENS") || msg.includes("insufficient")) {
    throw new Error("Insufficient credits. Purchase more credits from the Billing page.");
  }
  if (msg.includes("ELIGIBILITY_FAILED") || msg.includes("eligibility")) {
    throw new Error(formatEligibilityMessage(null));
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
        dispatchEligibilityFailed(match.id, err);
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
  // Optional second arg `body` forwards a JSON payload to the edge function.
  // Used by the POI gate to send the evidence-waiver record so it can be
  // written atomically with the mint (no orphan audit rows).
  const { run: handleStateAction, loading: stateActionLoading } = useAsyncAction(
    async (actionPath: string, body?: Record<string, unknown>) => {
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
          body: body ? JSON.stringify(body) : undefined,
        });
      } catch (err: unknown) {
        if (err instanceof StateConflictError || (err instanceof Error && (err.message.includes("STATE_CONFLICT") || err.message.includes("INVALID_STATE")))) {
          toast.warning("This match has been updated by another action. Refreshing now…");
          await fetchMatch();
          return;
        }
        // Re-throw the evidence-waiver gate so the caller (StateProgressionCard)
        // can reopen the waiver dialog instead of just toasting a generic error.
        // The toast is suppressed here because the dialog itself is the recovery UX.
        if (err instanceof ApiError && (err.code === "EVIDENCE_WAIVER_REQUIRED" || err.code === "WAIVER_NOT_APPLICABLE" || err.code === "WAIVER_INVALID")) {
          throw err;
        }
        dispatchEligibilityFailed(match.id, err);
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
        queryClient.invalidateQueries({ queryKey: ["state-progression-evidence", match.id] });
        queryClient.invalidateQueries({ queryKey: ["evidence-waiver-latest", match.id] });

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
      // Allow callers (StateProgressionCard) to react to specific recoverable
      // errors like EVIDENCE_WAIVER_REQUIRED by reopening the waiver dialog.
      rethrow: true,
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
