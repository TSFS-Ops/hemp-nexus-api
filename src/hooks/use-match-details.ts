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
import { handleApiError as toastApiError } from "@/lib/api-error-handler";
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

/**
 * Wraps an Error with a backend `requestId` so the outer toast handler can
 * show it via {@link extractRequestId}, even when we rethrow with a friendlier
 * message. We also append "(trace: <id>)" to the message itself as a belt-and-
 * braces fallback for any callsite that only logs `error.message`.
 */
function rethrowWithTrace(message: string, requestId: string | null): never {
  const finalMessage = requestId ? `${message} (trace: ${requestId})` : message;
  const err = new Error(finalMessage) as Error & { requestId?: string | null };
  err.requestId = requestId;
  throw err;
}

function handleApiError(err: unknown, actionPath?: string): never {
  // Prefer structured ApiError details so we can surface the real reason
  if (err instanceof ApiError) {
    const trace = err.requestId ?? null;
    // Specific 422 codes get bespoke messages (don't pretend every 422 is a POI eligibility failure)
    if (err.code === "WAD_NOT_SEALED") {
      rethrowWithTrace(
        "A sealed Signed Deal (WaD) evidence bundle is required before completing this trade. Open the Signed Deal step to attest and seal the bundle, then return here to complete.",
        trace,
      );
    }
    if (err.code === "ELIGIBILITY_FAILED") {
      rethrowWithTrace(formatEligibilityMessage(err.details), trace);
    }
    // Only treat a generic 422 as a POI eligibility failure when we are
    // actually performing POI generation. Otherwise surface the server's
    // own message so users aren't told to "fix the Terms tab" for an
    // unrelated step (e.g. Complete Trade hitting WAD_NOT_SEALED).
    if (err.status === 422) {
      if (actionPath === "generate-poi") {
        rethrowWithTrace(formatEligibilityMessage(err.details), trace);
      }
      rethrowWithTrace(
        `${err.message} If this persists, contact support@izenzo.co.za.`,
        trace,
      );
    }
    if (err.code === "INSUFFICIENT_TOKENS" || /insufficient/i.test(err.message)) {
      rethrowWithTrace("Insufficient credits. Purchase more credits from the Billing page.", trace);
    }
    if (err.code === "DISPUTE_ACTIVE" || /dispute/i.test(err.message)) {
      rethrowWithTrace("Cannot proceed while an active dispute exists. Resolve the dispute first.", trace);
    }
    if (err.code === "STATE_CONFLICT" || err.code === "INVALID_STATE" || /already/i.test(err.message)) {
      throw new StateConflictError("This match has been updated by another action. Refreshing now…");
    }
    if (err.status === 403 || err.code === "FORBIDDEN" || /permission/i.test(err.message)) {
      rethrowWithTrace("You do not have permission to modify this match.", trace);
    }
    rethrowWithTrace(
      `${err.message} If this persists, contact support@izenzo.co.za.`,
      trace,
    );
  }

  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("INSUFFICIENT_TOKENS") || msg.includes("insufficient")) {
    rethrowWithTrace("Insufficient credits. Purchase more credits from the Billing page.", null);
  }
  if (msg.includes("ELIGIBILITY_FAILED") || msg.includes("eligibility")) {
    rethrowWithTrace(formatEligibilityMessage(null), null);
  }
  if (msg.includes("DISPUTE_ACTIVE") || msg.includes("dispute")) {
    rethrowWithTrace("Cannot proceed while an active dispute exists. Resolve the dispute first.", null);
  }
  if (msg.includes("INVALID_STATE") || msg.includes("STATE_CONFLICT") || msg.includes("already")) {
    throw new StateConflictError("This match has been updated by another action. Refreshing now…");
  }
  if (msg.includes("FORBIDDEN") || msg.includes("permission")) {
    rethrowWithTrace("You do not have permission to modify this match.", null);
  }
  rethrowWithTrace(`Action failed: ${msg}. If this persists, contact support@izenzo.co.za.`, null);
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
        toast.success("POI sealed. 1 credit deducted. Execution-readiness checks (Signed Deal / WaD) still pending.");
      }
    },
    {
      successMessage: undefined,
      errorMessage: "Failed to confirm intent. Please try again.",
      traceContext: "POI generation",
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
        // Re-shape the server error into a user-friendly Error that still
        // carries the backend `requestId` so the toast can show the trace id.
        let rethrown: unknown = err;
        try {
          handleApiError(err, actionPath);
        } catch (shaped) {
          rethrown = shaped;
        }
        // For POI generation we toast HERE (with the explicit traceContext
        // "POI generation") so the trace id is labelled correctly. We then
        // mark the error so the outer canonical handler skips it.
        if (actionPath === "generate-poi") {
          toastApiError(rethrown, {
            traceContext: "POI generation",
            errorMessage: "POI generation failed. Please try again.",
          });
          if (rethrown && typeof rethrown === "object") {
            (rethrown as { __alreadyToasted?: boolean }).__alreadyToasted = true;
          }
        }
        throw rethrown;
      }

      // ── ENGAGEMENT_PENDING (202 soft-route from match edge function) ──
      // The server returns a typed payload — NOT a full Match — when the
      // counterparty is named but not registered/attached. No credits were
      // burned; refresh the match so the UI reflects the new pending
      // engagement and toast info (not "POI sealed").
      const softRouted =
        updated &&
        typeof updated === "object" &&
        (updated as { code?: string }).code === "ENGAGEMENT_PENDING";

      if (softRouted && actionPath === "generate-poi") {
        if (mountedRef.current) {
          await fetchMatch();
          const payload = updated as unknown as {
            counterparty_name?: string;
            missing_party?: string;
          };
          const who = payload.counterparty_name || `the ${payload.missing_party ?? "counterparty"}`;
          toast.info(
            `Pending engagement created. ${who} is not yet registered on the platform — no credits were used. POI minting will resume once they accept.`,
            { duration: 8000 },
          );
        }
        return;
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
          "generate-poi": "POI sealed. 1 credit deducted. Execution-readiness checks (Signed Deal / WaD) still pending.",
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
