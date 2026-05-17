/**
 * Structured admin audit-log helper.
 *
 * Writes a normalised row to `public.admin_audit_logs` with a consistent
 * JSON envelope so dashboards / exports can filter on stable fields:
 *
 *   details = {
 *     request_id,         // UUID per HTTP request
 *     action_type,        // canonical dotted action (e.g. "admin.match.legacy_repair")
 *     status,             // "success" | "denied" | "error" | "info"
 *     org_id,             // optional org context (system actions use SYSTEM_ORG_ID)
 *     aal: {              // MFA / AAL2 evaluation outcome
 *       required: boolean,
 *       observed: "aal1" | "aal2" | "unknown" | null,
 *       outcome: "satisfied" | "denied" | "not_required" | "not_evaluated",
 *       has_verified_factor?: boolean
 *     },
 *     reason?: string,    // typed error code on denied/error
 *     endpoint?: string,
 *     ip?: string,
 *     user_agent?: string,
 *     extra?: Record<string, unknown>  // free-form, per-action context
 *   }
 *
 * The DB row also fills admin_user_id / target_type / target_id /
 * ip_address / user_agent at column level so existing dashboards work
 * unchanged.
 *
 * NEVER let an audit write throw — admin operations must continue even
 * if the audit insert fails (we log to console for ops triage).
 */

// deno-lint-ignore-file no-explicit-any

export type AdminAuditStatus = "success" | "denied" | "error" | "info";

export interface AdminAuditAal {
  required: boolean;
  observed: "aal1" | "aal2" | "unknown" | null;
  outcome: "satisfied" | "denied" | "not_required" | "not_evaluated";
  has_verified_factor?: boolean;
}

export interface WriteAdminAuditOpts {
  admin: any;                       // service-role supabase client
  action: string;                   // canonical dotted action_type
  status: AdminAuditStatus;
  actorUserId?: string | null;      // auth.users.id of the human (or null for system)
  orgId?: string | null;
  targetType: string;               // e.g. "match" | "auth_user" | "system"
  targetId?: string | null;         // uuid of the target row (if applicable)
  requestId: string;
  endpoint?: string;
  aal?: AdminAuditAal;
  reason?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  extra?: Record<string, unknown>;
}

const NIL_UUID = "00000000-0000-0000-0000-000000000000";

export function extractIp(req: Request): string | null {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-real-ip") ??
    null
  );
}

export function extractUserAgent(req: Request): string | null {
  return req.headers.get("user-agent");
}

export async function writeAdminAudit(opts: WriteAdminAuditOpts): Promise<void> {
  const {
    admin,
    action,
    status,
    actorUserId,
    orgId,
    targetType,
    targetId,
    requestId,
    endpoint,
    aal,
    reason,
    ipAddress,
    userAgent,
    extra,
  } = opts;

  const details: Record<string, unknown> = {
    request_id: requestId,
    action_type: action,
    status,
    org_id: orgId ?? null,
    aal: aal ?? { required: false, observed: null, outcome: "not_evaluated" },
  };
  if (endpoint) details.endpoint = endpoint;
  if (reason) details.reason = reason;
  if (ipAddress) details.ip = ipAddress;
  if (userAgent) details.user_agent = userAgent;
  if (extra && Object.keys(extra).length) details.extra = extra;

  try {
    const { error } = await admin.from("admin_audit_logs").insert({
      admin_user_id: actorUserId ?? null,
      action,
      target_type: targetType,
      // admin_audit_logs.target_id is uuid; coerce non-uuid identifiers to NIL.
      target_id: targetId && /^[0-9a-f-]{36}$/i.test(targetId) ? targetId : null,
      details,
      ip_address: ipAddress ?? null,
      user_agent: userAgent ?? null,
    });
    if (error) {
      console.error(
        `[admin-audit] insert failed action=${action} request_id=${requestId}:`,
        error,
      );
    }
  } catch (e) {
    console.error(
      `[admin-audit] threw action=${action} request_id=${requestId}:`,
      e,
    );
  }
}

export { NIL_UUID };
