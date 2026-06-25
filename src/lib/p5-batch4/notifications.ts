/**
 * P-5 Batch 4 Stage 7 — Notification router (pure).
 *
 * Distinguishes:
 *   - internal notifications (platform admins, operators)        → may include
 *     internal_detail / finality / provider-dependency wording.
 *   - external notifications (organisation users, counterparties,
 *     funder organisations)                                       → external_safe
 *     label ONLY; wording-guarded; no internal/admin/finality
 *     fields and no raw evidence references.
 *
 * No I/O. No supabase calls. The Stage 3 RPCs are the only writers
 * of notification dispatches. This module only computes payloads.
 */
import type {
  P5B4BlockerKey,
  P5B4FunderReleaseStatus,
  P5B4MilestoneKey,
  P5B4RoleKey,
} from "./constants";
import { getBlockerSpec } from "./blockers";
import { P5B4_OVERDUE_LABELS } from "./constants";
import {
  P5B4_PROVIDER_DEPENDENT_SAFE_LABEL,
  scanForbidden,
} from "./wording-guard";

export const P5B4_NOTIFICATION_AUDIENCES = [
  "internal_admin",
  "internal_operator",
  "external_org_user",
  "external_counterparty",
  "external_funder",
] as const;
export type P5B4NotificationAudience =
  (typeof P5B4_NOTIFICATION_AUDIENCES)[number];

export const P5B4_INTERNAL_AUDIENCES: ReadonlySet<P5B4NotificationAudience> =
  new Set(["internal_admin", "internal_operator"]);

export function isInternalAudience(a: P5B4NotificationAudience): boolean {
  return P5B4_INTERNAL_AUDIENCES.has(a);
}

export const P5B4_NOTIFICATION_KINDS = [
  "milestone_due_soon",
  "milestone_overdue",
  "milestone_escalated",
  "blocker_opened",
  "blocker_resolved",
  "evidence_requested",
  "evidence_review_complete",
  "funder_release",
  "funder_decision",
  "final_approval_recorded",
  "finality_recorded",
] as const;
export type P5B4NotificationKind = (typeof P5B4_NOTIFICATION_KINDS)[number];

export interface P5B4NotificationPayload {
  audience: P5B4NotificationAudience;
  kind: P5B4NotificationKind;
  case_reference: string;
  title: string;
  body: string;
  /** Stable link target. UI consumers decide whether to surface it. */
  link: string | null;
}

/** Fields that MUST NEVER appear in any external notification payload. */
export const P5B4_NOTIFICATION_FORBIDDEN_EXTERNAL_FIELDS: readonly string[] = [
  "internal_detail",
  "internal_note",
  "finality_status",
  "finality_summary",
  "provider_dependency_status",
  "owner_user_id",
  "actor_user_id",
  "raw_file_hash",
  "file_reference",
  "bank_account_number",
  "id_number",
  "passport_number",
  "tax_number",
];

function safeProviderWording(label: string): string {
  // Substitute any provider-dependent wording with the safe label.
  const scan = scanForbidden(label);
  if (scan.ok) return label;
  return P5B4_PROVIDER_DEPENDENT_SAFE_LABEL;
}

export interface P5B4MilestoneNotificationInput {
  audience: P5B4NotificationAudience;
  case_reference: string;
  milestone_key: P5B4MilestoneKey;
  kind: Extract<
    P5B4NotificationKind,
    "milestone_due_soon" | "milestone_overdue" | "milestone_escalated"
  >;
  /** Optional admin/operator-only internal detail. Never used for external audiences. */
  internal_detail?: string | null;
  link?: string | null;
}

export function buildMilestoneNotification(
  input: P5B4MilestoneNotificationInput,
): P5B4NotificationPayload {
  const overdueLabel = P5B4_OVERDUE_LABELS[input.milestone_key];
  const isInternal = isInternalAudience(input.audience);
  const title =
    input.kind === "milestone_escalated"
      ? `Escalated: ${overdueLabel}`
      : input.kind === "milestone_overdue"
        ? `Overdue: ${overdueLabel}`
        : `Due soon: ${overdueLabel}`;
  const baseBody = `Case ${input.case_reference}: ${overdueLabel}.`;
  const body =
    isInternal && input.internal_detail
      ? `${baseBody} ${safeProviderWording(input.internal_detail)}`
      : baseBody;
  return {
    audience: input.audience,
    kind: input.kind,
    case_reference: input.case_reference,
    title: safeProviderWording(title),
    body: safeProviderWording(body),
    link: input.link ?? null,
  };
}

export interface P5B4BlockerNotificationInput {
  audience: P5B4NotificationAudience;
  case_reference: string;
  blocker_key: P5B4BlockerKey;
  kind: Extract<P5B4NotificationKind, "blocker_opened" | "blocker_resolved">;
  internal_detail?: string | null;
  link?: string | null;
}

export function buildBlockerNotification(
  input: P5B4BlockerNotificationInput,
): P5B4NotificationPayload {
  const spec = getBlockerSpec(input.blocker_key);
  const isInternal = isInternalAudience(input.audience);
  const title =
    input.kind === "blocker_opened"
      ? `Blocker opened: ${spec.external_safe_label}`
      : `Blocker resolved: ${spec.external_safe_label}`;
  const body = isInternal && input.internal_detail
    ? `Case ${input.case_reference}: ${spec.external_safe_label} ${safeProviderWording(input.internal_detail)}`
    : `Case ${input.case_reference}: ${spec.external_safe_label}`;
  return {
    audience: input.audience,
    kind: input.kind,
    case_reference: input.case_reference,
    title: safeProviderWording(title),
    body: safeProviderWording(body),
    link: input.link ?? null,
  };
}

export interface P5B4FunderNotificationInput {
  audience: Extract<
    P5B4NotificationAudience,
    "external_funder" | "internal_admin" | "internal_operator"
  >;
  case_reference: string;
  status: P5B4FunderReleaseStatus;
  kind: Extract<P5B4NotificationKind, "funder_release" | "funder_decision">;
  link?: string | null;
}

export function buildFunderNotification(
  input: P5B4FunderNotificationInput,
): P5B4NotificationPayload {
  const title =
    input.kind === "funder_release"
      ? `Funder pack released`
      : `Funder decision: ${input.status}`;
  const body = `Case ${input.case_reference}: ${title.toLowerCase()}.`;
  return {
    audience: input.audience,
    kind: input.kind,
    case_reference: input.case_reference,
    title: safeProviderWording(title),
    body: safeProviderWording(body),
    link: input.link ?? null,
  };
}

/** Defence-in-depth: throws if an external payload leaks a forbidden field. */
export function assertExternalPayloadSafe(
  payload: P5B4NotificationPayload,
  ctx: string,
): void {
  if (isInternalAudience(payload.audience)) return;
  const haystack = `${payload.title}\n${payload.body}\n${payload.link ?? ""}`.toLowerCase();
  for (const f of P5B4_NOTIFICATION_FORBIDDEN_EXTERNAL_FIELDS) {
    if (haystack.includes(f)) {
      throw new Error(`P5B4 notification leak (${ctx}): forbidden token "${f}"`);
    }
  }
  const scan = scanForbidden(haystack);
  if (!scan.ok) {
    throw new Error(`P5B4 notification leak (${ctx}): forbidden wording ${scan.matches.join(",")}`);
  }
}

/** Routing: which audience(s) should receive a given event? */
export function defaultAudiencesFor(
  kind: P5B4NotificationKind,
  actorRole: P5B4RoleKey,
): readonly P5B4NotificationAudience[] {
  switch (kind) {
    case "milestone_due_soon":
    case "milestone_overdue":
    case "milestone_escalated":
      return ["internal_admin", "internal_operator"];
    case "blocker_opened":
    case "blocker_resolved":
      return ["internal_admin", "internal_operator"];
    case "evidence_requested":
      return ["external_org_user", "external_counterparty"];
    case "evidence_review_complete":
      return ["internal_admin", "external_org_user"];
    case "funder_release":
      return ["external_funder", "internal_admin"];
    case "funder_decision":
      return ["internal_admin", "internal_operator"];
    case "final_approval_recorded":
    case "finality_recorded":
      // Finality is platform-admin authored. External finality copy is
      // emitted separately by the finality bridge, never auto-broadcast.
      return actorRole === "platform_admin" ? ["internal_admin"] : ["internal_admin"];
  }
}
