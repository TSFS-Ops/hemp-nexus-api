/**
 * P-5 Batch 4 Stage 3 — typed RPC client wrappers.
 *
 * Thin layer around `supabase.rpc(...)` that:
 *  - names every Batch 4 RPC exactly once (no string drift in callers),
 *  - splits admin / funder / org-user surfaces so Stage 4-6 UI cannot
 *    import the wrong wrapper from the wrong surface,
 *  - relies on the SQL function bodies for permission/reason gates —
 *    the client side cannot bypass them.
 */
import { supabase } from "@/integrations/supabase/client";
import type {
  P5B4BlockerKey,
  P5B4BlockerType,
  P5B4EvidenceStatus,
  P5B4FinalityOutcome,
  P5B4FunderReleaseStatus,
  P5B4MandatoryType,
  P5B4MilestoneKey,
  P5B4ProcessType,
} from "./constants";

/** Every Batch 4 v1 RPC. Used by the Stage 3 isolation guard and tests. */
export const P5B4_RPC_NAMES = [
  "p5b4_open_case_v1",
  "p5b4_confirm_scope_v1",
  "p5b4_close_case_v1",
  "p5b4_reopen_case_v1",
  "p5b4_generate_checklist_v1",
  "p5b4_request_evidence_v1",
  "p5b4_submit_evidence_v1",
  "p5b4_review_evidence_v1",
  "p5b4_waive_evidence_v1",
  "p5b4_open_blocker_v1",
  "p5b4_resolve_blocker_v1",
  "p5b4_override_blocker_v1",
  "p5b4_complete_milestone_v1",
  "p5b4_record_governance_decision_v1",
  "p5b4_record_compliance_decision_v1",
  "p5b4_release_funder_pack_v1",
  "p5b4_revoke_funder_access_v1",
  "p5b4_record_funder_decision_v1",
  "p5b4_record_final_approval_v1",
  "p5b4_record_finality_v1",
  "p5b4_record_audit_event_v1",
] as const;
export type P5B4RpcName = (typeof P5B4_RPC_NAMES)[number];

/** RPCs callable only by platform admins (gate enforced in SQL). */
export const P5B4_ADMIN_RPCS: readonly P5B4RpcName[] = [
  "p5b4_open_case_v1",
  "p5b4_confirm_scope_v1",
  "p5b4_close_case_v1",
  "p5b4_reopen_case_v1",
  "p5b4_generate_checklist_v1",
  "p5b4_request_evidence_v1",
  "p5b4_review_evidence_v1",
  "p5b4_waive_evidence_v1",
  "p5b4_open_blocker_v1",
  "p5b4_resolve_blocker_v1",
  "p5b4_override_blocker_v1",
  "p5b4_complete_milestone_v1",
  "p5b4_record_governance_decision_v1",
  "p5b4_record_compliance_decision_v1",
  "p5b4_release_funder_pack_v1",
  "p5b4_revoke_funder_access_v1",
  "p5b4_record_final_approval_v1",
  "p5b4_record_finality_v1",
  "p5b4_record_audit_event_v1",
];

/** RPCs that REQUIRE a reason string (≥4 chars) in their input. */
export const P5B4_REASON_REQUIRED_RPCS: readonly P5B4RpcName[] = [
  "p5b4_close_case_v1",
  "p5b4_reopen_case_v1",
  "p5b4_waive_evidence_v1",
  "p5b4_resolve_blocker_v1",
  "p5b4_override_blocker_v1",
  "p5b4_revoke_funder_access_v1",
  "p5b4_record_final_approval_v1",
  "p5b4_record_finality_v1",
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const r = supabase.rpc.bind(supabase) as any;

// ---------- Admin set ----------
export const p5b4Admin = {
  openCase: (args: {
    case_reference: string;
    process_type: P5B4ProcessType;
    owner_user_id: string;
    linked_company_id?: string | null;
    linked_transaction_id?: string | null;
    linked_project_id?: string | null;
  }) =>
    r("p5b4_open_case_v1", {
      p_case_reference: args.case_reference,
      p_process_type: args.process_type,
      p_owner_user_id: args.owner_user_id,
      p_linked_company_id: args.linked_company_id ?? null,
      p_linked_transaction_id: args.linked_transaction_id ?? null,
      p_linked_project_id: args.linked_project_id ?? null,
    }),
  confirmScope: (caseId: string, note: string) =>
    r("p5b4_confirm_scope_v1", { p_case_id: caseId, p_scope_note: note }),
  closeCase: (caseId: string, reason: string) =>
    r("p5b4_close_case_v1", { p_case_id: caseId, p_reason: reason }),
  reopenCase: (caseId: string, reason: string) =>
    r("p5b4_reopen_case_v1", { p_case_id: caseId, p_reason: reason }),
  generateChecklist: (caseId: string) =>
    r("p5b4_generate_checklist_v1", { p_case_id: caseId }),
  requestEvidence: (caseId: string, type: string, label: string, req: P5B4MandatoryType) =>
    r("p5b4_request_evidence_v1", {
      p_case_id: caseId, p_evidence_type: type,
      p_evidence_label: label, p_requirement_type: req,
    }),
  reviewEvidence: (evidenceId: string, decision: P5B4EvidenceStatus, reason: string | null) =>
    r("p5b4_review_evidence_v1", {
      p_evidence_id: evidenceId, p_decision: decision, p_reason: reason,
    }),
  waiveEvidence: (evidenceId: string, reason: string) =>
    r("p5b4_waive_evidence_v1", { p_evidence_id: evidenceId, p_reason: reason }),
  openBlocker: (args: {
    case_id: string; blocker_key: P5B4BlockerKey; blocker_name: string;
    blocker_type: P5B4BlockerType; external_safe_label: string; internal_detail: string | null;
  }) =>
    r("p5b4_open_blocker_v1", {
      p_case_id: args.case_id, p_blocker_key: args.blocker_key,
      p_blocker_name: args.blocker_name, p_blocker_type: args.blocker_type,
      p_external_safe_label: args.external_safe_label,
      p_internal_detail: args.internal_detail,
    }),
  resolveBlocker: (blockerId: string, reason: string) =>
    r("p5b4_resolve_blocker_v1", { p_blocker_id: blockerId, p_reason: reason }),
  overrideBlocker: (blockerId: string, reason: string) =>
    r("p5b4_override_blocker_v1", { p_blocker_id: blockerId, p_reason: reason }),
  completeMilestone: (caseId: string, key: P5B4MilestoneKey) =>
    r("p5b4_complete_milestone_v1", { p_case_id: caseId, p_milestone_key: key }),
  recordGovernanceDecision: (caseId: string, decision: string, reason: string | null) =>
    r("p5b4_record_governance_decision_v1", {
      p_case_id: caseId, p_decision: decision, p_reason: reason,
    }),
  recordComplianceDecision: (caseId: string, decision: string, reason: string | null) =>
    r("p5b4_record_compliance_decision_v1", {
      p_case_id: caseId, p_decision: decision, p_reason: reason,
    }),
  releaseFunderPack: (args: {
    case_id: string; funder_org_id: string; pack_reference: string;
    access_expires_at: string; download_allowed: boolean; nda_required: boolean;
    release_scope?: Record<string, unknown>;
  }) =>
    r("p5b4_release_funder_pack_v1", {
      p_case_id: args.case_id, p_funder_org_id: args.funder_org_id,
      p_pack_reference: args.pack_reference,
      p_access_expires_at: args.access_expires_at,
      p_download_allowed: args.download_allowed,
      p_nda_required: args.nda_required,
      p_release_scope: args.release_scope ?? {},
    }),
  revokeFunderAccess: (releaseId: string, reason: string) =>
    r("p5b4_revoke_funder_access_v1", { p_release_id: releaseId, p_reason: reason }),
  recordFinalApproval: (caseId: string, reason: string) =>
    r("p5b4_record_final_approval_v1", { p_case_id: caseId, p_reason: reason }),
  recordFinality: (args: {
    case_id: string; final_outcome: P5B4FinalityOutcome;
    finality_summary: string; reason: string;
    evidence_pack_reference?: string | null;
    approval_reference?: string | null;
    memory_summary?: Record<string, unknown>;
  }) =>
    r("p5b4_record_finality_v1", {
      p_case_id: args.case_id, p_final_outcome: args.final_outcome,
      p_finality_summary: args.finality_summary, p_reason: args.reason,
      p_evidence_pack_reference: args.evidence_pack_reference ?? null,
      p_approval_reference: args.approval_reference ?? null,
      p_memory_summary: args.memory_summary ?? {},
    }),
  recordAuditEvent: (caseId: string, eventType: string, externalSafe: string, internal: string) =>
    r("p5b4_record_audit_event_v1", {
      p_case_id: caseId, p_event_type: eventType,
      p_external_safe: externalSafe, p_internal: internal,
    }),
};

// ---------- Org-user / counterparty set ----------
export const p5b4OrgUser = {
  submitEvidence: (evidenceId: string, fileReference: string, fileHash: string) =>
    r("p5b4_submit_evidence_v1", {
      p_evidence_id: evidenceId,
      p_file_reference: fileReference,
      p_file_hash: fileHash,
    }),
};

// ---------- Funder set ----------
export const p5b4Funder = {
  recordDecision: (releaseId: string, status: P5B4FunderReleaseStatus, note: string | null) =>
    r("p5b4_record_funder_decision_v1", {
      p_release_id: releaseId, p_status: status, p_note: note,
    }),
};
