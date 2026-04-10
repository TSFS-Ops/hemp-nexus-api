/**
 * Jurisdiction Module - Shared Types
 */

export interface JurisdictionSignal {
  code: string;
  source: string;
  label: string;
}

export type SelectionMethod = "auto" | "user_choice" | "escalated";

export interface JurisdictionResult {
  /** Deduplicated jurisdiction codes surfaced from all signals */
  surfacedJurisdictions: JurisdictionSignal[];
  /** Which branch of the three-branch rule applies */
  branch: 1 | 2 | 3;
  /** Auto-selected jurisdiction (branch 1 only) */
  autoSelected: string | null;
}

export interface JurisdictionSelection {
  id: string;
  match_id: string;
  org_id: string;
  selected_jurisdiction: string;
  surfaced_jurisdictions: JurisdictionSignal[];
  selection_method: SelectionMethod;
  escalation_reason: string | null;
  selected_by: string | null;
  created_at: string;
}
