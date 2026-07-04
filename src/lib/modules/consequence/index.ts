/**
 * Consequence Module - WaD Orchestration Layer
 *
 * This module is the single application-layer authority for WaD (Signed Deal)
 * workflow decisions. Components MUST use this module instead of inline WaD logic.
 *
 * - Pure logic (state derivation, role resolution) lives in ./logic.ts
 * - Async orchestration (API calls) lives here
 */

import { apiFetch, ApiError, AuthRequiredError, generateIdempotencyKey } from "@/lib/api-client";
import * as WadState from "@/lib/wad-state";

// Re-export all pure logic and types
export {
  deriveConsequenceState,
  resolveAttestationRole,
  hasSupersessionHistory,
  triggerBlobDownload,
  WadState,
} from "./logic";

export type {
  WadRecord,
  WadAttestation,
  BlockedReason,
  ConsequenceUiStatus,
  ConsequenceState,
  ConsequenceResult,
  WadAction,
  WadStatusValue,
} from "./logic";

import type { WadRecord, ConsequenceResult } from "./logic";

// ─── Orchestration - WaD Lifecycle ──────────────────────────────────

/**
 * Fetch the active (non-terminal) WaD for a match/POI.
 */
export async function fetchActiveWad(matchId: string): Promise<ConsequenceResult<WadRecord | null>> {
  try {
    const wads = await apiFetch<WadRecord[]>(`wad?poi_id=${matchId}`);
    const active = wads.find(w => !WadState.isTerminal(w.status));

    if (!active) {
      return { success: true, data: null };
    }

    const detail = await apiFetch<WadRecord>(`wad/${active.id}`);
    return { success: true, data: detail };
  } catch (err) {
    return {
      success: false,
      error: err instanceof AuthRequiredError
        ? "Session expired. Please sign in again."
        : err instanceof Error ? err.message : "Failed to fetch Signed Deal",
    };
  }
}

/**
 * Create a new WaD for the given match/POI.
 */
export async function createWad(matchId: string): Promise<ConsequenceResult<WadRecord>> {
  try {
    const wad = await apiFetch<WadRecord>("wad", {
      method: "POST",
      body: JSON.stringify({ poi_id: matchId }),
    });
    return { success: true, data: wad };
  } catch (err) {
    const result: ConsequenceResult<WadRecord> = {
      success: false,
      error: err instanceof Error ? err.message : "Failed to create Signed Deal",
    };
    if (err && typeof err === "object" && "failures" in err) {
      result.gateFailures = (err as { failures: string[] }).failures;
    }
    return result;
  }
}

/**
 * Submit an attestation for the current user on a WaD.
 */
export async function submitAttestation(
  wadId: string,
  attestedName: string,
  role: "buyer_signatory" | "seller_signatory" | "witness",
  idempotencyKey = generateIdempotencyKey(`wad_attest_${wadId}`),
): Promise<ConsequenceResult<void>> {
  if (!attestedName.trim()) {
    return { success: false, error: "Signatory name is required." };
  }

  try {
    await apiFetch(`wad/${wadId}/attest`, {
      method: "POST",
      idempotencyKey,
      body: JSON.stringify({ attested_name: attestedName, role }),
    });
    return { success: true };
  } catch (err) {
    let errorKind: ConsequenceResult<void>["errorKind"] = "unknown";
    let errorStatus: number | undefined;
    if (err instanceof AuthRequiredError) {
      errorKind = "auth_required";
    } else if (err instanceof ApiError) {
      errorStatus = err.status;
      if (err.status === 0) errorKind = "network_error";
      else if (err.status === 401) errorKind = "auth_required";
      else if (err.status >= 500) errorKind = "server_error";
      else if (err.status >= 400) errorKind = "client_error";
    }
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to submit attestation",
      requestId: err instanceof ApiError ? err.requestId ?? undefined : undefined,
      errorKind,
      errorStatus,
    };
  }
}

/**
 * Seal a WaD after all attestations are present.
 */
export async function sealWad(wadId: string): Promise<ConsequenceResult<void>> {
  try {
    await apiFetch(`wad/${wadId}/seal`, { method: "POST" });
    return { success: true };
  } catch (err) {
    // Batch V-UI-Fix — surface IDV controlled-action blocks so callers
    // can render the friendly notice instead of a raw error toast.
    const { extractIdvBlockerFromError } = await import("@/lib/idv/blocker-from-error");
    const idvBlocker = extractIdvBlockerFromError(err) ?? undefined;
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to seal Signed Deal",
      idvBlocker,
    };
  }
}

/**
 * Revoke a sealed WaD (admin action).
 */
export async function revokeWad(wadId: string, reason: string): Promise<ConsequenceResult<void>> {
  if (!reason.trim()) {
    return { success: false, error: "Revocation reason is required." };
  }

  try {
    await apiFetch(`wad/${wadId}/revoke`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to revoke Signed Deal",
    };
  }
}

/**
 * Download the sealed certificate PDF.
 */
export async function downloadCertificate(wadId: string): Promise<ConsequenceResult<Blob>> {
  try {
    const { data: { session } } = await (await import("@/integrations/supabase/client")).supabase.auth.getSession();
    if (!session) {
      return { success: false, error: "Session expired. Please sign in again." };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/wad/${wadId}/certificate`;
    const response = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${session.access_token}` },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errorBody = await response.json().catch(() => null);
      return {
        success: false,
        error: errorBody?.message || `Certificate download failed (${response.status})`,
      };
    }

    const blob = await response.blob();
    return { success: true, data: blob };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error
        ? (err.name === "AbortError" ? "Certificate download timed out. Please try again." : err.message)
        : "Failed to download certificate",
    };
  }
}

/**
 * Fetch the full WaD chain for an intent (includes superseded/revoked records).
 */
export async function fetchWadChain(matchId: string): Promise<ConsequenceResult<WadRecord[]>> {
  try {
    const wads = await apiFetch<WadRecord[]>(`wad?poi_id=${matchId}`);
    const sorted = [...wads].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
    return { success: true, data: sorted };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to fetch Signed Deal history",
    };
  }
}
