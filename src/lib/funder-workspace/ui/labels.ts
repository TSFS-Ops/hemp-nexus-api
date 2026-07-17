/**
 * Funder Workspace - single source of truth for human-friendly labels.
 * Every canonical funder page (and every legacy page we touch) MUST render
 * enums, statuses and technical identifiers through the helpers here. No
 * per-file competing maps.
 */
import type {
  ConsentStatus,
  DealReleaseRow,
  FunderOrgStatus,
  FunderOrgApprovalStatus,
  PackVersionRow,
  ReleaseStatus,
  UsageEventType,
} from "@/lib/funder-workspace/types";
import type { P5B3FunderRole, P5B3FunderUserStatus } from "@/lib/p5-batch3/constants";

export const RELEASE_STATUS_LABELS: Record<ReleaseStatus, string> = {
  draft: "Draft",
  active: "Active",
  expired: "Expired",
  revoked: "Revoked",
};

export const EFFECTIVE_RELEASE_STATUS_LABELS: Record<string, string> = {
  ...RELEASE_STATUS_LABELS,
  expiring_soon: "Expiring soon",
};

export const CONSENT_STATUS_LABELS: Record<ConsentStatus, string> = {
  not_required: "Not required",
  pending: "Pending",
  granted: "Granted",
  declined: "Declined",
  overridden: "Overridden (admin)",
};

export const PACK_STATUS_LABELS: Record<PackVersionRow["status"], string> = {
  pending: "Preparing",
  generated: "Generated",
  sealed: "Sealed",
  superseded: "Superseded",
  revoked: "Revoked",
  failed: "Failed",
};

export const ORG_STATUS_LABELS: Record<FunderOrgStatus, string> = {
  active: "Active",
  suspended: "Suspended",
  closed: "Closed",
};

export const APPROVAL_STATUS_LABELS: Record<FunderOrgApprovalStatus, string> = {
  admin_created: "Admin created",
  requested: "Requested",
  approved: "Approved",
  rejected: "Rejected",
  suspended: "Suspended",
};

export const FUNDER_ROLE_LABELS: Record<P5B3FunderRole, string> = {
  funder_viewer: "Viewer",
  funder_reviewer: "Reviewer",
  funder_approver: "Approver",
  funder_org_admin: "Funder admin",
  external_adviser: "External adviser",
};

export const FUNDER_USER_STATUS_LABELS: Record<P5B3FunderUserStatus, string> = {
  invited: "Pending invitation",
  active: "Active",
  deactivated: "Deactivated",
};

export const USAGE_EVENT_LABELS: Record<UsageEventType, string> = {
  organisation_requested: "Organisation requested",
  organisation_approved: "Organisation approved",
  organisation_rejected: "Organisation rejected",
  deal_released: "Deal released",
  deal_access_revoked: "Access revoked",
  pack_generated: "Pack generated",
  pack_downloaded: "Pack downloaded",
  raw_document_viewed: "Raw document viewed",
  raw_document_downloaded: "Raw document downloaded",
  rfi_created: "RFI created",
  rfi_answered: "RFI answered",
  decision_recorded: "Decision recorded",
  user_invited: "User invited",
  user_deactivated: "User deactivated",
};

/** Generic humanizer for unmapped enums - last resort fallback only. */
export function humanize(value: string | null | undefined): string {
  if (value == null || value === "") return "-";
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function releaseStatusLabel(s: ReleaseStatus | string): string {
  return EFFECTIVE_RELEASE_STATUS_LABELS[s] ?? humanize(s);
}
export function consentStatusLabel(s: ConsentStatus): string {
  return CONSENT_STATUS_LABELS[s] ?? humanize(s);
}
export function packStatusLabel(s: PackVersionRow["status"]): string {
  return PACK_STATUS_LABELS[s] ?? humanize(s);
}
export function orgStatusLabel(s: FunderOrgStatus | string | null | undefined): string {
  if (!s) return "-";
  return ORG_STATUS_LABELS[s as FunderOrgStatus] ?? humanize(s);
}
export function approvalStatusLabel(
  s: FunderOrgApprovalStatus | string | null | undefined,
): string {
  if (!s) return "-";
  return APPROVAL_STATUS_LABELS[s as FunderOrgApprovalStatus] ?? humanize(s);
}
export function funderRoleLabel(role: string | null | undefined): string {
  if (!role) return "-";
  return FUNDER_ROLE_LABELS[role as P5B3FunderRole] ?? humanize(role);
}
export function funderUserStatusLabel(
  s: P5B3FunderUserStatus | string | null | undefined,
): string {
  if (!s) return "-";
  return FUNDER_USER_STATUS_LABELS[s as P5B3FunderUserStatus] ?? humanize(s);
}
export function usageEventLabel(t: UsageEventType | string): string {
  return USAGE_EVENT_LABELS[t as UsageEventType] ?? humanize(t);
}

// Date & identifier formatters

const dateFmt = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
});
const dateTimeFmt = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "-" : dateFmt.format(d);
}
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "-" : dateTimeFmt.format(d);
}

/** Short, human "in 3 days" / "2 hours ago" without pulling a dep. */
export function relativeFromNow(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "-";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "-";
  const diffMs = t - now;
  const abs = Math.abs(diffMs);
  const mins = Math.round(abs / 60_000);
  const hours = Math.round(abs / 3_600_000);
  const days = Math.round(abs / 86_400_000);
  const future = diffMs > 0;
  const say = (n: number, unit: string) =>
    future ? `in ${n} ${unit}${n === 1 ? "" : "s"}` : `${n} ${unit}${n === 1 ? "" : "s"} ago`;
  if (mins < 60) return say(mins, "min");
  if (hours < 48) return say(hours, "hour");
  return say(days, "day");
}

/**
 * Redact a UUID/hash so it's visible for support triage but not shouted
 * as identity. Use ONLY as a small `<code>` under a real label - never
 * as the primary heading.
 */
export function shortId(id: string | null | undefined): string {
  if (!id) return "-";
  if (id.length <= 12) return id;
  return `${id.slice(0, 8)}...${id.slice(-4)}`;
}
