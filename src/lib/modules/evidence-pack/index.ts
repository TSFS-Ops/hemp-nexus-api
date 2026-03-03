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
 * Verify that an evidence pack's event chain is consistent.
 */
export function verifyEventChain(events: EvidenceEvent[]): boolean {
  if (events.length === 0) return true;
  
  for (let i = 1; i < events.length; i++) {
    const prev = events[i - 1];
    const curr = events[i];
    if (prev.toState !== curr.fromState) {
      return false;
    }
  }
  return true;
}
