/**
 * WaD State Machine - Single Source of Truth
 *
 * Defines all WaD (Finalised Commitment) statuses, valid transitions, and action guards.
 * Components MUST use these guards instead of inline `wad.status === "sealed"` checks.
 *
 * The backend enforces the 9 hard-gates for WaD issuance;
 * this module keeps the UI from offering impossible actions.
 */

// ─── Statuses ───────────────────────────────────────────────────────

export const WAD_STATUSES = ["draft", "sealed", "revoked", "superseded"] as const;
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
  draft:      ["sealed", "revoked"],
  sealed:     ["revoked"],
  revoked:    [],
  superseded: [],
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
 */
export function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    draft: "Draft",
    sealed: "Sealed",
    revoked: "Revoked",
    superseded: "Superseded",
  };
  return labels[status] ?? status;
}
