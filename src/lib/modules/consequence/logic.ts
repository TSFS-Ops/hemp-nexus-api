/**
 * Consequence Module - Pure Logic (no browser/supabase dependencies)
 *
 * This file contains all deterministic state derivation and helper functions
 * that can be tested without browser APIs. The main index.ts re-exports these
 * and adds the async orchestration methods that depend on apiFetch/supabase.
 */

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
  uiStatus: ConsequenceUiStatus;
  statusLabel: string;
  wad: WadRecord | null;
  canCreate: boolean;
  createBlockedReasons: BlockedReason[];
  canAttest: boolean;
  hasAttested: boolean;
  allAttested: boolean;
  canSeal: boolean;
  canDownloadCertificate: boolean;
  canRevoke: boolean;
  isTerminal: boolean;
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
  /**
   * Server correlation ID surfaced from ApiError (or other transports) so the
   * UI can show a "Reference ID" the user can include when reporting issues.
   */
  requestId?: string;
  /**
   * High-level error category so the UI can render tailored next-step hints
   * without having to introspect HTTP status codes itself.
   *   - auth_required: no/expired session - user must sign in again
   *   - client_error:  4xx other than 401 - user-correctable (validation, conflict, forbidden)
   *   - server_error:  5xx - transient/infra; retry then escalate
   *   - network_error: status 0 (timeout/offline)
   *   - unknown:       anything else (non-Error throws, etc.)
   */
  errorKind?: "auth_required" | "client_error" | "server_error" | "network_error" | "unknown";
  /** Raw HTTP status (when known) - useful for telemetry/tests. */
  errorStatus?: number;
}

// ─── State Derivation ───────────────────────────────────────────────

export function deriveConsequenceState(
  wad: WadRecord | null,
  matchStatus: string,
  userOrgId: string | null
): ConsequenceState {
  if (!wad) {
    const canCreate = matchStatus === "settled";
    const createBlockedReasons: BlockedReason[] = [];

    if (matchStatus !== "settled") {
      createBlockedReasons.push({
        gate: "poi_status",
        reason: "Both parties must confirm intent before a Signed Deal can be created.",
      });
    }

    return {
      uiStatus: canCreate ? "not_started" : "blocked",
      statusLabel: canCreate ? "Ready to create" : "Blocked - prerequisites not met",
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

  const buyerAttested = wad.attestations?.some(a => a.role === "buyer_signatory") ?? false;
  const sellerAttested = wad.attestations?.some(a => a.role === "seller_signatory") ?? false;
  const allAttested = buyerAttested && sellerAttested;
  const hasAttested = wad.attestations?.some(a => a.org_id === userOrgId) ?? false;
  const isTerminal = WadState.isTerminal(wad.status);
  const isSealed = WadState.isSealed(wad.status);
  const isParty = userOrgId === wad.buyer_org_id || userOrgId === wad.seller_org_id;
  const canAttest = isParty && !hasAttested && WadState.canDo(wad.status, "attest");
  const canSeal = allAttested && WadState.canDo(wad.status, "seal");

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
    blocked: "Blocked - prerequisites not met",
    draft: "Draft - awaiting attestations",
    awaiting_attestations: "Awaiting remaining attestation",
    ready_to_seal: "Ready to seal",
    sealed: "Sealed",
    revoked: "Revoked",
    superseded: "Superseded",
  };
  return labels[status];
}

// ─── Role Resolution ────────────────────────────────────────────────

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

export function hasSupersessionHistory(wads: WadRecord[]): boolean {
  return wads.some(w => w.status === "revoked" || w.status === "superseded");
}

export function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Re-exports
export { WadState };
export type { WadAction, WadStatusValue };
