/**
 * Institutional Funder Evidence Workspace — shared release/pack state.
 *
 * SSOT used by BOTH the admin (operator) surfaces and the funder-facing
 * surfaces so that both views compute identical answers for the same row.
 * The backend RPCs (fw_admin_seal_pack_v1, fw_funder_authorize_pack_download_v1,
 * plus the RLS policies in Batch 1) remain the ultimate gate — this module
 * only exists so the two UIs never disagree with each other, and so operators
 * see exactly what funders see before shipping a release.
 */
import type {
  ConsentStatus,
  DealReleaseRow,
  PackVersionRow,
  ReleaseStatus,
} from "./types";

export type EffectiveReleaseStatus = ReleaseStatus | "expiring_soon";

export const EXPIRING_SOON_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Effective release status. Handles the case where the DB row still says
 * `active` but `expires_at` has already passed (drift), and surfaces
 * `expiring_soon` for active releases within 14 days of expiry.
 */
export function effectiveReleaseStatus(
  release: Pick<DealReleaseRow, "release_status" | "expires_at">,
  now: number = Date.now(),
): EffectiveReleaseStatus {
  if (release.release_status !== "active") return release.release_status;
  if (!release.expires_at) return "active";
  const t = Date.parse(release.expires_at);
  if (!Number.isFinite(t)) return "active";
  if (t <= now) return "expired";
  if (t - now < EXPIRING_SOON_MS) return "expiring_soon";
  return "active";
}

export function isReleaseUsable(
  release: Pick<DealReleaseRow, "release_status" | "expires_at">,
  now: number = Date.now(),
): boolean {
  const s = effectiveReleaseStatus(release, now);
  return s === "active" || s === "expiring_soon";
}

/**
 * Consent gate mirrored from the server. A release is consent-satisfied
 * when both parties are granted / not_required, OR an admin override
 * reason has been recorded.
 */
export function consentSatisfied(
  release: Pick<
    DealReleaseRow,
    "buyer_consent_status" | "seller_consent_status" | "admin_override_reason"
  >,
): boolean {
  const ok = (c: ConsentStatus) => c === "granted" || c === "not_required";
  if (ok(release.buyer_consent_status) && ok(release.seller_consent_status)) {
    return true;
  }
  return !!(release.admin_override_reason && release.admin_override_reason.trim());
}

export interface GateResult {
  ok: boolean;
  reason?: string;
}

/**
 * Can an admin generate/seal a new pack version right now? Mirrors the
 * server-side checks in fw_admin_seal_pack_v1 so the UI does not offer an
 * action that will fail — and so what the admin sees maps 1:1 to funder
 * eligibility.
 */
export function canGenerateSealedPack(
  release: DealReleaseRow,
  now: number = Date.now(),
): GateResult {
  if (release.release_status === "draft") {
    return { ok: false, reason: "Release is still a draft." };
  }
  if (release.release_status === "revoked") {
    return { ok: false, reason: "Release has been revoked." };
  }
  if (!isReleaseUsable(release, now)) {
    return { ok: false, reason: "Release has expired." };
  }
  if (!consentSatisfied(release)) {
    return {
      ok: false,
      reason:
        "Buyer or seller consent is not granted and no admin override reason is recorded.",
    };
  }
  return { ok: true };
}

export interface PackReadiness {
  ready: boolean;
  reason?: string;
}

/**
 * Is a specific pack version downloadable by the funder right now? This is
 * exactly what the funder-facing Download button uses. Rendering it on the
 * admin surface too gives the operator a WYSIWYG signal.
 */
export function packDownloadReadiness(
  release: DealReleaseRow,
  pack: PackVersionRow,
  now: number = Date.now(),
): PackReadiness {
  if (!release.can_download_compiled_pack) {
    return { ready: false, reason: "Download not permitted for this release." };
  }
  if (!isReleaseUsable(release, now)) {
    return { ready: false, reason: "Release is not active." };
  }
  const sealed = pack.status === "sealed" || pack.status === "generated";
  if (!sealed) {
    return { ready: false, reason: `Pack status is ${pack.status}.` };
  }
  if (!pack.storage_bucket || !pack.storage_path || !pack.file_sha256) {
    return { ready: false, reason: "Pack file is not yet materialised." };
  }
  return { ready: true };
}

/** Latest pack version for a release (highest version number), if any. */
export function latestPack(packs: PackVersionRow[]): PackVersionRow | null {
  if (packs.length === 0) return null;
  return [...packs].sort((a, b) => b.version - a.version)[0];
}

/** UI variant helper so both surfaces render identical badge colours. */
export function statusBadgeVariant(
  s: EffectiveReleaseStatus,
): "default" | "secondary" | "destructive" | "outline" {
  switch (s) {
    case "active":
      return "default";
    case "expiring_soon":
      return "outline";
    case "revoked":
      return "destructive";
    case "expired":
    case "draft":
    default:
      return "secondary";
  }
}

export function statusLabel(s: EffectiveReleaseStatus): string {
  return s === "expiring_soon" ? "expiring soon" : s;
}
