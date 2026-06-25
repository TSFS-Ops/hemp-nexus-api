/**
 * P-5 Batch 4 — Evidence rules (pure).
 *
 * Roll-up logic and terminal-status validation for evidence items.
 * All statuses and requirement types come from the Stage 1 SSOT.
 */
import {
  P5B4_EVIDENCE_TERMINAL_REVIEW_STATUSES,
  type P5B4EvidenceStatus,
  type P5B4MandatoryType,
} from "./constants";

export interface P5B4EvidenceItemView {
  requirement_type: P5B4MandatoryType;
  status: P5B4EvidenceStatus;
}

const TERMINAL = new Set<P5B4EvidenceStatus>([
  ...P5B4_EVIDENCE_TERMINAL_REVIEW_STATUSES,
]);

const SATISFIES_RECEIVED = new Set<P5B4EvidenceStatus>([
  "uploaded",
  "under_review",
  "accepted",
  "waived",
  "replaced",
  "provider_dependent",
]);

/** Evidence Received milestone may complete iff every mandatory item is uploaded or waived. */
export function isEvidenceReceived(items: readonly P5B4EvidenceItemView[]): boolean {
  const mandatory = items.filter((i) => i.requirement_type === "mandatory");
  if (mandatory.length === 0) return true;
  return mandatory.every((i) => SATISFIES_RECEIVED.has(i.status));
}

/** Evidence Review Complete requires *every* uploaded item to be in a terminal review status. */
export function isEvidenceReviewComplete(
  items: readonly P5B4EvidenceItemView[],
): boolean {
  return items.every((i) => i.status === "missing" || i.status === "requested" || TERMINAL.has(i.status));
}

export interface P5B4EvidenceGap {
  mandatoryMissing: number;
  mandatoryRejected: number;
  mandatoryExpired: number;
  providerDependent: number;
  optionalMissing: number;
}

export function summariseGaps(items: readonly P5B4EvidenceItemView[]): P5B4EvidenceGap {
  const g: P5B4EvidenceGap = {
    mandatoryMissing: 0,
    mandatoryRejected: 0,
    mandatoryExpired: 0,
    providerDependent: 0,
    optionalMissing: 0,
  };
  for (const i of items) {
    if (i.status === "provider_dependent") g.providerDependent++;
    if (i.requirement_type === "mandatory") {
      if (i.status === "missing" || i.status === "requested") g.mandatoryMissing++;
      if (i.status === "rejected") g.mandatoryRejected++;
      if (i.status === "expired") g.mandatoryExpired++;
    } else if (i.requirement_type === "optional") {
      if (i.status === "missing") g.optionalMissing++;
    }
  }
  return g;
}
