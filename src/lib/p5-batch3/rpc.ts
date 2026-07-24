/**
 * P-5 Batch 3 — Stage 3 RPC client wrappers (thin).
 *
 * All wrappers call supabase.rpc() against the Stage 3 SECURITY DEFINER
 * functions. Server-side checks (platform_admin, active grant, etc.) are
 * authoritative; these wrappers only marshal arguments and return errors.
 *
 * No public /api/v1/funder/* endpoint is wired here.
 */
import { supabase } from "@/integrations/supabase/client";
import type {
  P5B3FunderRole,
  P5B3RequestCategory,
  P5B3OutcomeType,
  P5B3ExitReason,
} from "./constants";

export const P5B3_RPC_NAMES = [
  "p5b3_admin_create_funder_org_v1",
  "p5b3_admin_update_funder_org_v1",
  "p5b3_admin_invite_funder_user_v1",
  "p5b3_admin_assign_funder_role_v1",
  "p5b3_admin_set_funder_user_status_v1",
  "p5b3_admin_create_access_grant_v1",
  "p5b3_admin_release_pack_version_v1",
  "p5b3_admin_change_grant_expiry_v1",
  "p5b3_admin_revoke_grant_v1",
  "p5b3_admin_reactivate_grant_v1",
  "p5b3_funder_submit_request_v1",
  "p5b3_admin_edit_request_external_text_v1",
  "p5b3_admin_decide_request_v1",
  "p5b3_funder_submit_outcome_v1",
  "p5b3_admin_review_outcome_v1",
  "p5b3_admin_exit_review_v1",
  "p5b3_funder_record_download_v1",
    "p5b3_admin_resend_funder_invite_v1",
] as const;
export type P5B3RpcName = (typeof P5B3_RPC_NAMES)[number];

async function call<T = unknown>(name: P5B3RpcName, args: Record<string, unknown>): Promise<T> {
  // Untyped on purpose: typed Database mapping is regenerated post-migration.
  // We never accept user-provided SQL; only typed args.
  const client = supabase as unknown as {
    rpc: (n: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
  };
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(`${name}: ${error.message}`);
  return data as T;
}

// ---- admin: funder organisations ----
export const p5b3CreateFunderOrg = (args: {
  p_name: string; p_registration_number?: string | null;
  p_jurisdiction?: string | null; p_contact_email?: string | null;
  p_notes_internal?: string | null;
}) => call<string>("p5b3_admin_create_funder_org_v1", args);

export const p5b3UpdateFunderOrg = (args: { p_org_id: string; p_patch: Record<string, unknown> }) =>
  call<void>("p5b3_admin_update_funder_org_v1", args);

// ---- admin: funder users ----
export const p5b3InviteFunderUser = (args: {
  p_org_id: string; p_email: string; p_display_name?: string | null; p_role: P5B3FunderRole;
}) => call<string>("p5b3_admin_invite_funder_user_v1", args);

export const p5b3AssignFunderRole = (args: { p_user_id: string; p_role: P5B3FunderRole }) =>
  call<void>("p5b3_admin_assign_funder_role_v1", args);

export const p5b3SetFunderUserStatus = (args: {
  p_user_id: string; p_status: "invited" | "active" | "deactivated"; p_reason?: string | null;
}) => call<void>("p5b3_admin_set_funder_user_status_v1", args);

// ---- admin: access grants ----
export interface CreateAccessGrantArgs {
  p_user_id: string;
  p_transaction_reference: string;
  p_deal_id: string | null;
  p_evidence_pack_id: string;
  p_evidence_pack_version: string;
  p_role: P5B3FunderRole;
  p_access_scope: Record<string, unknown>;
  p_permitted_categories: string[];
  p_can_download: boolean;
  p_can_view_raw_documents: boolean;
  p_unmasked_bank_details: boolean;
  p_release_reason: string;
  p_nda_reference?: string | null;
  p_expiry_at: string; // ISO
}
export const p5b3CreateAccessGrant = (args: CreateAccessGrantArgs) =>
  call<string>("p5b3_admin_create_access_grant_v1", args as unknown as Record<string, unknown>);

export const p5b3ReleasePackVersion = (args: {
  p_grant_id: string; p_evidence_pack_id: string;
  p_evidence_pack_version: string; p_release_reason: string;
}) => call<void>("p5b3_admin_release_pack_version_v1", args);

export const p5b3ChangeGrantExpiry = (args: {
  p_grant_id: string; p_new_expiry: string; p_reason: string;
}) => call<void>("p5b3_admin_change_grant_expiry_v1", args);

export const p5b3RevokeGrant = (args: { p_grant_id: string; p_reason: string }) =>
  call<void>("p5b3_admin_revoke_grant_v1", args);

export const p5b3ReactivateGrant = (args: {
  p_grant_id: string; p_new_expiry: string; p_reason: string;
}) => call<void>("p5b3_admin_reactivate_grant_v1", args);

// ---- requests ----
export const p5b3SubmitRequest = (args: {
  p_grant_id: string; p_category: P5B3RequestCategory; p_original_message: string;
}) => call<string>("p5b3_funder_submit_request_v1", args);

export const p5b3EditRequestExternalText = (args: {
  p_request_id: string; p_admin_external_message: string;
}) => call<void>("p5b3_admin_edit_request_external_text_v1", args);

export const p5b3DecideRequest = (args: {
  p_request_id: string;
  p_decision: "approve" | "reject" | "assign" | "close";
  p_assignee?: string | null;
  p_reason?: string | null;
}) => call<void>("p5b3_admin_decide_request_v1", args);

// ---- outcomes ----
export const p5b3SubmitOutcome = (args: {
  p_grant_id: string;
  p_outcome_type: P5B3OutcomeType;
  p_conditions?: string | null;
  p_term_sheet_document_id?: string | null;
}) => call<string>("p5b3_funder_submit_outcome_v1", args);

export const p5b3ReviewOutcome = (args: {
  p_outcome_id: string; p_status: "approved" | "rejected"; p_reason?: string | null;
}) => call<void>("p5b3_admin_review_outcome_v1", args);

export const p5b3ExitReview = (args: {
  p_grant_id: string; p_exit_reason: P5B3ExitReason; p_note?: string | null;
}) => call<void>("p5b3_admin_exit_review_v1", args);

// ---- downloads ----
export const p5b3RecordDownload = (args: {
  p_grant_id: string;
  p_evidence_pack_id: string;
  p_evidence_pack_version: string;
  p_file_name: string;
  p_file_type?: string; // server enforces 'pdf'
  p_link_ttl_seconds?: number; // server caps at 604800
}) => call<string>("p5b3_funder_record_download_v1", args);

// ---- admin: funder user invitations ----
export const p5b3ResendFunderInvite = (args: { p_user_id: string }) =>
    call<{ user_id: string; email: string; funder_organisation_id: string; resent_at: string }>(
          "p5b3_admin_resend_funder_invite_v1",
          args,
        );

/** Safe summary edge function name (NOT a public /api/v1/funder/* route). */
export const P5B3_SAFE_SUMMARY_EDGE_FN = "p5-batch3-funder-summary";
