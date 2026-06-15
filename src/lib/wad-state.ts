/**
 * WaD State Machine - Single Source of Truth
 *
 * Defines all WaD (Signed Deal) statuses, valid transitions, and action guards.
 * Components MUST use these guards instead of inline `wad.status === "sealed"` checks.
 *
 * The backend enforces the 9 hard-gates for WaD issuance;
 * this module keeps the UI from offering impossible actions.
 */

// ─── Statuses ───────────────────────────────────────────────────────

// NOTE: keep this list in sync with the `wads_status_check` constraint in
// the database. `awaiting_attestations` is a real persisted status the
// backend transitions into after the WaD is created (before any signatory
// has attested). Omitting it here previously caused
// `canDo("awaiting_attestations", "attest")` to return `false`, which made
// the WadStepper show "Attestation not available - Only buyer and seller
// signatories can attest" to legitimate counterparties (incident
// 2026-04-24: dovedavies14 could not attest as the seller).
export const WAD_STATUSES = [
  "draft",
  "awaiting_attestations",
  "sealed",
  "revoked",
  "superseded",
] as const;
export type WadStatusValue = (typeof WAD_STATUSES)[number];

// ─── Actions ────────────────────────────────────────────────────────

export const WAD_ACTIONS = [
  "attest",
  "seal",
  "revoke",
  "download_certificate",
  "view_evidence",
  "admin_access",
] as const;

export type WadAction = (typeof WAD_ACTIONS)[number];

// ─── Action guard map ───────────────────────────────────────────────

const ALLOWED_ACTIONS: Record<WadStatusValue, readonly WadAction[]> = {
  draft: [
    "attest",
    "seal",
    "view_evidence",
  ],
  // Same affordances as `draft` - both signatories may still attest, and
  // sealing is permitted once both attestations are in place.
  awaiting_attestations: [
    "attest",
    "seal",
    "view_evidence",
  ],
  sealed: [
    "revoke",
    "download_certificate",
    "view_evidence",
    "admin_access",
  ],
  revoked: [
    "view_evidence",
  ],
  superseded: [
    "view_evidence",
  ],
};

// ─── Valid transitions ──────────────────────────────────────────────

export const VALID_TRANSITIONS: Record<WadStatusValue, readonly WadStatusValue[]> = {
  draft:                 ["awaiting_attestations", "sealed", "revoked"],
  awaiting_attestations: ["sealed", "revoked"],
  sealed:                ["revoked"],
  revoked:               [],
  superseded:            [],
};

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Check whether a specific action is allowed for a WaD in the given status.
 */
export function canDo(status: string, action: WadAction): boolean {
  const allowed = ALLOWED_ACTIONS[status as WadStatusValue];
  if (!allowed) return false;
  return allowed.includes(action);
}

/**
 * Get all actions permitted for the given status.
 */
export function getAllowedActions(status: string): readonly WadAction[] {
  return ALLOWED_ACTIONS[status as WadStatusValue] ?? [];
}

/**
 * Validate whether a WaD status transition is permitted.
 * Returns null if valid, or an error message if invalid.
 */
export function validateTransition(from: string, to: string): string | null {
  const allowed = VALID_TRANSITIONS[from as WadStatusValue];
  if (!allowed) return `Invalid current status: ${from}`;
  if (!allowed.includes(to as WadStatusValue)) {
    return `Transition from ${from} to ${to} is not permitted. Valid: [${allowed.join(", ")}]`;
  }
  return null;
}

/**
 * Convenience: is the WaD in a terminal state?
 */
export function isTerminal(status: string): boolean {
  return status === "revoked" || status === "superseded";
}

/**
 * Convenience: is the WaD sealed?
 */
export function isSealed(status: string): boolean {
  return status === "sealed";
}

/**
 * Human-readable label for a WaD status.
 *
 * Batch B Fix 6 - unknown / future enum values must not render as the
 * raw literal. We surface them as an explicit "Unrecognised" badge so
 * the UI cannot accidentally imply progression for a status the client
 * does not know how to interpret.
 */
const WAD_STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  awaiting_attestations: "Awaiting attestations",
  sealed: "Sealed",
  revoked: "Revoked",
  superseded: "Superseded",
};

export function statusLabel(status: string): string {
  if (WAD_STATUS_LABELS[status]) return WAD_STATUS_LABELS[status];
  if (!status) return "Unrecognised status";
  return `Unrecognised status (${status})`;
}

export function isKnownWadStatusLabel(status: string): boolean {
  return Boolean(WAD_STATUS_LABELS[status]);
}
