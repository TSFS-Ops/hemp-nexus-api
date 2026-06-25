/**
 * P-5 Batch 3 — Stage 2 download eligibility (pure TS).
 */
import { checkAccessGrant, type P5B3AccessGrant } from "./access-grants";

export const P5B3_DOWNLOAD_LINK_TTL_DAYS = 7;

export type P5B3DownloadDenialReason =
  | "not_released_pdf"
  | "no_admin_release"
  | "missing_watermark"
  | "link_expired"
  | "grant_invalid"
  | "raw_export_blocked";

export interface P5B3DownloadRequest {
  format: "pdf" | "csv" | "json" | "raw_kyc" | "raw_bank" | "raw_id" | "raw_ubo" | "db_export";
  admin_released: boolean;
  watermark_applied: boolean;
  link_issued_at: string; // ISO
  pack_version: number;
  grant: P5B3AccessGrant | null;
  user_id: string;
  organisation_id: string;
  transaction_id: string;
  now?: Date;
}

export interface P5B3DownloadDecision {
  allowed: boolean;
  reason?: P5B3DownloadDenialReason;
}

const RAW_EXPORT_FORMATS: P5B3DownloadRequest["format"][] = [
  "csv",
  "raw_kyc",
  "raw_bank",
  "raw_id",
  "raw_ubo",
  "db_export",
];

export function decideDownload(req: P5B3DownloadRequest): P5B3DownloadDecision {
  if (RAW_EXPORT_FORMATS.includes(req.format)) {
    return { allowed: false, reason: "raw_export_blocked" };
  }
  if (req.format !== "pdf") {
    return { allowed: false, reason: "not_released_pdf" };
  }
  if (!req.admin_released) return { allowed: false, reason: "no_admin_release" };
  if (!req.watermark_applied) return { allowed: false, reason: "missing_watermark" };

  const now = req.now ?? new Date();
  const issued = new Date(req.link_issued_at).getTime();
  const ageDays = (now.getTime() - issued) / (1000 * 60 * 60 * 24);
  if (ageDays > P5B3_DOWNLOAD_LINK_TTL_DAYS) {
    return { allowed: false, reason: "link_expired" };
  }

  const grantCheck = checkAccessGrant({
    grant: req.grant,
    user_id: req.user_id,
    organisation_id: req.organisation_id,
    transaction_id: req.transaction_id,
    evidence_pack_version: req.pack_version,
    now,
  });
  if (!grantCheck.allowed) return { allowed: false, reason: "grant_invalid" };

  return { allowed: true };
}

/** Revocation invalidates all outstanding download links immediately. */
export function invalidateOnRevocation(
  grant: P5B3AccessGrant,
): { invalidated: boolean } {
  return { invalidated: grant.status === "revoked" };
}
