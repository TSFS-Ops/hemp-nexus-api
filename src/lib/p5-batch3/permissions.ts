/**
 * P-5 Batch 3 — Stage 2 funder permission matrix (pure TS).
 *
 * Role alone NEVER grants access to a transaction/deal/evidence pack;
 * an active access grant is always required. See access-grants.ts.
 */
import type { P5B3FunderRole } from "./constants";

export type P5B3FunderCapability =
  // view
  | "view_released_evidence_pack"
  | "view_admin_released_notes"
  | "view_request_thread"
  | "view_outcome_history"
  // do
  | "submit_request"
  | "mark_outcome"
  | "request_more_info"
  | "request_term_sheet"
  | "submit_funding_decision"
  | "voluntary_exit"
  | "manage_funder_users"
  | "configure_funder_org"
  | "download_released_pack"
  // never
  | "view_raw_documents"
  | "view_full_bank_details"
  | "view_full_id_passport"
  | "view_admin_internal_notes"
  | "view_provider_raw_response"
  | "view_other_funders"
  | "approve_credit_directly"
  | "alter_governance_or_finality"
  | "export_csv_or_database";

const VIEW_BASE: P5B3FunderCapability[] = [
  "view_released_evidence_pack",
  "view_admin_released_notes",
  "view_request_thread",
  "view_outcome_history",
];

const ALWAYS_FORBIDDEN: P5B3FunderCapability[] = [
  "view_raw_documents",
  "view_full_bank_details",
  "view_full_id_passport",
  "view_admin_internal_notes",
  "view_provider_raw_response",
  "view_other_funders",
  "approve_credit_directly",
  "alter_governance_or_finality",
  "export_csv_or_database",
];

const MATRIX: Record<P5B3FunderRole, P5B3FunderCapability[]> = {
  funder_viewer: [...VIEW_BASE, "download_released_pack"],
  funder_reviewer: [
    ...VIEW_BASE,
    "download_released_pack",
    "submit_request",
    "request_more_info",
  ],
  funder_approver: [
    ...VIEW_BASE,
    "download_released_pack",
    "submit_request",
    "request_more_info",
    "request_term_sheet",
    "mark_outcome",
    "submit_funding_decision",
  ],
  funder_org_admin: [
    ...VIEW_BASE,
    "download_released_pack",
    "voluntary_exit",
    "manage_funder_users",
    "configure_funder_org",
  ],
  external_adviser: [...VIEW_BASE],
};

export function allowedCapabilities(role: P5B3FunderRole): P5B3FunderCapability[] {
  return [...MATRIX[role]];
}

export function canFunderDo(
  role: P5B3FunderRole,
  capability: P5B3FunderCapability,
): boolean {
  if (ALWAYS_FORBIDDEN.includes(capability)) return false;
  return MATRIX[role].includes(capability);
}

export function forbiddenCapabilities(): P5B3FunderCapability[] {
  return [...ALWAYS_FORBIDDEN];
}
