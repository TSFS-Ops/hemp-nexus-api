/**
 * Institutional Funder Evidence Workspace — Batch 2
 * Admin-only client. Every mutation goes through a fw_admin_* RPC.
 * NO direct table writes from UI.
 *
 * Read paths use the tenant-scoped RLS policies already declared in
 * Batch 1 (fw_*_admin_all vs fw_*_funder_select). Platform admins pass
 * the admin_all policy and can read every row.
 */
import { supabase } from "@/integrations/supabase/client";
import type {
  ApproveOnboardingInput,
  AuditEventRow,
  DealReleaseRow,
  FunderOrganisationRow,
  OnboardingRequestRow,
  PackVersionRow,
  ReleaseConsentRow,
  ReleaseDealInput,
  RejectOnboardingInput,
  RevokeReleaseInput,
  UsageEventRow,
} from "./types";

// Table names used only for typed READS. All writes must go through RPCs.
const T = {
  onboarding: "funder_org_onboarding_requests",
  organisations: "p5_batch3_funder_organisations",
  releases: "funder_deal_releases",
  consents: "funder_release_consents",
  packs: "funder_pack_versions",
  usage: "funder_usage_events",
  audit: "p5_batch3_funder_audit_events",
} as const;

function must<T>(data: T | null, error: unknown, label: string): T {
  if (error) throw new Error(`${label}: ${(error as { message?: string })?.message ?? String(error)}`);
  if (data === null || data === undefined) throw new Error(`${label}: empty response`);
  return data;
}

// ─── Onboarding requests ─────────────────────────────────────

export async function listOnboardingRequests(): Promise<OnboardingRequestRow[]> {
  const { data, error } = await (supabase as any)
    .from(T.onboarding)
    .select("*")
    .order("created_at", { ascending: false });
  return must(data as OnboardingRequestRow[] | null, error, "listOnboardingRequests");
}

export async function approveOnboardingRequest(input: ApproveOnboardingInput): Promise<string> {
  const { data, error } = await (supabase as any).rpc("fw_admin_approve_funder_org_v1", {
    p_request_id: input.p_request_id,
    p_notes_internal: input.p_notes_internal,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function rejectOnboardingRequest(input: RejectOnboardingInput): Promise<void> {
  const reason = (input.p_reason ?? "").trim();
  if (!reason) throw new Error("Rejection reason is required");
  const { error } = await (supabase as any).rpc("fw_admin_reject_funder_org_v1", {
    p_request_id: input.p_request_id,
    p_reason: reason,
  });
  if (error) throw new Error(error.message);
}

// ─── Funder organisations ────────────────────────────────────

export async function listFunderOrganisations(): Promise<FunderOrganisationRow[]> {
  const { data, error } = await (supabase as any)
    .from(T.organisations)
    .select("*")
    .order("created_at", { ascending: false });
  return must(data as FunderOrganisationRow[] | null, error, "listFunderOrganisations");
}

export async function getFunderOrganisation(id: string): Promise<FunderOrganisationRow> {
  const { data, error } = await (supabase as any)
    .from(T.organisations)
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return must(data as FunderOrganisationRow | null, error, "getFunderOrganisation");
}

// ─── Deal releases ───────────────────────────────────────────

export interface DealReleaseWithOrg extends DealReleaseRow {
  funder_organisation?: Pick<FunderOrganisationRow, "id" | "name"> | null;
}

export async function listReleases(): Promise<DealReleaseWithOrg[]> {
  const { data, error } = await (supabase as any)
    .from(T.releases)
    .select(`*, funder_organisation:${T.organisations}(id,name)`)
    .order("created_at", { ascending: false });
  return must(data as DealReleaseWithOrg[] | null, error, "listReleases");
}

export async function listReleasesForOrg(organisationId: string): Promise<DealReleaseRow[]> {
  const { data, error } = await (supabase as any)
    .from(T.releases)
    .select("*")
    .eq("funder_organisation_id", organisationId)
    .order("created_at", { ascending: false });
  return must(data as DealReleaseRow[] | null, error, "listReleasesForOrg");
}

export async function getRelease(id: string): Promise<DealReleaseWithOrg> {
  const { data, error } = await (supabase as any)
    .from(T.releases)
    .select(`*, funder_organisation:${T.organisations}(id,name)`)
    .eq("id", id)
    .maybeSingle();
  return must(data as DealReleaseWithOrg | null, error, "getRelease");
}

export async function listReleaseConsents(releaseId: string): Promise<ReleaseConsentRow[]> {
  const { data, error } = await (supabase as any)
    .from(T.consents)
    .select("*")
    .eq("release_id", releaseId)
    .order("created_at", { ascending: true });
  return must(data as ReleaseConsentRow[] | null, error, "listReleaseConsents");
}

export async function listReleasePackVersions(releaseId: string): Promise<PackVersionRow[]> {
  const { data, error } = await (supabase as any)
    .from(T.packs)
    .select("*")
    .eq("release_id", releaseId)
    .order("version", { ascending: false });
  return must(data as PackVersionRow[] | null, error, "listReleasePackVersions");
}

export async function createRelease(input: ReleaseDealInput): Promise<string> {
  const { data, error } = await (supabase as any).rpc("fw_admin_release_deal_v1", input);
  if (error) throw new Error(error.message);
  return data as string;
}

export async function revokeRelease(input: RevokeReleaseInput): Promise<void> {
  const reason = (input.p_reason ?? "").trim();
  if (!reason) throw new Error("Revocation reason is required");
  const { error } = await (supabase as any).rpc("fw_admin_revoke_deal_release_v1", {
    p_release_id: input.p_release_id,
    p_reason: reason,
  });
  if (error) throw new Error(error.message);
}

// ─── Audit + usage ───────────────────────────────────────────

export async function listUsageEvents(opts?: {
  releaseId?: string;
  organisationId?: string;
  limit?: number;
}): Promise<UsageEventRow[]> {
  let q = (supabase as any).from(T.usage).select("*").order("occurred_at", { ascending: false });
  if (opts?.releaseId) q = q.eq("release_id", opts.releaseId);
  if (opts?.organisationId) q = q.eq("funder_organisation_id", opts.organisationId);
  q = q.limit(opts?.limit ?? 200);
  const { data, error } = await q;
  return must(data as UsageEventRow[] | null, error, "listUsageEvents");
}

export async function listAuditEvents(opts?: {
  organisationId?: string;
  objectId?: string;
  limit?: number;
}): Promise<AuditEventRow[]> {
  let q = (supabase as any).from(T.audit).select("*").order("occurred_at", { ascending: false });
  if (opts?.organisationId) q = q.eq("funder_organisation_id", opts.organisationId);
  if (opts?.objectId) q = q.eq("object_id", opts.objectId);
  q = q.limit(opts?.limit ?? 200);
  const { data, error } = await q;
  return must(data as AuditEventRow[] | null, error, "listAuditEvents");
}

// ─── Batch 4: sealed pack generation ─────────────────────────
export interface GenerateSealedPackResult {
  ok: true;
  pack_version_id: string;
  pack_id: string;
  version: number;
  file_sha256: string;
  storage_bucket: string;
  storage_path: string;
}

const FRIENDLY_PACK_ERRORS: Record<string, string> = {
  unauthorized: "Sign in again — your session has expired.",
  context_denied:
    "This release cannot be generated right now (platform-admin, active release or consent check failed). Confirm you are signed in as a platform administrator and both counterparties have granted consent.",
  linkage_required:
    "No canonical deal is linked to this release. Link a canonical deal before sealing a pack.",
  invalid_release_id: "This release identifier is invalid.",
  upload_failed:
    "The sealed pack could not be uploaded to secure storage. Please retry; if it persists, contact platform support.",
  seal_failed:
    "The pack was uploaded but the sealing step failed. The orphan file has been cleaned up — please retry.",
  method_not_allowed: "Internal error (method not allowed). Please retry.",
  unhandled:
    "The pack generator hit an unexpected error. Please retry; if it persists, contact platform support with the release ID.",
};

export async function generateSealedPack(releaseId: string): Promise<GenerateSealedPackResult> {
  const invoke = (supabase as unknown as { functions: { invoke: (name: string, opts: { body: unknown }) => Promise<{ data: unknown; error: unknown }> } }).functions.invoke;
  const { data, error } = await invoke("funder-pack-generate", { body: { release_id: releaseId } });
  if (error) {
    // FunctionsHttpError wraps a Response on `.context` with the real error body.
    const ctx = (error as { context?: Response }).context;
    let body: { error?: string; detail?: string } | null = null;
    try {
      if (ctx && typeof ctx.clone === "function") body = await ctx.clone().json();
    } catch { /* ignore */ }
    const code = body?.error ?? "";
    const friendly = FRIENDLY_PACK_ERRORS[code];
    throw new Error(
      friendly ?? body?.detail ?? body?.error ?? (error as { message?: string }).message ?? "Sealed pack generation failed.",
    );
  }
  const d = data as (GenerateSealedPackResult & { error?: string; detail?: string }) | null;
  if (!d?.ok) {
    const code = d?.error ?? "";
    throw new Error(FRIENDLY_PACK_ERRORS[code] ?? d?.detail ?? d?.error ?? "Sealed pack generation failed.");
  }
  return d;
}

// ─── Batch 6: counters + assignment picker ───────────────────
export interface FunderWorkspaceAdminCounters {
  pending_onboarding: number;
  approved_orgs: number;
  active_releases: number;
  expiring_soon: number;
  revoked_releases: number;
  packs_generated: number;
  pack_downloads: number;
  open_rfis: number;
  decisions_recorded: number;
}

export async function fetchAdminCounters(): Promise<FunderWorkspaceAdminCounters> {
  const { data, error } = await (supabase as any).rpc("fw_counters_admin_v1");
  if (error) throw new Error(error.message);
  return (data ?? {}) as FunderWorkspaceAdminCounters;
}

export interface AssignableAdminUser {
  user_id: string;
  display_name: string | null;
  email: string | null;
}

export async function listAssignableAdminUsers(): Promise<AssignableAdminUser[]> {
  const { data, error } = await (supabase as any).rpc("fw_admin_assignable_users_v1");
  if (error) throw new Error(error.message);
  return (data ?? []) as AssignableAdminUser[];
}

// ─── Batch 8: canonical deal linkage ─────────────────────────
export interface ReleasableDealRow {
  match_id: string;
  display_reference: string | null;
  buyer_org_name: string | null;
  seller_org_name: string | null;
  deal_status: string | null;
  created_at: string;
  evidence_document_count: number;
}

export interface EligibleEvidencePackRow {
  evidence_pack_id: string;
  evidence_pack_version: string;
  label: string;
  created_at: string;
  item_count: number;
  pack_status: string;
}

export async function searchReleasableDeals(query: string, limit = 25): Promise<ReleasableDealRow[]> {
  const { data, error } = await (supabase as any).rpc("fw_admin_search_releasable_deals_v1", {
    p_query: query ?? "",
    p_limit: limit,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as ReleasableDealRow[];
}

export async function listEligibleEvidencePacks(matchId: string): Promise<EligibleEvidencePackRow[]> {
  if (!matchId) return [];
  const { data, error } = await (supabase as any).rpc("fw_admin_list_eligible_evidence_packs_v1", {
    p_match_id: matchId,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as EligibleEvidencePackRow[];
}

export interface ReleaseDealV2Input {
  p_funder_organisation_id: string;
  p_match_id: string;
  p_evidence_pack_id: string | null;
  p_evidence_pack_version: string | null;
  p_release_reason: string;
  p_expires_at: string;
  p_can_download_compiled_pack: boolean;
  p_can_view_raw_documents: boolean;
  p_can_download_raw_documents: boolean;
  p_can_view_unmasked_sensitive_details: boolean;
  p_buyer_consent_status: string;
  p_seller_consent_status: string;
  p_admin_override_reason: string | null;
}

export async function createReleaseV2(input: ReleaseDealV2Input): Promise<string> {
  const { data, error } = await (supabase as any).rpc("fw_admin_release_deal_v2", input);
  if (error) throw new Error(error.message);
  return data as string;
}

export async function linkReleaseToMatch(input: { p_release_id: string; p_match_id: string; p_reason: string }): Promise<void> {
  const reason = (input.p_reason ?? "").trim();
  if (!reason) throw new Error("Linkage reason is required");
  const { error } = await (supabase as any).rpc("fw_admin_link_release_to_match_v1", {
    p_release_id: input.p_release_id,
    p_match_id: input.p_match_id,
    p_reason: reason,
  });
  if (error) throw new Error(error.message);
}

// Exported RPC names — used by tests to guarantee we only call approved RPCs.
export const FUNDER_WORKSPACE_ADMIN_RPCS = [
  "fw_admin_approve_funder_org_v1",
  "fw_admin_reject_funder_org_v1",
  "fw_admin_release_deal_v1",
  "fw_admin_release_deal_v2",
  "fw_admin_revoke_deal_release_v1",
  "fw_admin_search_releasable_deals_v1",
  "fw_admin_list_eligible_evidence_packs_v1",
  "fw_admin_link_release_to_match_v1",
  "fw_counters_admin_v1",
  "fw_admin_assignable_users_v1",
] as const;


