/**
 * Institutional Funder Evidence Workspace — Batch 2
 * UI-side permission defaults for the New Release form.
 *
 * These are ONLY defaults; the DB CHECK constraints and the
 * fw_admin_release_deal_v1 RPC are the authoritative enforcer. Raw
 * document toggles ALWAYS default off.
 */
import type { ConsentStatus } from "./types";

export interface ReleasePermissionsDraft {
  can_view_evidence_summary: boolean;
  can_view_evidence_room: boolean;
  can_download_compiled_pack: boolean;
  can_view_raw_documents: boolean;
  can_download_raw_documents: boolean;
  can_view_unmasked_sensitive_details: boolean;
}

export const DEFAULT_RELEASE_PERMISSIONS: ReleasePermissionsDraft = {
  can_view_evidence_summary: true,
  can_view_evidence_room: true,
  can_download_compiled_pack: false,
  can_view_raw_documents: false,
  can_download_raw_documents: false,
  can_view_unmasked_sensitive_details: false,
};

/** True when the requested consent state requires an admin override reason. */
export function requiresAdminOverride(
  buyer: ConsentStatus,
  seller: ConsentStatus,
): boolean {
  const ok = (s: ConsentStatus) => s === "granted" || s === "not_required";
  return !(ok(buyer) && ok(seller));
}

/** Permissions that must display a warning banner before enabling. */
export const RAW_DOCUMENT_PERMISSION_KEYS = [
  "can_view_raw_documents",
  "can_download_raw_documents",
  "can_view_unmasked_sensitive_details",
] as const satisfies ReadonlyArray<keyof ReleasePermissionsDraft>;
