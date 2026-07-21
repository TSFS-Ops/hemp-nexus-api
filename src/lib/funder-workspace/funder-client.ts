/**
 * Institutional Funder Evidence Workspace — Batch 3
 * Funder-facing read-only client.
 *
 * All read paths are RLS-scoped via the Batch 1 policies
 * (fw_release_funder_select, fw_consent_funder_select,
 * fw_pack_funder_select, fw_usage_funder_select) which use
 * public.p5b3_current_funder_org(). We never enumerate deals and
 * filter client-side — the DB returns only rows the funder may see.
 *
 * No mutations. No admin RPCs. No PDF/download plumbing.
 */
import { supabase } from "@/integrations/supabase/client";
import type {
  AuditEventRow,
  DealReleaseRow,
  FunderOrganisationRow,
  PackVersionRow,
  ReleaseConsentRow,
  UsageEventRow,
} from "./types";

const T = {
  organisations: "p5_batch3_funder_organisations",
  funderUsers: "p5_batch3_funder_users",
  releases: "funder_deal_releases",
  consents: "funder_release_consents",
  packs: "funder_pack_versions",
  usage: "funder_usage_events",
  audit: "p5_batch3_funder_audit_events",
} as const;

export interface CurrentFunderContext {
  organisation: FunderOrganisationRow;
  role: string; // p5_batch3_funder_role enum value
  funder_user_id: string;
  email: string;
  display_name: string | null;
  status: string;
}

/** Returns the current funder user's org + role, or null if not a funder user. */
export async function getCurrentFunderContext(): Promise<CurrentFunderContext | null> {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth?.user?.id;
  if (!uid) return null;

  const { data: fu, error: fuErr } = await (supabase as any)
    .from(T.funderUsers)
    .select("id, funder_organisation_id, role, status, email, display_name")
    .eq("auth_user_id", uid)
    .maybeSingle();
  if (fuErr || !fu) return null;

  const { data: org, error: orgErr } = await (supabase as any)
    .from(T.organisations)
    .select("*")
    .eq("id", fu.funder_organisation_id)
    .maybeSingle();
  if (orgErr || !org) return null;

  return {
    organisation: org as FunderOrganisationRow,
    role: fu.role,
    funder_user_id: fu.id,
    email: fu.email,
    display_name: fu.display_name,
    status: fu.status,
  };
}

/** Assigned releases for the current funder org (RLS-scoped). */
export async function listMyReleases(): Promise<DealReleaseRow[]> {
  const { data, error } = await (supabase as any)
    .from(T.releases)
    .select("*")
    .order("released_at", { ascending: false, nullsFirst: false });
  if (error) throw new Error(`listMyReleases: ${error.message}`);
  return (data ?? []) as DealReleaseRow[];
}

/**
 * Fetch a single assigned release by id. Returns null when RLS
 * hides the row (i.e. release does not belong to the funder's org).
 * We never signal existence of hidden rows.
 */
export async function getMyRelease(releaseId: string): Promise<DealReleaseRow | null> {
  const { data, error } = await (supabase as any)
    .from(T.releases)
    .select("*")
    .eq("id", releaseId)
    .maybeSingle();
  if (error) throw new Error(`getMyRelease: ${error.message}`);
  return (data as DealReleaseRow | null) ?? null;
}

export async function listMyReleaseConsents(
  releaseId: string,
): Promise<ReleaseConsentRow[]> {
  const { data, error } = await (supabase as any)
    .from(T.consents)
    .select("*")
    .eq("release_id", releaseId)
    .order("party_type", { ascending: true });
  if (error) throw new Error(`listMyReleaseConsents: ${error.message}`);
  return (data ?? []) as ReleaseConsentRow[];
}

export async function listMyPackVersions(
  releaseId: string,
): Promise<PackVersionRow[]> {
  const { data, error } = await (supabase as any)
    .from(T.packs)
    .select("*")
    .eq("release_id", releaseId)
    .order("version", { ascending: false });
  if (error) throw new Error(`listMyPackVersions: ${error.message}`);
  return (data ?? []) as PackVersionRow[];
}

export async function listMyUsageEvents(opts?: {
  releaseId?: string;
  limit?: number;
}): Promise<UsageEventRow[]> {
  let q = (supabase as any)
    .from(T.usage)
    .select("*")
    .order("occurred_at", { ascending: false });
  if (opts?.releaseId) q = q.eq("release_id", opts.releaseId);
  q = q.limit(opts?.limit ?? 100);
  const { data, error } = await q;
  if (error) throw new Error(`listMyUsageEvents: ${error.message}`);
  return (data ?? []) as UsageEventRow[];
}

export async function listMyAuditEvents(opts?: {
  objectId?: string;
  limit?: number;
}): Promise<AuditEventRow[]> {
  let q = (supabase as any)
    .from(T.audit)
    .select("*")
    .order("occurred_at", { ascending: false });
  if (opts?.objectId) q = q.eq("object_id", opts.objectId);
  q = q.limit(opts?.limit ?? 100);
  const { data, error } = await q;
  if (error) return [];
  return (data ?? []) as AuditEventRow[];
}

// ─── Batch 4: sealed pack download ───────────────────────────
export interface RequestPackDownloadResult {
  ok: true;
  signed_url: string;
  expires_in_seconds: number;
  expires_at: string;
  version: number;
  file_sha256: string;
}

export async function requestPackDownload(
  packVersionId: string,
): Promise<RequestPackDownloadResult> {
  const { data, error } = await (supabase as any).functions.invoke(
    "funder-pack-download",
    { body: { pack_version_id: packVersionId } },
  );
  if (error) throw new Error(error.message ?? "download not available");
  if (!data?.ok) throw new Error(data?.error ?? "download not available");
  if (typeof data.signed_url !== "string" || data.signed_url.length === 0) {
    throw new Error("Download link was empty. Please try again.");
  }
  return data as RequestPackDownloadResult;
}


// ─── Batch 6: funder-side counters ───────────────────────────
export interface FunderWorkspaceFunderCounters {
  active_deals: number;
  expiring_soon: number;
  packs_available: number;
  open_rfis: number;
  answered_rfis: number;
  decisions_recorded: number;
}

export async function fetchFunderCounters(): Promise<FunderWorkspaceFunderCounters> {
  const { data, error } = await (supabase as any).rpc("fw_counters_funder_v1");
  if (error) throw new Error(error.message);
  return (data ?? {}) as FunderWorkspaceFunderCounters;
}

/** Explicit list of funder-facing table reads — enforced by tests. */
export const FUNDER_WORKSPACE_FUNDER_TABLES = [
  "p5_batch3_funder_organisations",
  "p5_batch3_funder_users",
  "funder_deal_releases",
  "funder_release_consents",
  "funder_pack_versions",
  "funder_usage_events",
  "p5_batch3_funder_audit_events",
] as const;

