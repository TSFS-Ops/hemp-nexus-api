/**
 * Jurisdiction Module - Three-Branch Deterministic Rule
 *
 * Implements the confirmed jurisdiction selection logic for the WaD documentary path:
 *   Branch 1: One clear signal → auto-select
 *   Branch 2: Multiple signals → user chooses from surfaced set
 *   Branch 3: Material conflict → escalate to manual governance review
 *
 * "Material conflict" is defined as:
 *   - The chosen jurisdiction does not match any jurisdiction surfaced by the system, OR
 *   - No documentary rules exist for the chosen jurisdiction in governance_doc_registry
 *
 * Refactored into focused sub-modules:
 *   - types.ts: Shared interfaces
 *   - signals.ts: Signal derivation from all pre-POI data sources
 *   - rules.ts: Three-branch logic and validation
 *   - persistence.ts: Save/fetch jurisdiction selections + governance rule checks
 */

export type {
  JurisdictionSignal,
  SelectionMethod,
  JurisdictionResult,
  JurisdictionSelection,
} from "./types";

export { deriveJurisdictionSignals } from "./signals";

export {
  deduplicateSignals,
  getUniqueCodes,
  applyThreeBranchRule,
  validateSelection,
} from "./rules";

export {
  hasGovernanceRules,
  fetchJurisdictionSelection,
  saveJurisdictionSelection,
} from "./persistence";
