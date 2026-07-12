/**
 * Institutional Funder Evidence Workspace — Batch 2
 * Shared TypeScript types (SSOT for admin console UI + client library).
 *
 * These mirror the Batch 1 database schema exactly. Do NOT mutate on the
 * server via any path other than the fw_admin_* / fw_* RPCs.
 */

export const FUNDER_TYPES = [
  "commercial_bank",
  "dfi",
  "mdb",
  "treasury_entity",
  "eca",
  "private_debt_fund",
] as const;
export type FunderType = (typeof FUNDER_TYPES)[number];

export const FUNDER_TYPE_LABELS: Record<FunderType, string> = {
  commercial_bank: "Commercial bank",
  dfi: "Development finance institution",
  mdb: "Multilateral development bank",
  treasury_entity: "Treasury entity",
  eca: "Export credit agency",
  private_debt_fund: "Private debt fund",
};

export const ONBOARDING_STATUSES = [
  "submitted",
  "under_review",
  "approved",
  "rejected",
  "withdrawn",
] as const;
export type OnboardingStatus = (typeof ONBOARDING_STATUSES)[number];

export const FUNDER_ORG_APPROVAL_STATUSES = [
  "admin_created",
  "requested",
  "approved",
  "rejected",
  "suspended",
] as const;
export type FunderOrgApprovalStatus =
  (typeof FUNDER_ORG_APPROVAL_STATUSES)[number];

export const FUNDER_ORG_STATUSES = ["active", "suspended", "closed"] as const;
export type FunderOrgStatus = (typeof FUNDER_ORG_STATUSES)[number];

export const RELEASE_STATUSES = [
  "draft",
  "active",
  "expired",
  "revoked",
] as const;
export type ReleaseStatus = (typeof RELEASE_STATUSES)[number];

export const CONSENT_STATUSES = [
  "not_required",
  "pending",
  "granted",
  "declined",
  "overridden",
] as const;
export type ConsentStatus = (typeof CONSENT_STATUSES)[number];

export const USAGE_EVENT_TYPES = [
  "organisation_requested",
  "organisation_approved",
  "organisation_rejected",
  "deal_released",
  "deal_access_revoked",
  "pack_generated",
  "pack_downloaded",
  "raw_document_viewed",
  "raw_document_downloaded",
  "rfi_created",
  "rfi_answered",
  "decision_recorded",
  "user_invited",
  "user_deactivated",
] as const;
export type UsageEventType = (typeof USAGE_EVENT_TYPES)[number];

// ─────────────────────────────────────────────────────────────
// Row shapes (mirror DB columns; nullable columns marked optional)
// ─────────────────────────────────────────────────────────────

export interface OnboardingRequestRow {
  id: string;
  organisation_name: string;
  registration_number: string | null;
  jurisdiction: string | null;
  website: string | null;
  approved_email_domain: string | null;
  primary_contact_name: string;
  primary_contact_email: string;
  primary_contact_phone: string | null;
  funder_type: FunderType;
  reason_for_access: string | null;
  status: OnboardingStatus;
  requested_by: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  approval_funder_organisation_id: string | null;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface FunderOrganisationRow {
  id: string;
  name: string;
  registration_number: string | null;
  jurisdiction: string | null;
  contact_email: string | null;
  status: FunderOrgStatus;
  approval_status: FunderOrgApprovalStatus | null;
  requested_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  rejected_by: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  suspended_at: string | null;
  suspended_by: string | null;
  suspension_reason: string | null;
  contact_person_name: string | null;
  contact_phone: string | null;
  created_at: string;
  updated_at: string;
}

export const DEAL_LINKAGE_STATUSES = [
  "canonical",
  "legacy_fallback",
  "legacy_unresolved",
  "invalid",
] as const;
export type DealLinkageStatus = (typeof DEAL_LINKAGE_STATUSES)[number];

export interface DealReleaseRow {
  id: string;
  funder_organisation_id: string;
  deal_reference: string;
  evidence_pack_id: string | null;
  evidence_pack_version: string | null;
  release_status: ReleaseStatus;
  released_by: string | null;
  released_at: string | null;
  release_reason: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  revoked_by: string | null;
  revocation_reason: string | null;
  can_view_evidence_summary: boolean;
  can_view_evidence_room: boolean;
  can_download_compiled_pack: boolean;
  can_view_raw_documents: boolean;
  can_download_raw_documents: boolean;
  can_view_unmasked_sensitive_details: boolean;
  buyer_consent_status: ConsentStatus;
  seller_consent_status: ConsentStatus;
  admin_override_reason: string | null;
  match_id: string | null;
  deal_linkage_status: DealLinkageStatus | null;
  deal_linked_at: string | null;
  deal_linked_by: string | null;
  deal_linkage_reason: string | null;
  created_at: string;
  updated_at: string;
}


export interface ReleaseConsentRow {
  id: string;
  release_id: string;
  party_type: "buyer" | "seller";
  party_id: string | null;
  status: ConsentStatus;
  captured_by: string | null;
  captured_at: string | null;
  source: string | null;
  override_reason: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface PackVersionRow {
  id: string;
  release_id: string;
  pack_id: string;
  version: number;
  status: "pending" | "generated" | "sealed" | "superseded" | "revoked" | "failed";
  storage_bucket: string | null;
  storage_path: string | null;
  file_sha256: string | null;
  manifest_sha256: string | null;
  generated_at: string | null;
  sealed_at: string | null;
  download_expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface UsageEventRow {
  id: string;
  funder_organisation_id: string | null;
  actor_user_id: string | null;
  deal_reference: string | null;
  release_id: string | null;
  pack_version_id: string | null;
  event_type: UsageEventType;
  event_metadata: Record<string, unknown>;
  occurred_at: string;
  created_at: string;
}

export interface AuditEventRow {
  id: string;
  user_id: string | null;
  funder_organisation_id: string | null;
  action: string;
  object_type: string | null;
  object_id: string | null;
  prior_state: Record<string, unknown> | null;
  new_state: Record<string, unknown> | null;
  reason_code: string | null;
  source_channel: string | null;
  created_at: string;
}

// ─────────────────────────────────────────────────────────────
// RPC input shapes (Batch 1 RPC contracts — do NOT change signatures)
// ─────────────────────────────────────────────────────────────

export interface ApproveOnboardingInput {
  p_request_id: string;
  p_notes_internal: string | null;
}

export interface RejectOnboardingInput {
  p_request_id: string;
  p_reason: string;
}

export interface ReleaseDealInput {
  p_funder_organisation_id: string;
  p_deal_reference: string;
  p_evidence_pack_id: string | null;
  p_evidence_pack_version: string | null;
  p_release_reason: string;
  p_expires_at: string;
  p_can_download_compiled_pack: boolean;
  p_can_view_raw_documents: boolean;
  p_can_download_raw_documents: boolean;
  p_can_view_unmasked_sensitive_details: boolean;
  p_buyer_consent_status: ConsentStatus;
  p_seller_consent_status: ConsentStatus;
  p_admin_override_reason: string | null;
}

export interface RevokeReleaseInput {
  p_release_id: string;
  p_reason: string;
}
