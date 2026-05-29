/**
 * DATA-004 Phase 1 — Per-org retention policy admin edge function (SHELL).
 *
 * Single endpoint, action-discriminated:
 *   POST /admin-org-retention { action: "list" | "set" | "clear", ... }
 *
 * Security model (mirrors admin-legal-hold):
 *   1. Valid Bearer token
 *   2. Caller is platform_admin (has_role check via service-role)
 *   3. Caller's session is aal2 (MFA) — assertAal2  [skipped for "list"]
 *   4. set: retention_days >= platform floor; reason >=10 chars
 *   5. clear: reason >=10 chars
 *
 * Canonical audits (CI-guarded by check-data-org-retention-audit-names.mjs):
 *   - data.org_retention_policy.set
 *   - data.org_retention_policy.cleared
 *
 * Phase 1 = SHELL only. No sweeper reads this table yet; values are recorded
 * + audited + surfaced in HQ. Phase 2 will wire storage-retention-cleanup,
 * account-deletion-sweeper, purge-email-send-log, cold-storage-archive.
 */

// deno-lint-ignore-file no-explicit-any

import { createClient } from "npm:@supabase/supabase-js@2.39.3";
import { z } from "npm:zod@3.23.8";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import { assertAal2, readAal } from "../_shared/aal.ts";
import { ApiException } from "../_shared/errors.ts";

const corsHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const RECORD_CLASSES = [
  "matches",
  "trade_requests",
  "pois",
  "wads",
  "evidence",
  "audit_logs",
  "email_send_log",
  "governance_records",
] as const;

const ORG_RETENTION_AUDIT_NAMES = {
  set: "data.org_retention_policy.set",
  cleared: "data.org_retention_policy.cleared",
} as const;

const ListSchema = z.object({
  action: z.literal("list"),
  org_id: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(500).default(200),
});

const SetSchema = z.object({
  action: z.literal("set"),
  org_id: z.string().uuid(),
  record_class: z.enum(RECORD_CLASSES),
  retention_days: z.number().int().positive().max(36500), // 100y ceiling
  reason: z.string().trim().min(10).max(500),
  metadata: z.record(z.unknown()).optional(),
});

const ClearSchema = z.object({
  action: z.literal("clear"),
  org_id: z.string().uuid(),
  record_class: z.enum(RECORD_CLASSES),
  reason: z.string().trim().min(10).max(500),
});

// DATA-004 Phase 2 — non-destructive evidence / read model.
// Read-only. Platform-admin only. Does NOT require AAL2 (parity with `list`).
const HealthSchema = z.object({
  action: z.literal("health"),
  limit_orgs: z.number().int().min(1).max(500).default(200),
});

const BodySchema = z.discriminatedUnion(
  "action",
  [ListSchema, SetSchema, ClearSchema, HealthSchema],
);

function jsonResponse(req: Request, body: unknown, status = 200) {
  return withCors(
    req,
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }),
  );
}

async function writeCanonicalAudit(
  admin: any,
  action: typeof ORG_RETENTION_AUDIT_NAMES.set | typeof ORG_RETENTION_AUDIT_NAMES.cleared,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    await admin.from("audit_logs").insert({
      org_id: (payload.org_id as string | null) ?? null,
      actor_user_id: (payload.actor_user_id as string | null) ?? null,
      action,
      entity_type: "org_retention_policy",
      entity_id: (payload.policy_id as string | null) ?? null,
      metadata: payload,
    });
  } catch (e) {
    console.error(`[admin-org-retention] canonical audit write failed (${action}):`, e);
  }
}

async function writeAdminAudit(
  admin: any,
  callerUserId: string | null,
  action: string,
  targetId: string | null,
  details: Record<string, unknown>,
): Promise<void> {
  try {
    await admin.from("admin_audit_logs").insert({
      admin_user_id: callerUserId,
      action,
      target_type: "org_retention_policy",
      target_id: targetId,
      details,
    });
  } catch (e) {
    console.error(`[admin-org-retention] admin audit write failed (${action}):`, e);
  }
}

Deno.serve(async (req) => {
  const __pf = handleCorsPreflight(req);
  if (__pf) return __pf;

  if (req.method !== "POST") {
    return jsonResponse(req, { error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  let callerId: string | null = null;

  try {
    // 1. Auth
    const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorisation");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return jsonResponse(req, { error: "Unauthorised" }, 401);
    }
    const token = authHeader.replace("Bearer ", "");
    const { data: userRes, error: authError } = await admin.auth.getUser(token);
    if (authError || !userRes?.user) {
      return jsonResponse(req, { error: "Invalid token" }, 401);
    }
    callerId = userRes.user.id;
    const observedAal = readAal(authHeader);

    // 2. RBAC
    const { data: hasAdmin, error: roleError } = await admin.rpc("has_role", {
      _user_id: callerId,
      _role: "platform_admin",
    });
    if (roleError) {
      console.error("[admin-org-retention] has_role failed:", roleError);
      return jsonResponse(req, { error: "Authorisation check failed" }, 500);
    }
    if (!hasAdmin) {
      await writeAdminAudit(admin, callerId, "admin.org_retention.forbidden", null, {
        request_id: requestId,
        reason: "caller_not_platform_admin",
      });
      return jsonResponse(req, { error: "Platform admin access required" }, 403);
    }

    // 3. Parse body first (need action to decide AAL2 enforcement)
    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return jsonResponse(req, { error: "Invalid JSON body" }, 400);
    }
    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) {
      return jsonResponse(
        req,
        { error: "Invalid input", details: parsed.error.flatten() },
        400,
      );
    }

    // 4. AAL2 — required for mutating actions only.
    if (parsed.data.action === "set" || parsed.data.action === "clear") {
      try {
        await assertAal2(authHeader, {
          adminClient: admin,
          callerUserId: callerId,
          action: "admin.org_retention",
        });
      } catch (mfaErr) {
        if (mfaErr instanceof ApiException && mfaErr.code === "MFA_REQUIRED") {
          return jsonResponse(req, { error: mfaErr.message, code: "MFA_REQUIRED" }, 403);
        }
        throw mfaErr;
      }
    }

    // ── ACTION: list ─────────────────────────────────────────────────
    if (parsed.data.action === "list") {
      let q = admin
        .from("org_retention_policies")
        .select("*, organizations!inner(id, name)")
        .order("updated_at", { ascending: false })
        .limit(parsed.data.limit);
      if (parsed.data.org_id) q = q.eq("org_id", parsed.data.org_id);
      const { data, error } = await q;
      if (error) {
        return jsonResponse(req, { error: "Query failed", detail: error.message }, 500);
      }
      // Also return platform floors so the UI never hard-codes them.
      const floors = Object.fromEntries(
        RECORD_CLASSES.map((c) => [c, c === "email_send_log" ? 90 : 2555]),
      );
      return jsonResponse(req, {
        ok: true,
        policies: data ?? [],
        record_classes: RECORD_CLASSES,
        floors,
        request_id: requestId,
      });
    }

    // ── ACTION: health (DATA-004 Phase 2 — read/evidence only) ───────
    // Non-destructive aggregate read across orgs. NOT wired to any
    // sweeper. Returns:
    //  - summary tile counts
    //  - per-class breakdown
    //  - per-org effective posture (only orgs with explicit policies
    //    or active org-scoped legal holds are enumerated; the count of
    //    "orgs on platform floors only" is returned as a single number
    //    so we don't ship every org row across the wire)
    //  - last canonical policy-change audit event
    if (parsed.data.action === "health") {
      const limitOrgs = parsed.data.limit_orgs;
      const floors = Object.fromEntries(
        RECORD_CLASSES.map((c) => [c, c === "email_send_log" ? 90 : 2555]),
      ) as Record<string, number>;

      // 1. Total org count.
      const { count: orgsTotal, error: orgsCountErr } = await admin
        .from("organizations")
        .select("id", { count: "exact", head: true });
      if (orgsCountErr) {
        return jsonResponse(req, { error: "Health query failed", detail: orgsCountErr.message }, 500);
      }

      // 2. All explicit policies (+ org join).
      const { data: polRows, error: polErr } = await admin
        .from("org_retention_policies")
        .select("id, org_id, record_class, retention_days, floor_days, reason, set_by, set_at, updated_at, organizations!inner(id,name)")
        .order("updated_at", { ascending: false })
        .limit(5000);
      if (polErr) {
        return jsonResponse(req, { error: "Health query failed", detail: polErr.message }, 500);
      }
      const policies = (polRows ?? []) as Array<any>;

      // 3. Active org-scoped legal holds.
      const { data: holdRows, error: holdErr } = await admin
        .from("legal_holds")
        .select("id, scope_type, scope_id, reason, applied_at, status")
        .eq("status", "active")
        .eq("scope_type", "org")
        .limit(1000);
      if (holdErr) {
        return jsonResponse(req, { error: "Health query failed", detail: holdErr.message }, 500);
      }
      const orgHolds = (holdRows ?? []) as Array<any>;
      const orgHoldByOrg = new Map<string, any[]>();
      for (const h of orgHolds) {
        const k = h.scope_id as string;
        if (!orgHoldByOrg.has(k)) orgHoldByOrg.set(k, []);
        orgHoldByOrg.get(k)!.push(h);
      }

      // 4. Last canonical policy-change audit event.
      const { data: lastAuditRows } = await admin
        .from("audit_logs")
        .select("id, action, entity_id, actor_user_id, org_id, metadata, created_at")
        .in("action", [
          ORG_RETENTION_AUDIT_NAMES.set,
          ORG_RETENTION_AUDIT_NAMES.cleared,
        ])
        .order("created_at", { ascending: false })
        .limit(1);
      const lastAudit = (lastAuditRows ?? [])[0] ?? null;

      // 5. Build per-org effective posture for orgs that have either an
      //    explicit policy or an active org-scoped hold.
      const orgIds = new Set<string>();
      const orgNameById = new Map<string, string | null>();
      for (const p of policies) {
        orgIds.add(p.org_id);
        orgNameById.set(p.org_id, p.organizations?.name ?? null);
      }
      for (const h of orgHolds) {
        orgIds.add(h.scope_id);
      }
      // Resolve org names that came only from holds.
      const missingNames = [...orgIds].filter((id) => !orgNameById.has(id));
      if (missingNames.length > 0) {
        const { data: orgRows } = await admin
          .from("organizations")
          .select("id, name")
          .in("id", missingNames);
        for (const o of (orgRows ?? []) as Array<any>) {
          orgNameById.set(o.id, o.name);
        }
      }

      const orgList = [...orgIds].slice(0, limitOrgs).map((id) => {
        const orgPolicies = policies.filter((p) => p.org_id === id);
        const polByClass = new Map<string, any>();
        for (const p of orgPolicies) polByClass.set(p.record_class, p);
        const classes = RECORD_CLASSES.map((cls) => {
          const p = polByClass.get(cls);
          const floor = floors[cls];
          let source: "explicit" | "missing" | "fallback";
          let retention_days: number;
          if (p) {
            source = "explicit";
            retention_days = p.retention_days;
          } else {
            source = "missing"; // no policy => effective value is platform floor (fallback)
            retention_days = floor;
          }
          return {
            record_class: cls,
            retention_days,
            platform_floor_days: floor,
            source,
            policy_id: p?.id ?? null,
            last_updated_at: p?.updated_at ?? null,
            last_updated_by: p?.set_by ?? null,
            reason: p?.reason ?? null,
            enforcement_wired: false, // Phase 2: no sweeper reads this yet
          };
        });
        return {
          org_id: id,
          org_name: orgNameById.get(id) ?? null,
          active_org_legal_holds: (orgHoldByOrg.get(id) ?? []).map((h) => ({
            id: h.id, reason: h.reason, applied_at: h.applied_at,
          })),
          classes,
        };
      });

      const explicitOrgIds = new Set(policies.map((p) => p.org_id));
      const orgsWithExplicit = explicitOrgIds.size;
      const orgsMissingAll = Math.max(0, (orgsTotal ?? 0) - orgsWithExplicit);

      // Per-class counts. email_send_log is the first wired class (Phase 3).
      const classBreakdown = RECORD_CLASSES.map((cls) => {
        const explicit = policies.filter((p) => p.record_class === cls).length;
        return {
          record_class: cls,
          platform_floor_days: floors[cls],
          orgs_with_explicit_policy: explicit,
          orgs_on_platform_floor: Math.max(0, (orgsTotal ?? 0) - explicit),
          enforcement_wired: cls === "email_send_log",
        };
      });

      // DATA-004 Phase 3 — latest purge run evidence for email_send_log.
      let lastRun: Record<string, unknown> | null = null;
      try {
        const { data: runRows } = await admin
          .from("retention_run_evidence")
          .select("*")
          .eq("job_name", "purge-email-send-log-daily")
          .is("org_id", null)
          .in("status", ["success", "partial", "failed"])
          .order("started_at", { ascending: false })
          .limit(1);
        lastRun = (runRows ?? [])[0] ?? null;
      } catch (e) {
        console.error("[admin-org-retention] last_run lookup failed:", e);
      }

      // DATA-004 Phase 4 — discover live pg_cron jobs for the sweeper
      // so HQ Health can prove (a) the dry-run schedule is registered
      // and (b) no live (non-dry-run) schedule exists.
      let cronJobs: Array<{
        jobid: number;
        jobname: string;
        schedule: string;
        active: boolean;
        is_dry_run: boolean;
      }> = [];
      try {
        const { data: rows } = await admin.rpc("get_purge_email_send_log_cron_jobs");
        cronJobs = (rows ?? []) as typeof cronJobs;
      } catch (e) {
        console.error("[admin-org-retention] cron.job lookup failed:", e);
      }
      const dryRunSchedules = cronJobs.filter((j) => j.is_dry_run && j.active);
      const liveSchedules = cronJobs.filter((j) => !j.is_dry_run && j.active);

      return jsonResponse(req, {
        ok: true,
        phase: "DATA-004 Phase 4",
        enforcement_status: "partial_enforcement_email_send_log_only",
        // Phase 4 — scheduled dry-run for the sweeper is active.
        // Live (non-dry-run) scheduling remains pending separate approval.
        scheduling_status: liveSchedules.length > 0
          ? "phase_4_unexpected_live_schedule_present"
          : (dryRunSchedules.length > 0
              ? "phase_4_scheduled_dry_run_active_live_purge_pending_approval"
              : "phase_4_dry_run_schedule_missing_check_cron"),
        scheduling_notes: {
          pg_cron_scheduled: dryRunSchedules.length > 0 || liveSchedules.length > 0,
          pg_cron_mode: liveSchedules.length > 0
            ? "LIVE_UNEXPECTED"
            : (dryRunSchedules.length > 0 ? "dry_run_only" : "none"),
          invocation_mode: "scheduled_dry_run_and_manual_service_role",
          dry_run_default: true,
          dry_run_schedules: dryRunSchedules,
          live_schedules: liveSchedules,
          rollback_sql:
            "SELECT cron.unschedule('purge-email-send-log-daily-dryrun');",
          next_step:
            "live_purge_scheduling_requires_a_separate_approval_after_dry_run_evidence_review",
        },

        summary: {
          orgs_total: orgsTotal ?? 0,
          orgs_with_explicit_policies: orgsWithExplicit,
          orgs_missing_policies: orgsMissingAll,
          policies_below_or_at_floor_blocked_by_db: 0,
          active_org_legal_holds: orgHolds.length,
          record_classes_total: RECORD_CLASSES.length,
          record_classes_enforced: 1,
          last_policy_change: lastAudit
            ? {
                audit_id: lastAudit.id,
                action: lastAudit.action,
                policy_id: lastAudit.entity_id,
                org_id: lastAudit.org_id,
                actor_user_id: lastAudit.actor_user_id,
                created_at: lastAudit.created_at,
              }
            : null,
        },
        enforced_classes: ["email_send_log"],
        last_run_email_send_log: lastRun,
        floors,
        record_classes: RECORD_CLASSES,
        class_breakdown: classBreakdown,
        orgs: orgList,
        orgs_returned: orgList.length,
        orgs_truncated: orgIds.size > orgList.length,
        request_id: requestId,
      });
    }



    // ── ACTION: set ──────────────────────────────────────────────────
    if (parsed.data.action === "set") {
      const { org_id, record_class, retention_days, reason, metadata } = parsed.data;
      const { data: result, error: rpcErr } = await admin.rpc(
        "atomic_org_retention_set",
        {
          p_input: {
            org_id,
            record_class,
            retention_days,
            reason,
            set_by: callerId,
            metadata: {
              ...(metadata ?? {}),
              request_id: requestId,
              applied_via: "admin-org-retention",
            },
          },
        },
      );
      if (rpcErr) {
        return jsonResponse(req, { error: "Set failed", detail: rpcErr.message }, 500);
      }
      const r = result as {
        success: boolean;
        error?: string;
        action?: string;
        policy_id?: string;
        floor_days?: number;
        requested_days?: number;
        previous_retention_days?: number | null;
        set_at?: string;
      } | null;
      if (!r?.success) {
        if (r?.error === "BELOW_FLOOR") {
          return jsonResponse(req, {
            ok: false,
            code: "BELOW_FLOOR",
            message: `Requested ${r.requested_days}d is below the platform floor of ${r.floor_days}d for ${record_class}.`,
            floor_days: r.floor_days,
            requested_days: r.requested_days,
          }, 409);
        }
        if (r?.error === "INVALID_INPUT") {
          return jsonResponse(req, { error: "Invalid input" }, 400);
        }
        return jsonResponse(req, { error: "Set failed", detail: r?.error ?? "unknown" }, 500);
      }

      await writeCanonicalAudit(admin, ORG_RETENTION_AUDIT_NAMES.set, {
        policy_id: r.policy_id,
        org_id,
        record_class,
        retention_days,
        floor_days: r.floor_days,
        previous_retention_days: r.previous_retention_days ?? null,
        action_kind: r.action,
        reason,
        actor_user_id: callerId,
        aal: observedAal,
        set_at: r.set_at,
        request_id: requestId,
      });
      await writeAdminAudit(admin, callerId, "admin.org_retention.set", r.policy_id ?? null, {
        request_id: requestId,
        org_id,
        record_class,
        retention_days,
        previous_retention_days: r.previous_retention_days ?? null,
        reason,
        aal: observedAal,
      });

      return jsonResponse(req, {
        ok: true,
        policy_id: r.policy_id,
        action: r.action,
        retention_days,
        floor_days: r.floor_days,
        previous_retention_days: r.previous_retention_days ?? null,
        message: `Per-org retention recorded (${r.action}). NOTE: Phase 1 shell — sweepers do not yet enforce this value.`,
        request_id: requestId,
      });
    }

    // ── ACTION: clear ────────────────────────────────────────────────
    if (parsed.data.action === "clear") {
      const { org_id, record_class, reason } = parsed.data;
      const { data: result, error: rpcErr } = await admin.rpc(
        "atomic_org_retention_clear",
        { p_input: { org_id, record_class, reason } },
      );
      if (rpcErr) {
        return jsonResponse(req, { error: "Clear failed", detail: rpcErr.message }, 500);
      }
      const r = result as {
        success: boolean;
        error?: string;
        cleared_policy_id?: string;
        previous_retention_days?: number;
        floor_days?: number;
      } | null;
      if (!r?.success) {
        if (r?.error === "NOT_FOUND") {
          return jsonResponse(req, { error: "Policy not found", code: "NOT_FOUND" }, 404);
        }
        if (r?.error === "INVALID_INPUT") {
          return jsonResponse(req, { error: "Invalid input" }, 400);
        }
        return jsonResponse(req, { error: "Clear failed", detail: r?.error ?? "unknown" }, 500);
      }

      await writeCanonicalAudit(admin, ORG_RETENTION_AUDIT_NAMES.cleared, {
        policy_id: r.cleared_policy_id,
        org_id,
        record_class,
        previous_retention_days: r.previous_retention_days,
        floor_days: r.floor_days,
        reason,
        actor_user_id: callerId,
        aal: observedAal,
        request_id: requestId,
      });
      await writeAdminAudit(admin, callerId, "admin.org_retention.cleared", r.cleared_policy_id ?? null, {
        request_id: requestId,
        org_id,
        record_class,
        previous_retention_days: r.previous_retention_days,
        reason,
        aal: observedAal,
      });

      return jsonResponse(req, {
        ok: true,
        cleared_policy_id: r.cleared_policy_id,
        floor_days: r.floor_days,
        message: `Per-org retention cleared — effective value falls back to platform floor (${r.floor_days}d).`,
        request_id: requestId,
      });
    }

    return jsonResponse(req, { error: "Unknown action" }, 400);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    console.error("[admin-org-retention] unhandled error:", err);
    if (callerId) {
      await writeAdminAudit(admin, callerId, "admin.org_retention.unhandled_error", null, {
        request_id: requestId,
        error: message,
      });
    }
    return jsonResponse(req, { error: "Internal error" }, 500);
  }
});
