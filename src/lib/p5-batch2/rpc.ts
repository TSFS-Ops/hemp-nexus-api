/**
 * P-5 Batch 2 — Stage 4 RPC wrappers.
 *
 * Thin, typed wrappers around the Stage 3 SECURITY DEFINER RPCs. Stage 4
 * admin/operator UI MUST use these helpers — components do not call
 * `supabase.from('p5_batch2_*').insert/update/delete` directly.
 *
 * Wrappers do not enforce authorisation themselves: the server RPCs are the
 * authoritative boundary (role checks, status transitions, audit writes,
 * provider-live guards).
 */
import { supabase } from "@/integrations/supabase/client";
import type {
  P5B2EvidenceRating,
  P5B2EvidenceStatus,
  P5B2KycRecordType,
  P5B2ProviderStatus,
  P5B2RejectionReason,
  P5B2ReplacementReason,
} from "./constants";

// The Supabase typegen file only includes RPCs that existed at generation
// time. Stage 3 RPCs may not have a typed entry yet — cast to a permissive
// shape so the wrappers compile while the underlying call remains correct.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = (name: string, args: Record<string, unknown>) =>
  (supabase as unknown as { rpc: (n: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }> })
    .rpc(name, args);

export interface P5B2RpcResult<T = unknown> {
  ok: boolean;
  data: T | null;
  error: string | null;
}

async function call<T = unknown>(name: string, args: Record<string, unknown>): Promise<P5B2RpcResult<T>> {
  try {
    const { data, error } = await rpc(name, args);
    if (error) return { ok: false, data: null, error: error.message };
    return { ok: true, data: data as T, error: null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, data: null, error: msg };
  }
}

/* -------------------------------------------------------------------------- */
/*  Record lifecycle                                                          */
/* -------------------------------------------------------------------------- */

export interface CreateKycRecordArgs {
  record_type: P5B2KycRecordType;
  display_name: string;
  organization_id?: string | null;
  counterparty_id?: string | null;
  match_id?: string | null;
  trade_request_id?: string | null;
  programme_id?: string | null;
  api_client_id?: string | null;
  owner_user_id?: string | null;
  jurisdiction?: string | null;
  entity_type?: string | null;
  is_high_risk?: boolean;
  notes_internal?: string | null;
  correlation_id?: string | null;
}
export const p5b2CreateKycRecord = (a: CreateKycRecordArgs) =>
  call("p5b2_create_kyc_record", {
    p_record_type: a.record_type,
    p_display_name: a.display_name,
    p_organization_id: a.organization_id ?? null,
    p_counterparty_id: a.counterparty_id ?? null,
    p_match_id: a.match_id ?? null,
    p_trade_request_id: a.trade_request_id ?? null,
    p_programme_id: a.programme_id ?? null,
    p_api_client_id: a.api_client_id ?? null,
    p_owner_user_id: a.owner_user_id ?? null,
    p_jurisdiction: a.jurisdiction ?? null,
    p_entity_type: a.entity_type ?? null,
    p_is_high_risk: a.is_high_risk ?? false,
    p_notes_internal: a.notes_internal ?? null,
    p_correlation_id: a.correlation_id ?? null,
  });

export interface LinkRecordsArgs {
  parent_record_id: string;
  child_record_id: string;
  link_type: string;
  effective_from?: string | null;
  effective_to?: string | null;
  note?: string | null;
}
export const p5b2LinkRecords = (a: LinkRecordsArgs) =>
  call("p5b2_link_records", {
    p_parent_record_id: a.parent_record_id,
    p_child_record_id: a.child_record_id,
    p_link_type: a.link_type,
    p_effective_from: a.effective_from ?? null,
    p_effective_to: a.effective_to ?? null,
    p_note: a.note ?? null,
  });

export const p5b2GenerateChecklist = (record_id: string) =>
  call("p5b2_generate_checklist", { p_record_id: record_id });

/* -------------------------------------------------------------------------- */
/*  Evidence lifecycle                                                        */
/* -------------------------------------------------------------------------- */

export interface UploadEvidenceVersionArgs {
  evidence_item_id: string;
  file_storage_path: string;
  file_hash: string;
  file_size_bytes?: number | null;
  mime_type?: string | null;
  replacement_reason?: P5B2ReplacementReason | null;
  replacement_note?: string | null;
}
export const p5b2UploadEvidenceVersion = (a: UploadEvidenceVersionArgs) =>
  call("p5b2_upload_evidence_version", {
    p_evidence_item_id: a.evidence_item_id,
    p_file_storage_path: a.file_storage_path,
    p_file_hash: a.file_hash,
    p_file_size_bytes: a.file_size_bytes ?? null,
    p_mime_type: a.mime_type ?? null,
    p_replacement_reason: a.replacement_reason ?? null,
    p_replacement_note: a.replacement_note ?? null,
  });

export type P5B2ReviewAction =
  | "accept"
  | "accept_with_warning"
  | "reject"
  | "request_correction";

export interface ReviewEvidenceArgs {
  evidence_item_id: string;
  action: P5B2ReviewAction;
  new_status: P5B2EvidenceStatus;
  rating?: P5B2EvidenceRating | null;
  reason_code?: P5B2RejectionReason | null;
  customer_safe_note?: string | null;
  reviewer_note_internal?: string | null;
}
export const p5b2ReviewEvidence = (a: ReviewEvidenceArgs) =>
  call("p5b2_review_evidence", {
    p_evidence_item_id: a.evidence_item_id,
    p_action: a.action,
    p_new_status: a.new_status,
    p_rating: a.rating ?? null,
    p_reason_code: a.reason_code ?? null,
    p_customer_safe_note: a.customer_safe_note ?? null,
    p_reviewer_note_internal: a.reviewer_note_internal ?? null,
  });

export interface SetProviderStateArgs {
  evidence_item_id: string;
  provider_status: P5B2ProviderStatus;
  provider_name?: string | null;
  provider_live?: boolean;
  provider_result_reference?: string | null;
  reviewer_note_internal?: string | null;
}
export const p5b2SetProviderState = (a: SetProviderStateArgs) =>
  call("p5b2_set_provider_state", {
    p_evidence_item_id: a.evidence_item_id,
    p_provider_status: a.provider_status,
    p_provider_name: a.provider_name ?? null,
    p_provider_live: a.provider_live ?? false,
    p_provider_result_reference: a.provider_result_reference ?? null,
    p_reviewer_note_internal: a.reviewer_note_internal ?? null,
  });

export interface WaiveEvidenceArgs {
  evidence_item_id: string;
  scope: string;
  reason_text: string;
  expires_at?: string | null;
}
export const p5b2WaiveEvidence = (a: WaiveEvidenceArgs) =>
  call("p5b2_waive_evidence", {
    p_evidence_item_id: a.evidence_item_id,
    p_scope: a.scope,
    p_reason_text: a.reason_text,
    p_expires_at: a.expires_at ?? null,
  });

export interface WithdrawEvidenceArgs {
  evidence_item_id: string;
  reason_text: string;
}
export const p5b2WithdrawEvidence = (a: WithdrawEvidenceArgs) =>
  call("p5b2_withdraw_evidence", {
    p_evidence_item_id: a.evidence_item_id,
    p_reason_text: a.reason_text,
  });

export interface SuspendReleaseArgs {
  evidence_item_id: string;
  mode: "suspend" | "release";
  reason_text: string;
}
export const p5b2SuspendRelease = (a: SuspendReleaseArgs) =>
  call("p5b2_suspend_release", {
    p_evidence_item_id: a.evidence_item_id,
    p_mode: a.mode,
    p_reason_text: a.reason_text,
  });

/* -------------------------------------------------------------------------- */
/*  Finality & sensitive access                                               */
/* -------------------------------------------------------------------------- */

export interface SnapshotFinalityPackArgs {
  organization_id?: string | null;
  counterparty_id?: string | null;
  match_id?: string | null;
  trade_request_id?: string | null;
  pack_reason: string;
  evidence_item_ids: string[];
}
export const p5b2SnapshotFinalityPack = (a: SnapshotFinalityPackArgs) =>
  call("p5b2_snapshot_finality_pack", {
    p_organization_id: a.organization_id ?? null,
    p_counterparty_id: a.counterparty_id ?? null,
    p_match_id: a.match_id ?? null,
    p_trade_request_id: a.trade_request_id ?? null,
    p_pack_reason: a.pack_reason,
    p_evidence_item_ids: a.evidence_item_ids,
  });

export interface LogSensitiveAccessArgs {
  evidence_item_id?: string | null;
  record_id?: string | null;
  field: string;
  reason_text: string;
  action: "unmask" | "download";
}
export const p5b2LogSensitiveAccess = (a: LogSensitiveAccessArgs) =>
  call("p5b2_log_sensitive_access", {
    p_evidence_item_id: a.evidence_item_id ?? null,
    p_record_id: a.record_id ?? null,
    p_field: a.field,
    p_reason_text: a.reason_text,
    p_action: a.action,
  });

/** Registry of every wrapper name — used by Stage 4 tests to assert that
 * the UI only mutates state via these helpers (no direct table writes). */
export const P5B2_RPC_WRAPPER_NAMES = [
  "p5b2CreateKycRecord",
  "p5b2LinkRecords",
  "p5b2GenerateChecklist",
  "p5b2UploadEvidenceVersion",
  "p5b2ReviewEvidence",
  "p5b2SetProviderState",
  "p5b2WaiveEvidence",
  "p5b2WithdrawEvidence",
  "p5b2SuspendRelease",
  "p5b2SnapshotFinalityPack",
  "p5b2LogSensitiveAccess",
] as const;
