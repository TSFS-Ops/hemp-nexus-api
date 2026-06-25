/**
 * P-5 Batch 4 — Role → allowed-action matrix (pure).
 *
 * Mirrors the brief's role-based actions section. The matrix is the
 * source of truth for permission checks; backend RPCs (Stage 3) must
 * call `isActionAllowed` before mutating.
 */
import { P5B4_ROLE_KEYS, type P5B4RoleKey } from "./constants";

export const P5B4_ACTIONS = [
  "create_case",
  "assign_owner",
  "edit_milestones",
  "request_evidence",
  "upload_own_evidence",
  "replace_own_evidence",
  "respond_to_request",
  "review_standard_evidence",
  "review_sensitive_evidence",
  "approve_governance",
  "approve_compliance",
  "release_compliance_hold",
  "waive_evidence",
  "propose_blocker",
  "propose_waiver",
  "override_blocker",
  "escalate",
  "complete_non_final_milestone",
  "release_funder_pack",
  "revoke_funder_access",
  "mark_funder_interested",
  "mark_funder_not_interested",
  "mark_funder_more_information_requested",
  "mark_funder_approved_internally",
  "mark_funder_declined",
  "ask_funder_question",
  "record_final_approval",
  "record_finality",
  "close_case",
  "reopen_case",
  "view_internal_notes",
  "view_other_funders",
  "view_other_organisations",
  "view_raw_sensitive_evidence",
  "read_safe_api_status",
  "system_automation",
] as const;
export type P5B4Action = (typeof P5B4_ACTIONS)[number];

type RoleMatrix = Record<P5B4RoleKey, ReadonlySet<P5B4Action>>;

const A = (...xs: P5B4Action[]): ReadonlySet<P5B4Action> => new Set(xs);

export const P5B4_ROLE_ACTIONS: RoleMatrix = {
  platform_admin: A(
    "create_case", "assign_owner", "edit_milestones", "request_evidence",
    "review_standard_evidence", "review_sensitive_evidence",
    "approve_governance", "approve_compliance", "release_compliance_hold",
    "waive_evidence", "propose_blocker", "propose_waiver", "override_blocker",
    "escalate", "complete_non_final_milestone",
    "release_funder_pack", "revoke_funder_access",
    "record_final_approval", "record_finality", "close_case", "reopen_case",
    "view_internal_notes", "view_other_funders", "view_other_organisations",
    "view_raw_sensitive_evidence",
  ),
  operator: A(
    "create_case", "request_evidence", "review_standard_evidence",
    "propose_blocker", "propose_waiver", "escalate",
    "complete_non_final_milestone", "view_internal_notes",
  ),
  organisation_user: A(
    "upload_own_evidence", "replace_own_evidence", "respond_to_request",
  ),
  counterparty: A(
    "upload_own_evidence", "respond_to_request",
  ),
  funder_viewer: A(),
  funder_reviewer: A(
    "ask_funder_question", "mark_funder_more_information_requested",
  ),
  funder_approver: A(
    "ask_funder_question",
    "mark_funder_interested", "mark_funder_not_interested",
    "mark_funder_approved_internally", "mark_funder_declined",
    "mark_funder_more_information_requested",
  ),
  api_user: A("read_safe_api_status"),
  developer_system: A("system_automation"),
};

export function isActionAllowed(role: P5B4RoleKey, action: P5B4Action): boolean {
  return P5B4_ROLE_ACTIONS[role].has(action);
}

/** Defensive guard: ensure every role key has an entry. */
export function assertRoleMatrixComplete(): void {
  for (const r of P5B4_ROLE_KEYS) {
    if (!(r in P5B4_ROLE_ACTIONS)) {
      throw new Error(`P5B4 role matrix missing role: ${r}`);
    }
  }
}
