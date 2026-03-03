/**
 * Due Diligence Workspace — Layer 1 (Who)
 * 
 * Responsible for counterparty identification, KYC/KYB checks,
 * and eligibility verification before any trade intent is declared.
 * 
 * This module owns:
 * - Counterparty search and discovery
 * - Identity verification status
 * - Eligibility checks (licence, sanctions, compliance)
 */

export interface DueDiligenceResult {
  counterpartyId: string;
  counterpartyName: string;
  verified: boolean;
  eligibilityStatus: 'eligible' | 'ineligible' | 'pending';
  checks: DueDiligenceCheck[];
}

export interface DueDiligenceCheck {
  type: 'kyc' | 'kyb' | 'sanctions' | 'licence' | 'compliance';
  status: 'passed' | 'failed' | 'pending';
  timestamp: string;
  details?: Record<string, unknown>;
}

/**
 * Check if a counterparty has passed all required due diligence.
 */
export function isDueDiligenceComplete(result: DueDiligenceResult): boolean {
  return result.verified && result.eligibilityStatus === 'eligible';
}

/**
 * Get required checks for a given trade context.
 */
export function getRequiredChecks(
  _commodity: string,
  _jurisdiction: string
): DueDiligenceCheck['type'][] {
  // Phase 1: all checks required
  return ['kyc', 'kyb', 'sanctions', 'licence', 'compliance'];
}
