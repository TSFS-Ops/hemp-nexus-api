/**
 * Consequence / WaD Layer — Layer 4 (Phase 1 Minimal Stub)
 * 
 * Responsible for sealing evidence bundles into immutable
 * "Without a Doubt" records once a POI reaches COLLAPSED state.
 * 
 * This module owns:
 * - WaD creation and sealing
 * - Certificate generation
 * - Immutability enforcement post-collapse
 * - Supersession chain (ANNULLED → new WaD)
 */

export interface ConsequenceRecord {
  wadId: string;
  poiId: string;
  sealHash: string;
  status: 'draft' | 'sealed' | 'revoked';
  sealedAt?: string;
}

/**
 * Check if a consequence record can be created for a POI.
 * Requires COLLAPSED state.
 */
export function canCreateConsequence(poiState: string): boolean {
  return poiState === 'COLLAPSED';
}

/**
 * Check if a consequence record can be superseded.
 * Only possible if the POI has been ANNULLED.
 */
export function canSupersede(poiState: string): boolean {
  return poiState === 'ANNULLED';
}
