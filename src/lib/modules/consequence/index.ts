/**
 * Consequence Module — WaD Orchestration Layer
 *
 * This module is the single application-layer authority for WaD (Without-a-Doubt)
 * workflow decisions. Components MUST use this module instead of inline WaD logic.
 *
 * Responsibilities:
 * - Determining whether WaD actions are available and why not
 * - Orchestrating WaD creation, attestation, sealing, certificate download
 * - Shaping WaD state for UI consumption
 * - Centralising blocked-reason logic
 * - Providing typed results with explicit error handling
 *
 * Non-responsibilities:
 * - Raw UI rendering (components own that)
 * - Backend enforcement of the 9 hard-gates (edge function owns that)
 * - State machine transitions (wad-state.ts owns valid transition rules)
 */

import { apiFetch, ApiError, AuthRequiredError } from "@/lib/api-client";
import * as WadState from "@/lib/wad-state";
import type { WadAction, WadStatusValue } from "@/lib/wad-state";

// ─── Types ──────────────────────────────────────────────────────────

export interface WadRecord {
  id: string;
  poi_id: string;
  status: string;
  evidence_bundle: Record<string, unknown> | null;
  seal_hash: string | null;
  sealed_at: string | null;
  created_at: string;
  buyer_org_id: string | null;
  seller_org_id: string | null;
  revoked_reason?: string | null;
  attestations?: WadAttestation[];
}

export interface WadAttestation {
  id: string;
  wad_id: string;
  user_id: string;
  org_id: string;
  role: string;
  attested_name: string;
  attested_at: string;
  attestation_text: string;
}

export interface BlockedReason {
  gate: string;
  reason: string;
}

export type ConsequenceUiStatus =
  | "not_started"
  | "blocked"
  | "draft"
  | "awaiting_attestations"
  | "ready_to_seal"
  | "sealed"
  | "revoked"
  | "superseded";

export interface ConsequenceState {
  /** Current UI-facing status */
  uiStatus: ConsequenceUiStatus;
  /** Human-readable label */
  statusLabel: string;
  /** The WaD record if one exists */
  wad: WadRecord | null;
  /** Whether the user can create a new WaD */
  canCreate: boolean;
  /** Why WaD creation is blocked (empty if canCreate is true) */
  createBlockedReasons: BlockedReason[];
  /** Whether the user can attest */
  canAttest: boolean;
  /** Whether the user has already attested */
  hasAttested: boolean;
  /** Whether all required attestations are present */
  allAttested: boolean;
  /** Whether the WaD can be sealed now */
  canSeal: boolean;
  /** Whether a certificate is available for download */
  canDownloadCertificate: boolean;
  /** Whether the WaD can be revoked */
  canRevoke: boolean;
  /** Whether the WaD is in a terminal state */
  isTerminal: boolean;
  /** Attestation breakdown */
  attestations: {
    buyerAttested: boolean;
    sellerAttested: boolean;
    total: number;
  };
}

export interface ConsequenceResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  gateFailures?: string[];
}

// ─── State Derivation ───────────────────────────────────────────────

/**
 * Derive the full consequence state from available data.
 * This is the single source of truth for what the UI should show.
 */
export function deriveConsequenceState(
  wad: WadRecord | null,
  matchStatus: string,
  userOrgId: string | null
): ConsequenceState {
  // No WaD exists
  if (!wad) {
    const canCreate = matchStatus === "settled";
    const createBlockedReasons: BlockedReason[] = [];

    if (matchStatus !== "settled") {
      createBlockedReasons.push({
        gate: "poi_status",
        reason: "Both parties must confirm intent before a WaD can be created.",
      });
    }

    return {
      uiStatus: canCreate ? "not_started" : "blocked",
      statusLabel: canCreate ? "Ready to create" : "Intent not confirmed",
      wad: null,
      canCreate,
      createBlockedReasons,
      canAttest: false,
      hasAttested: false,
      allAttested: false,
      canSeal: false,
      canDownloadCertificate: false,
      canRevoke: false,
      isTerminal: false,
      attestations: { buyerAttested: false, sellerAttested: false, total: 0 },
    };
  }

  // WaD exists — derive from its state
  const buyerAttested = wad.attestations?.some(a => a.role === "buyer_signatory") ?? false;
  const sellerAttested = wad.attestations?.some(a => a.role === "seller_signatory") ?? false;
  const allAttested = buyerAttested && sellerAttested;
  const hasAttested = wad.attestations?.some(a => a.org_id === userOrgId) ?? false;
  const isTerminal = WadState.isTerminal(wad.status);
  const isSealed = WadState.isSealed(wad.status);

  // Determine if user is a party
  const isParty = userOrgId === wad.buyer_org_id || userOrgId === wad.seller_org_id;

  // Can attest: user is a party, hasn't attested, WaD allows it
  const canAttest = isParty && !hasAttested && WadState.canDo(wad.status, "attest");

  // Can seal: all attested and WaD allows it
  const canSeal = allAttested && WadState.canDo(wad.status, "seal");

  // UI status derivation
  let uiStatus: ConsequenceUiStatus;
  if (isSealed) {
    uiStatus = "sealed";
  } else if (wad.status === "revoked") {
    uiStatus = "revoked";
  } else if (wad.status === "superseded") {
    uiStatus = "superseded";
  } else if (allAttested) {
    uiStatus = "ready_to_seal";
  } else if ((wad.attestations?.length ?? 0) > 0) {
    uiStatus = "awaiting_attestations";
  } else {
    uiStatus = "draft";
  }

  return {
    uiStatus,
    statusLabel: mapUiStatusToLabel(uiStatus),
    wad,
    canCreate: false,
    createBlockedReasons: [],
    canAttest,
    hasAttested,
    allAttested,
    canSeal,
    canDownloadCertificate: isSealed,
    canRevoke: WadState.canDo(wad.status, "revoke"),
    isTerminal,
    attestations: {
      buyerAttested,
      sellerAttested,
      total: wad.attestations?.length ?? 0,
    },
  };
}

function mapUiStatusToLabel(status: ConsequenceUiStatus): string {
  const labels: Record<ConsequenceUiStatus, string> = {
    not_started: "Ready to create",
    blocked: "Blocked — prerequisites not met",
    draft: "Draft — awaiting attestations",
    awaiting_attestations: "Awaiting remaining attestation",
    ready_to_seal: "Ready to seal",
    sealed: "Sealed",
    revoked: "Revoked",
    superseded: "Superseded",
  };
  return labels[status];
}

// ─── Orchestration — WaD Lifecycle ──────────────────────────────────

/**
 * Fetch the active (non-terminal) WaD for a match/POI.
 * Returns null if none exists.
 */
export async function fetchActiveWad(matchId: string): Promise<ConsequenceResult<WadRecord | null>> {
  try {
    const wads = await apiFetch<WadRecord[]>(`wad?poi_id=${matchId}`);
    const active = wads.find(w => !WadState.isTerminal(w.status));

    if (!active) {
      return { success: true, data: null };
    }

    // Fetch full detail including attestations
    const detail = await apiFetch<WadRecord>(`wad/${active.id}`);
    return { success: true, data: detail };
  } catch (err) {
    return {
      success: false,
      error: err instanceof AuthRequiredError
        ? "Session expired. Please sign in again."
        : err instanceof Error ? err.message : "Failed to fetch WaD",
    };
  }
}

/**
 * Create a new WaD for the given match/POI.
 * The backend enforces the 9 hard-gates; this module surfaces gate failures.
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
      error: err instanceof Error ? err.message : "Failed to create WaD",
    };

    // Surface gate failures from the backend error shape
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
  role: "buyer_signatory" | "seller_signatory" | "witness"
): Promise<ConsequenceResult<void>> {
  if (!attestedName.trim()) {
    return { success: false, error: "Signatory name is required." };
  }

  try {
    await apiFetch(`wad/${wadId}/attest`, {
      method: "POST",
      body: JSON.stringify({ attested_name: attestedName, role }),
    });
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to submit attestation",
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
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to seal WaD",
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
      error: err instanceof Error ? err.message : "Failed to revoke WaD",
    };
  }
}

/**
 * Download the sealed certificate PDF.
 * Returns a Blob on success for the caller to handle download UX.
 */
export async function downloadCertificate(wadId: string): Promise<ConsequenceResult<Blob>> {
  try {
    // Certificate endpoint returns a PDF binary, not JSON — use raw fetch via apiFetch
    // but we need the raw response for blob handling
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
 * Trigger browser download of a blob as a file.
 */
export function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Role Resolution ────────────────────────────────────────────────

/**
 * Determine the attestation role for the current user based on their org.
 */
export function resolveAttestationRole(
  userOrgId: string | null,
  buyerOrgId: string | null,
  sellerOrgId: string | null
): "buyer_signatory" | "seller_signatory" | "witness" {
  if (userOrgId === buyerOrgId) return "buyer_signatory";
  if (userOrgId === sellerOrgId) return "seller_signatory";
  return "witness";
}

// ─── Supersession ───────────────────────────────────────────────────

/**
 * Fetch the full WaD chain for a POI (includes superseded/revoked records).
 * Useful for displaying version history.
 */
export async function fetchWadChain(matchId: string): Promise<ConsequenceResult<WadRecord[]>> {
  try {
    const wads = await apiFetch<WadRecord[]>(`wad?poi_id=${matchId}`);
    // Sort by created_at ascending for chronological display
    const sorted = [...wads].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
    return { success: true, data: sorted };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to fetch WaD history",
    };
  }
}

/**
 * Check if a POI has superseded WaDs in its history.
 */
export function hasSupersessionHistory(wads: WadRecord[]): boolean {
  return wads.some(w => w.status === "revoked" || w.status === "superseded");
}

// ─── Re-exports for convenience ─────────────────────────────────────

export { WadState };
export type { WadAction, WadStatusValue };
