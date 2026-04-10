/**
 * Jurisdiction Module - Three-Branch Rule & Validation
 */

import type { JurisdictionSignal, JurisdictionResult } from "./types";

/**
 * Deduplicate signals by jurisdiction code, keeping all source labels.
 */
export function deduplicateSignals(signals: JurisdictionSignal[]): JurisdictionSignal[] {
  const map = new Map<string, JurisdictionSignal>();
  for (const signal of signals) {
    const existing = map.get(signal.code);
    if (existing) {
      existing.label = `${existing.label}; ${signal.label}`;
    } else {
      map.set(signal.code, { ...signal });
    }
  }
  return Array.from(map.values());
}

/**
 * Get unique jurisdiction codes from signals.
 */
export function getUniqueCodes(signals: JurisdictionSignal[]): string[] {
  return [...new Set(signals.map((s) => s.code))];
}

/**
 * Apply the three-branch deterministic rule to surfaced signals.
 */
export function applyThreeBranchRule(signals: JurisdictionSignal[]): JurisdictionResult {
  const deduped = deduplicateSignals(signals);
  const uniqueCodes = getUniqueCodes(signals);

  if (uniqueCodes.length === 0) {
    return { surfacedJurisdictions: deduped, branch: 3, autoSelected: null };
  }

  if (uniqueCodes.length === 1) {
    return { surfacedJurisdictions: deduped, branch: 1, autoSelected: uniqueCodes[0] };
  }

  return { surfacedJurisdictions: deduped, branch: 2, autoSelected: null };
}

/**
 * Validate a user's jurisdiction choice against the three-branch rules.
 * Returns null if valid, or an escalation reason string if invalid.
 */
export function validateSelection(
  chosenCode: string,
  surfacedCodes: string[],
): string | null {
  if (surfacedCodes.length > 0 && !surfacedCodes.includes(chosenCode)) {
    return `Selected jurisdiction '${chosenCode}' does not match any jurisdiction surfaced from the transaction data (${surfacedCodes.join(", ")}). Escalated to manual governance review.`;
  }
  return null;
}
