/**
 * Evidence Pack Generator — Layer 5
 * 
 * Responsible for assembling complete evidence bundles from
 * POI events, documents, WaD seals, and audit logs.
 * 
 * This module owns:
 * - Evidence pack assembly
 * - Hash verification
 * - Document inclusion rules
 * - Export formatting (JSON, PDF stub)
 */

export interface EvidencePack {
  matchId: string;
  poiState: string;
  events: EvidenceEvent[];
  documents: EvidenceDocument[];
  sealHash?: string;
  generatedAt: string;
}

export interface EvidenceEvent {
  id: string;
  fromState: string;
  toState: string;
  actor: string;
  reason?: string;
  timestamp: string;
}

export interface EvidenceDocument {
  id: string;
  filename: string;
  docType: string;
  sha256Hash: string;
  uploadedAt: string;
}

/**
 * Assemble an evidence pack from raw data.
 */
export function assembleEvidencePack(
  matchId: string,
  poiState: string,
  events: EvidenceEvent[],
  documents: EvidenceDocument[],
  sealHash?: string
): EvidencePack {
  return {
    matchId,
    poiState,
    events,
    documents,
    sealHash,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Event chain integrity verification is performed by the
 * EvidenceChainIndicator component, which validates the actual
 * hash chain (payload_hash → previous_event_hash) from match_events.
 * See: src/components/EvidenceChainIndicator.tsx
 */
