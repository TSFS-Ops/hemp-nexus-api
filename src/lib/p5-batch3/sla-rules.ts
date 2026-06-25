/**
 * P-5 Batch 3 — Stage 6 expiry / SLA rule engine (pure TS).
 *
 * Produces idempotent task & notification intents. No I/O here — consumers
 * (admin UI, Stage 6 monitor edge function) materialise these intents.
 *
 * Defaults:
 *   - Download link expiry: 7 days
 *   - Funder access expiry: 30 days unless admin override exists
 */
import {
  deriveIdempotencyKey,
  type P5B3NotificationIntent,
  type P5B3NotificationTrigger,
} from "./notifications";

export const P5B3_DEFAULT_DOWNLOAD_LINK_TTL_DAYS = 7;
export const P5B3_DEFAULT_GRANT_TTL_DAYS = 30;
export const P5B3_DEFAULT_REQUEST_OVERDUE_DAYS = 5;
export const P5B3_DEFAULT_DORMANT_FUNDER_DAYS = 14;
export const P5B3_DEFAULT_STALE_ADMIN_REVIEW_DAYS = 3;
export const P5B3_DEFAULT_STALE_PENDING_REQUEST_DAYS = 7;
export const P5B3_ACCESS_EXPIRING_WARN_DAYS = 5;

export type P5B3SlaTaskKind =
  | "access_expiring_warning"
  | "access_expired"
  | "download_link_expired"
  | "request_overdue"
  | "dormant_funder"
  | "stale_admin_review"
  | "stale_pending_request"
  | "revoked_grant_cleanup"
  | "expired_grant_unavailable";

export interface P5B3SlaTaskIntent {
  kind: P5B3SlaTaskKind;
  idempotency_key: string;
  due_at: string; // ISO timestamp
  refs: {
    grant_id?: string;
    request_id?: string;
    download_id?: string;
    org_id?: string;
  };
  /** Internal admin context — never emitted to funder. */
  internal_summary: string;
}

export interface P5B3SlaEvaluationInput {
  now: Date;
  grants: ReadonlyArray<{
    grant_id: string;
    org_id: string;
    status: "active" | "revoked" | "expired";
    expires_at: string | null;
    admin_override_expiry: boolean;
    last_funder_activity_at: string | null;
  }>;
  downloads: ReadonlyArray<{
    download_id: string;
    grant_id: string;
    issued_at: string;
    ttl_days?: number;
  }>;
  requests: ReadonlyArray<{
    request_id: string;
    grant_id: string;
    status: string;
    submitted_at: string | null;
    last_admin_action_at: string | null;
  }>;
}

function daysBetween(a: Date, b: Date): number {
  return Math.floor((a.getTime() - b.getTime()) / 86_400_000);
}

function iso(d: Date): string {
  return new Date(d.getTime()).toISOString();
}

export function evaluateSla(input: P5B3SlaEvaluationInput): {
  tasks: P5B3SlaTaskIntent[];
  notifications: P5B3NotificationIntent[];
} {
  const tasks: P5B3SlaTaskIntent[] = [];
  const notifications: P5B3NotificationIntent[] = [];

  const pushNotif = (
    trigger: P5B3NotificationTrigger,
    audience: "external_funder" | "internal_admin",
    subject: string,
    body: string[],
    keyParts: (string | undefined)[],
    refs: P5B3NotificationIntent["refs"],
  ) => {
    notifications.push({
      trigger,
      audience,
      idempotency_key: deriveIdempotencyKey(trigger, audience, keyParts),
      subject,
      body_lines: body,
      refs,
    });
  };

  for (const g of input.grants) {
    if (g.status === "revoked") {
      tasks.push({
        kind: "revoked_grant_cleanup",
        idempotency_key: `p5b3:sla:revoked:${g.grant_id}`,
        due_at: iso(input.now),
        refs: { grant_id: g.grant_id, org_id: g.org_id },
        internal_summary: "Revoked grant — ensure access invalidated.",
      });
      continue;
    }

    if (g.expires_at) {
      const exp = new Date(g.expires_at);
      const daysLeft = daysBetween(exp, input.now);
      if (daysLeft < 0) {
        tasks.push({
          kind: g.status === "expired" ? "expired_grant_unavailable" : "access_expired",
          idempotency_key: `p5b3:sla:expired:${g.grant_id}:${g.expires_at}`,
          due_at: iso(input.now),
          refs: { grant_id: g.grant_id, org_id: g.org_id },
          internal_summary: "Grant expired — funder surface must render unavailable state.",
        });
      } else if (daysLeft <= P5B3_ACCESS_EXPIRING_WARN_DAYS) {
        tasks.push({
          kind: "access_expiring_warning",
          idempotency_key: `p5b3:sla:expiring:${g.grant_id}:${g.expires_at}`,
          due_at: iso(exp),
          refs: { grant_id: g.grant_id, org_id: g.org_id },
          internal_summary: `Grant expires in ${daysLeft} day(s).`,
        });
        pushNotif(
          "access_expiring",
          "external_funder",
          "Your access is approaching expiry",
          ["Your scoped access will expire shortly. Contact the administrator if extension is required."],
          [g.grant_id, g.expires_at],
          { grant_id: g.grant_id, org_id: g.org_id },
        );
      }
    }

    if (g.last_funder_activity_at) {
      const last = new Date(g.last_funder_activity_at);
      if (daysBetween(input.now, last) >= P5B3_DEFAULT_DORMANT_FUNDER_DAYS) {
        tasks.push({
          kind: "dormant_funder",
          idempotency_key: `p5b3:sla:dormant:${g.grant_id}:${g.last_funder_activity_at}`,
          due_at: iso(input.now),
          refs: { grant_id: g.grant_id, org_id: g.org_id },
          internal_summary: "Funder has not engaged with the released pack recently.",
        });
      }
    }
  }

  for (const d of input.downloads) {
    const ttl = d.ttl_days ?? P5B3_DEFAULT_DOWNLOAD_LINK_TTL_DAYS;
    const issued = new Date(d.issued_at);
    if (daysBetween(input.now, issued) > ttl) {
      tasks.push({
        kind: "download_link_expired",
        idempotency_key: `p5b3:sla:dl-expired:${d.download_id}`,
        due_at: iso(input.now),
        refs: { download_id: d.download_id, grant_id: d.grant_id },
        internal_summary: `Watermarked download link expired (> ${ttl} days).`,
      });
    }
  }

  for (const r of input.requests) {
    if (r.status === "submitted" && r.submitted_at) {
      const submitted = new Date(r.submitted_at);
      if (daysBetween(input.now, submitted) >= P5B3_DEFAULT_REQUEST_OVERDUE_DAYS) {
        tasks.push({
          kind: "request_overdue",
          idempotency_key: `p5b3:sla:overdue:${r.request_id}`,
          due_at: iso(input.now),
          refs: { request_id: r.request_id, grant_id: r.grant_id },
          internal_summary: "Funder request is overdue for admin moderation.",
        });
        pushNotif(
          "request_overdue",
          "external_funder",
          "An information request is overdue for review",
          ["One of your submitted requests is overdue for administrator review."],
          [r.request_id],
          { request_id: r.request_id, grant_id: r.grant_id },
        );
      }
    }
    if (r.status === "admin_review" && r.last_admin_action_at) {
      const last = new Date(r.last_admin_action_at);
      if (daysBetween(input.now, last) >= P5B3_DEFAULT_STALE_ADMIN_REVIEW_DAYS) {
        tasks.push({
          kind: "stale_admin_review",
          idempotency_key: `p5b3:sla:stale-review:${r.request_id}`,
          due_at: iso(input.now),
          refs: { request_id: r.request_id, grant_id: r.grant_id },
          internal_summary: "Admin review has been idle past threshold.",
        });
      }
    }
    if (
      ["response_pending", "approved_to_company", "assigned"].includes(r.status) &&
      r.last_admin_action_at
    ) {
      const last = new Date(r.last_admin_action_at);
      if (daysBetween(input.now, last) >= P5B3_DEFAULT_STALE_PENDING_REQUEST_DAYS) {
        tasks.push({
          kind: "stale_pending_request",
          idempotency_key: `p5b3:sla:stale-pending:${r.request_id}`,
          due_at: iso(input.now),
          refs: { request_id: r.request_id, grant_id: r.grant_id },
          internal_summary: "Pending request has stalled past threshold.",
        });
      }
    }
  }

  return { tasks, notifications };
}
