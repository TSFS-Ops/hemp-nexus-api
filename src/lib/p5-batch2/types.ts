/**
 * P-5 Batch 2 — TypeScript shapes for KYC records, evidence items, versions,
 * review events, packs and waivers. These mirror the Stage 1 migration tables
 * but expose only fields safe to share across the codebase; sensitive columns
 * (e.g. `reviewer_note_internal`, `notes_internal`) remain admin-only and are
 * never serialised to non-admin surfaces in later stages.
 */
import type {
  P5B2EvidenceRating,
  P5B2EvidenceStatus,
  P5B2KycRecordType,
  P5B2ProviderStatus,
  P5B2RejectionReason,
  P5B2ReplacementReason,
  P5B2RequirementLevel,
} from "./constants";

export interface P5B2KycRecord {
  id: string;
  record_type: P5B2KycRecordType;
  display_name: string;
  jurisdiction: string | null;
  entity_type: string | null;
  organization_id: string | null;
  counterparty_id: string | null;
  match_id: string | null;
  trade_request_id: string | null;
  programme_id: string | null;
  api_client_id: string | null;
  owner_user_id: string | null;
  is_high_risk: boolean;
  status_summary: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface P5B2EvidenceItem {
  id: string;
  record_id: string;
  category: string;
  requirement_level: P5B2RequirementLevel;
  status: P5B2EvidenceStatus;
  rating: P5B2EvidenceRating | null;
  expiry_date: string | null;
  provider_dependency: boolean;
  provider_status: P5B2ProviderStatus | null;
  provider_name: string | null;
  provider_live: boolean;
  provider_result_reference: string | null;
  last_provider_attempt_at: string | null;
  current_version_id: string | null;
  current_rejection_reason: P5B2RejectionReason | null;
  customer_safe_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  supports: string[];
  is_suspended: boolean;
  is_waived: boolean;
  created_at: string;
  updated_at: string;
}

export interface P5B2EvidenceVersion {
  id: string;
  evidence_item_id: string;
  version_number: number;
  file_storage_path: string | null;
  file_hash: string;
  file_size_bytes: number | null;
  mime_type: string | null;
  uploaded_by: string | null;
  uploader_role: string | null;
  uploaded_at: string;
  replacement_reason: P5B2ReplacementReason | null;
  replacement_note: string | null;
  is_current: boolean;
  archived_at: string | null;
  audit_reference: string | null;
}

export interface P5B2EvidenceReviewEvent {
  id: string;
  evidence_item_id: string;
  version_id: string | null;
  action: string;
  previous_status: P5B2EvidenceStatus | null;
  new_status: P5B2EvidenceStatus | null;
  rejection_reason: P5B2RejectionReason | null;
  customer_safe_note: string | null;
  actor_user_id: string | null;
  actor_role: string | null;
  actor_type: string;
  correlation_id: string | null;
  created_at: string;
}

export interface P5B2EvidencePack {
  id: string;
  organization_id: string | null;
  counterparty_id: string | null;
  match_id: string | null;
  trade_request_id: string | null;
  pack_reason: string;
  pack_status: string;
  hash_chain_reference: string | null;
  sealed_by: string | null;
  sealed_at: string;
  superseded_by: string | null;
  created_at: string;
}

export interface P5B2EvidencePackItem {
  id: string;
  pack_id: string;
  evidence_item_id: string;
  version_id: string;
  snapshot_status: P5B2EvidenceStatus;
  snapshot_rating: P5B2EvidenceRating | null;
  snapshot_file_hash: string;
  snapshot_at: string;
}

export interface P5B2EvidenceWaiver {
  id: string;
  evidence_item_id: string;
  scope: string;
  reason_text: string;
  expires_at: string | null;
  approved_by: string | null;
  approved_at: string;
  revoked_at: string | null;
  revoked_by: string | null;
}
