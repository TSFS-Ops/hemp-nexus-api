// D-08 / DATA-002 Phase 1: Account self-delete 30-day hard-delete sweeper.
//
// Runs daily (cron) to finalise self-service account deletions:
//  - Finds profiles with status='pending_deletion' older than 30 days.
//  - In dry-run mode: writes the canonical `data.deletion_window_elapsed`
//    audit for every elapsed candidate, plus per-candidate
//    `account.hard_delete_candidate` (legacy) or
//    `data.deletion_deferred_retention_required` + `account.hard_delete_skipped`
//    when a guard blocks. NO destructive action.
//  - In destructive mode: for each eligible candidate, hard-deletes the
//    auth.users row via the admin API and writes both the legacy
//    `account.hard_deleted` AND the canonical
//    `data.profile_deleted_or_anonymised` audit. Profile row stays in place
//    (already anonymised by `delete-account`) so audit history remains intact.
//
// Safety controls:
//  - Requires `x-internal-key: <INTERNAL_CRON_KEY>` OR service_role bearer.
//  - `dry_run` defaults to TRUE; destructive runs require `dry_run=false`
//    AND `confirm: "HARD_DELETE"` in the body. (Phase 1: destructive cron
//    is intentionally NOT scheduled — only manual invocation by an operator
//    can perform destruction. See DATA-002 Phase 2 sign-off.)
//  - `max_rows` capped at 100 (default 25) to bound blast radius per run.
//  - Sweep-time guards (ALL must pass — fail-CLOSED):
//      1. legal_hold (DATA-003 `assertNoLegalHold`)
//      2. platform_admin (break-glass required)
//      3. active POIs (PENDING_APPROVAL/ELIGIBLE/COMPLETION_REQUESTED)
//      4. active trade_requests (non-terminal status)
//      5. non-terminal matches (org on either side)
//      6. in-flight WaDs (org on either side)
//      7. open billing obligations (unsettled credits.purchase_initiated)
//      8. open refund/chargeback dependency
//         (payment_disputes / chargebacks tables — fail-CLOSED with
//         dependency_unverified if either table is absent in Phase 1)
//      9. open compliance work (dd_approval_requests for the org)
//     10. open disputes where org is on either side of the underlying match
//  - Fails closed: missing deletion_requested_at -> skipped+audited.
//
// Audit actions written:
//   Legacy (kept for back-compat — P0-5 + ops dashboards depend on these):
//     account.hard_delete_candidate
//     account.hard_deleted
//     account.hard_delete_failed
//     account.hard_delete_skipped
//
//   Canonical DATA-002 (new, dual-written):
//     data.deletion_window_elapsed              (every elapsed candidate)
//     data.profile_deleted_or_anonymised        (destructive success)
//     data.deletion_deferred_retention_required (every blocked candidate;
//                                                carries defer_reason +
//                                                guard_name)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { webhookCorsHeaders } from "../_shared/cors.ts";
import { assertNoLegalHold } from "../_shared/legal-hold.ts";

const corsHeaders = { ...webhookCorsHeaders() };

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const DEFAULT_MAX_ROWS = 25;
const HARD_MAX_ROWS = 100;
const GRACE_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

// Terminal status sets — anything NOT in these sets is treated as "active"
// and blocks hard-delete (fail-CLOSED for unknown future statuses).
const TRADE_REQUEST_TERMINAL = ["expired", "withdrawn", "completed", "cancelled"];
const MATCH_TERMINAL = ["completed", "cancelled", "expired", "superseded", "settled"];
const WAD_TERMINAL = ["completed", "collapsed", "cancelled"];
const DD_TERMINAL = ["approved", "rejected", "cancelled", "withdrawn"];

interface SweepBody {
  dry_run?: boolean;
  max_rows?: number;
  confirm?: string;
}

interface GuardResult {
  ok: boolean;
  defer_reason?: string;
  guard_name?: string;
  detail?: Record<string, unknown>;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json(405, { error: "METHOD_NOT_ALLOWED" });
  }

  // Auth: INTERNAL_CRON_KEY header OR service_role bearer
  const internalKey = req.headers.get("x-internal-key");
  const authHeader = req.headers.get("authorization") ?? "";
  const expectedCronKey = Deno.env.get("INTERNAL_CRON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;

  const isInternalCron = !!expectedCronKey && internalKey === expectedCronKey;
  const isServiceRole = serviceRoleKey.length > 0 && authHeader === `Bearer ${serviceRoleKey}`;

  if (!isInternalCron && !isServiceRole) {
    return json(401, { error: "UNAUTHORIZED", code: "INTERNAL_CRON_KEY_REQUIRED" });
  }

  let body: SweepBody = {};
  try {
    const txt = await req.text();
    if (txt.trim().length > 0) body = JSON.parse(txt) as SweepBody;
  } catch {
    return json(400, { error: "INVALID_JSON" });
  }

  const dryRun = body.dry_run !== false;
  if (!dryRun && body.confirm !== "HARD_DELETE") {
    return json(400, {
      error: "DESTRUCTIVE_CONFIRMATION_REQUIRED",
      hint: 'Pass {"dry_run": false, "confirm": "HARD_DELETE"} to perform the sweep.',
    });
  }

  const maxRows = Math.min(
    Math.max(1, Number.isFinite(body.max_rows) ? Number(body.max_rows) : DEFAULT_MAX_ROWS),
    HARD_MAX_ROWS,
  );

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const cutoffIso = new Date(Date.now() - GRACE_PERIOD_MS).toISOString();
  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();

  const { data: candidates, error: fetchErr } = await supabase
    .from("profiles")
    .select("id, org_id, status, deletion_requested_at, deletion_reason, deletion_category")
    .eq("status", "pending_deletion")
    .not("deletion_requested_at", "is", null)
    .lte("deletion_requested_at", cutoffIso)
    .order("deletion_requested_at", { ascending: true })
    .limit(maxRows * 2);

  if (fetchErr) {
    console.error("[account-deletion-sweeper] fetch error", fetchErr);
    return json(500, { error: "FETCH_FAILED", detail: fetchErr.message });
  }

  const result = {
    run_id: runId,
    dry_run: dryRun,
    started_at: startedAt,
    cutoff: cutoffIso,
    max_rows: maxRows,
    examined: candidates?.length ?? 0,
    candidates: 0,
    deleted: 0,
    failed: 0,
    skipped: 0,
    skipped_reasons: {} as Record<string, number>,
    samples: [] as Array<Record<string, unknown>>,
  };

  if (!candidates || candidates.length === 0) {
    return json(200, { ...result, message: "No candidates due for hard-delete." });
  }

  let processedEligible = 0;

  for (const row of candidates) {
    if (processedEligible >= maxRows) break;
    const userId: string = row.id;
    const orgId: string | null = row.org_id;

    if (!row.deletion_requested_at) {
      await audit(supabase, "account.hard_delete_skipped", userId, orgId, {
        run_id: runId,
        reason: "missing_deletion_requested_at",
        dry_run: dryRun,
      });
      await canonicalAudit(supabase, "data.deletion_deferred_retention_required", userId, orgId, {
        run_id: runId,
        defer_reason: "missing_deletion_requested_at",
        guard_name: "preflight",
        dry_run: dryRun,
      });
      result.skipped++;
      bump(result.skipped_reasons, "missing_deletion_requested_at");
      continue;
    }

    const daysPending = Math.floor(
      (Date.now() - new Date(row.deletion_requested_at).getTime()) / 86_400_000,
    );

    // Canonical: the 30-day window has elapsed for this candidate. Written
    // BEFORE any guard so DPO/compliance can see the full elapsed cohort
    // regardless of subsequent deferral.
    await canonicalAudit(supabase, "data.deletion_window_elapsed", userId, orgId, {
      run_id: runId,
      deletion_requested_at: row.deletion_requested_at,
      days_pending: daysPending,
      dry_run: dryRun,
    });

    // Idempotency: if auth.users is already gone (previous destructive sweep
    // succeeded but profile row preserved), skip without re-emitting
    // data.profile_deleted_or_anonymised.
    try {
      const { data: existing } = await supabase.auth.admin.getUserById(userId);
      if (!existing?.user) {
        await audit(supabase, "account.hard_delete_skipped", userId, orgId, {
          run_id: runId,
          reason: "already_hard_deleted",
          dry_run: dryRun,
        });
        result.skipped++;
        bump(result.skipped_reasons, "already_hard_deleted");
        continue;
      }
    } catch (e) {
      console.warn(`[account-deletion-sweeper] getUserById warning for ${userId}`, e);
    }

    // Run all sweep-time guards. First failure short-circuits.
    const guards: Array<() => Promise<GuardResult>> = [
      () => guardLegalHold(supabase, userId, orgId, runId),
      () => guardPlatformAdmin(supabase, userId),
      () => guardActivePois(supabase, orgId),
      () => guardActiveTradeRequests(supabase, orgId),
      () => guardNonTerminalMatches(supabase, orgId),
      () => guardInFlightWads(supabase, orgId),
      () => guardOpenBilling(supabase, orgId),
      () => guardOpenRefundChargeback(supabase, orgId),
      () => guardOpenCompliance(supabase, orgId),
      () => guardOpenDisputes(supabase, orgId),
    ];

    let blocked: GuardResult | null = null;
    for (const g of guards) {
      const r = await g();
      if (!r.ok) {
        blocked = r;
        break;
      }
    }

    if (blocked) {
      await audit(supabase, "account.hard_delete_skipped", userId, orgId, {
        run_id: runId,
        reason: blocked.defer_reason,
        guard_name: blocked.guard_name,
        detail: blocked.detail ?? null,
        dry_run: dryRun,
      });
      await canonicalAudit(supabase, "data.deletion_deferred_retention_required", userId, orgId, {
        run_id: runId,
        defer_reason: blocked.defer_reason,
        guard_name: blocked.guard_name,
        detail: blocked.detail ?? null,
        days_pending: daysPending,
        dry_run: dryRun,
      });
      result.skipped++;
      bump(result.skipped_reasons, blocked.defer_reason ?? "unknown");
      continue;
    }

    processedEligible++;

    if (dryRun) {
      await audit(supabase, "account.hard_delete_candidate", userId, orgId, {
        run_id: runId,
        deletion_requested_at: row.deletion_requested_at,
        days_pending: daysPending,
        dry_run: true,
      });
      result.candidates++;
      if (result.samples.length < 5) {
        result.samples.push({ user_id: userId, org_id: orgId, days_pending: daysPending });
      }
      continue;
    }

    // Destructive path.
    try {
      const placeholderEmail = `hard-deleted+${userId}@deleted.izenzo.local`;
      try {
        await supabase.auth.admin.updateUserById(userId, {
          email: placeholderEmail,
          user_metadata: { hard_delete_in_progress: true },
        });
      } catch (anonErr) {
        console.warn(`[account-deletion-sweeper] anon-pre-delete warning for ${userId}`, anonErr);
      }

      try {
        await supabase.rpc("scrub_user_pii", { p_user_id: userId });
      } catch (scrubErr) {
        console.warn(`[account-deletion-sweeper] scrub_user_pii warning for ${userId}`, scrubErr);
      }

      const { error: delErr } = await supabase.auth.admin.deleteUser(userId);
      if (delErr) throw delErr;

      await audit(supabase, "account.hard_deleted", userId, orgId, {
        run_id: runId,
        deletion_requested_at: row.deletion_requested_at,
        days_pending: daysPending,
        deletion_reason: row.deletion_reason,
        deletion_category: row.deletion_category,
        email_anonymised: true,
      });
      await canonicalAudit(supabase, "data.profile_deleted_or_anonymised", userId, orgId, {
        run_id: runId,
        deletion_requested_at: row.deletion_requested_at,
        days_pending: daysPending,
        email_anonymised: true,
        pii_scrubbed: true,
      });
      result.deleted++;
      if (result.samples.length < 5) {
        result.samples.push({ user_id: userId, org_id: orgId, days_pending: daysPending, hard_deleted: true });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[account-deletion-sweeper] hard-delete failed for ${userId}`, msg);
      await audit(supabase, "account.hard_delete_failed", userId, orgId, {
        run_id: runId,
        error: msg,
      });
      result.failed++;
    }
  }

  return json(200, { ...result, finished_at: new Date().toISOString() });
});

// ─── Helpers ────────────────────────────────────────────────────────────

function bump(obj: Record<string, number>, key: string) {
  obj[key] = (obj[key] ?? 0) + 1;
}

// deno-lint-ignore no-explicit-any
async function audit(supabase: any, action: string, userId: string, orgId: string | null, details: Record<string, unknown>) {
  try {
    await supabase.from("admin_audit_logs").insert({
      admin_user_id: null,
      action,
      target_type: "profile",
      target_id: userId,
      details: { ...details, org_id: orgId, source: "account-deletion-sweeper" },
    });
  } catch (e) {
    console.error("[account-deletion-sweeper] audit insert failed", action, e);
  }
}

// Canonical DATA-002 audit writes go to public.audit_logs (the same table
// used by the legal-hold helper and other canonical compliance events) so
// downstream reporting can join across DATA-002 + DATA-003 cleanly.
// deno-lint-ignore no-explicit-any
async function canonicalAudit(supabase: any, action: string, userId: string, orgId: string | null, metadata: Record<string, unknown>) {
  try {
    await supabase.from("audit_logs").insert({
      org_id: orgId,
      actor_user_id: null,
      action,
      entity_type: "profile",
      entity_id: userId,
      metadata: { ...metadata, source: "account-deletion-sweeper", canonical: true },
    });
  } catch (e) {
    console.error("[account-deletion-sweeper] canonical audit insert failed", action, e);
  }
}

// ─── Guards ─────────────────────────────────────────────────────────────
// Each guard returns { ok: true } when the candidate may proceed, or
// { ok: false, defer_reason, guard_name } to defer. All guards fail-CLOSED.

// deno-lint-ignore no-explicit-any
async function guardLegalHold(supabase: any, userId: string, orgId: string | null, runId: string): Promise<GuardResult> {
  const scopes: Array<{ scope_type: "user" | "org"; scope_id: string }> = [{ scope_type: "user", scope_id: userId }];
  if (orgId) scopes.push({ scope_type: "org", scope_id: orgId });
  const hold = await assertNoLegalHold(supabase, scopes, {
    action: "account-deletion-sweeper.hard_delete",
    actorUserId: null,
    actorOrgId: orgId,
    requestId: runId,
  });
  if (hold.blocked) {
    return {
      ok: false,
      defer_reason: hold.code === "LEGAL_HOLD_CHECK_FAILED" ? "legal_hold_check_failed" : "legal_hold_active",
      guard_name: "legal_hold",
      detail: { legal_hold_id: hold.activeHold?.id ?? null, code: hold.code },
    };
  }
  return { ok: true };
}

// deno-lint-ignore no-explicit-any
async function guardPlatformAdmin(supabase: any, userId: string): Promise<GuardResult> {
  const { data, error } = await supabase
    .from("user_roles").select("user_id").eq("user_id", userId).eq("role", "platform_admin").maybeSingle();
  if (error) return { ok: false, defer_reason: "platform_admin_check_failed", guard_name: "platform_admin", detail: { error: error.message } };
  if (data) return { ok: false, defer_reason: "platform_admin_requires_break_glass", guard_name: "platform_admin" };
  return { ok: true };
}

// deno-lint-ignore no-explicit-any
async function guardActivePois(supabase: any, orgId: string | null): Promise<GuardResult> {
  if (!orgId) return { ok: true };
  const { count, error } = await supabase
    .from("pois").select("id", { count: "exact", head: true })
    .eq("org_id", orgId).in("state", ["PENDING_APPROVAL", "ELIGIBLE", "COMPLETION_REQUESTED"]);
  if (error) return { ok: false, defer_reason: "active_pois_check_failed", guard_name: "active_pois", detail: { error: error.message } };
  if ((count ?? 0) > 0) return { ok: false, defer_reason: "org_has_active_pois", guard_name: "active_pois", detail: { active_poi_count: count } };
  return { ok: true };
}

// deno-lint-ignore no-explicit-any
async function guardActiveTradeRequests(supabase: any, orgId: string | null): Promise<GuardResult> {
  if (!orgId) return { ok: true };
  const { count, error } = await supabase
    .from("trade_requests").select("id", { count: "exact", head: true })
    .eq("org_id", orgId).not("status", "in", `(${TRADE_REQUEST_TERMINAL.join(",")})`);
  if (error) return { ok: false, defer_reason: "trade_requests_check_failed", guard_name: "active_trade_requests", detail: { error: error.message } };
  if ((count ?? 0) > 0) return { ok: false, defer_reason: "org_has_active_trade_requests", guard_name: "active_trade_requests", detail: { active_count: count } };
  return { ok: true };
}

// deno-lint-ignore no-explicit-any
async function guardNonTerminalMatches(supabase: any, orgId: string | null): Promise<GuardResult> {
  if (!orgId) return { ok: true };
  const { count, error } = await supabase
    .from("matches").select("id", { count: "exact", head: true })
    .or(`buyer_org_id.eq.${orgId},seller_org_id.eq.${orgId}`)
    .not("status", "in", `(${MATCH_TERMINAL.join(",")})`);
  if (error) return { ok: false, defer_reason: "matches_check_failed", guard_name: "non_terminal_matches", detail: { error: error.message } };
  if ((count ?? 0) > 0) return { ok: false, defer_reason: "org_has_non_terminal_matches", guard_name: "non_terminal_matches", detail: { active_count: count } };
  return { ok: true };
}

// deno-lint-ignore no-explicit-any
async function guardInFlightWads(supabase: any, orgId: string | null): Promise<GuardResult> {
  if (!orgId) return { ok: true };
  const { count, error } = await supabase
    .from("wads").select("id", { count: "exact", head: true })
    .or(`buyer_org_id.eq.${orgId},seller_org_id.eq.${orgId}`)
    .not("status", "in", `(${WAD_TERMINAL.join(",")})`);
  if (error) return { ok: false, defer_reason: "wads_check_failed", guard_name: "in_flight_wads", detail: { error: error.message } };
  if ((count ?? 0) > 0) return { ok: false, defer_reason: "org_has_in_flight_wads", guard_name: "in_flight_wads", detail: { active_count: count } };
  return { ok: true };
}

// deno-lint-ignore no-explicit-any
async function guardOpenBilling(supabase: any, orgId: string | null): Promise<GuardResult> {
  if (!orgId) return { ok: true };
  // Unsettled billing = credits.purchase_initiated rows without a matching
  // credits.purchased by payment_reference. Lightweight check: count
  // initiated rows for the org in the last 90d that have no settlement peer.
  try {
    const { data: initiated, error: iErr } = await supabase
      .from("audit_logs")
      .select("metadata")
      .eq("org_id", orgId)
      .eq("action", "credits.purchase_initiated")
      .gte("created_at", new Date(Date.now() - 90 * 86_400_000).toISOString())
      .limit(50);
    if (iErr) {
      return { ok: false, defer_reason: "billing_check_failed", guard_name: "open_billing", detail: { error: iErr.message } };
    }
    if (!initiated || initiated.length === 0) return { ok: true };

    const refs = initiated
      .map((r: { metadata: Record<string, unknown> | null }) => r.metadata?.payment_reference)
      .filter((x: unknown): x is string => typeof x === "string" && x.length > 0);
    if (refs.length === 0) return { ok: true };

    const { data: settled, error: sErr } = await supabase
      .from("audit_logs")
      .select("metadata")
      .eq("org_id", orgId)
      .eq("action", "credits.purchased")
      .in("metadata->>payment_reference", refs);
    if (sErr) {
      return { ok: false, defer_reason: "billing_check_failed", guard_name: "open_billing", detail: { error: sErr.message } };
    }
    const settledRefs = new Set(
      (settled ?? []).map((r: { metadata: Record<string, unknown> | null }) => r.metadata?.payment_reference as string),
    );
    const unsettled = refs.filter((r: string) => !settledRefs.has(r));
    if (unsettled.length > 0) {
      return { ok: false, defer_reason: "org_has_unsettled_billing", guard_name: "open_billing", detail: { unsettled_count: unsettled.length } };
    }
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, defer_reason: "billing_check_failed", guard_name: "open_billing", detail: { error: msg } };
  }
}

// deno-lint-ignore no-explicit-any
async function guardOpenRefundChargeback(supabase: any, orgId: string | null): Promise<GuardResult> {
  if (!orgId) return { ok: true };
  // Tables payment_disputes / chargebacks are not present in this project
  // schema. Fail-CLOSED with dependency_unverified so the absence is an
  // explicit operator decision, never a silent pass.
  for (const tbl of ["payment_disputes", "chargebacks"]) {
    try {
      const { error } = await supabase.from(tbl).select("id", { count: "exact", head: true }).eq("org_id", orgId).limit(1);
      if (error) {
        const code = (error as { code?: string }).code ?? "";
        const message = (error as { message?: string }).message ?? "";
        if (code === "PGRST205" || code === "42P01" || /does not exist|not found/i.test(message)) {
          return {
            ok: false,
            defer_reason: "dependency_unverified",
            guard_name: "open_refund_chargeback",
            detail: { missing_table: tbl, note: "Phase 1 fail-CLOSED: refund/chargeback table absent." },
          };
        }
        return { ok: false, defer_reason: "refund_chargeback_check_failed", guard_name: "open_refund_chargeback", detail: { table: tbl, error: message } };
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, defer_reason: "dependency_unverified", guard_name: "open_refund_chargeback", detail: { missing_table: tbl, error: msg } };
    }
  }
  return { ok: true };
}

// deno-lint-ignore no-explicit-any
async function guardOpenCompliance(supabase: any, orgId: string | null): Promise<GuardResult> {
  if (!orgId) return { ok: true };
  const { count, error } = await supabase
    .from("dd_approval_requests").select("id", { count: "exact", head: true })
    .eq("org_id", orgId).not("status", "in", `(${DD_TERMINAL.join(",")})`);
  if (error) return { ok: false, defer_reason: "compliance_check_failed", guard_name: "open_compliance", detail: { error: error.message } };
  if ((count ?? 0) > 0) return { ok: false, defer_reason: "org_has_open_compliance", guard_name: "open_compliance", detail: { open_count: count } };
  return { ok: true };
}

// deno-lint-ignore no-explicit-any
async function guardOpenDisputes(supabase: any, orgId: string | null): Promise<GuardResult> {
  if (!orgId) return { ok: true };
  // (a) raised by org directly
  const { count: raisedCount, error: raisedErr } = await supabase
    .from("disputes").select("id", { count: "exact", head: true })
    .eq("raised_by_org_id", orgId).is("resolved_at", null);
  if (raisedErr) return { ok: false, defer_reason: "disputes_check_failed", guard_name: "open_disputes", detail: { error: raisedErr.message } };
  if ((raisedCount ?? 0) > 0) {
    return { ok: false, defer_reason: "org_has_open_disputes", guard_name: "open_disputes", detail: { raised_count: raisedCount } };
  }
  // (b) raised against org — via match join (org is buyer or seller).
  const { data: orgMatches, error: mErr } = await supabase
    .from("matches").select("id").or(`buyer_org_id.eq.${orgId},seller_org_id.eq.${orgId}`).limit(500);
  if (mErr) return { ok: false, defer_reason: "disputes_check_failed", guard_name: "open_disputes", detail: { error: mErr.message } };
  const matchIds = (orgMatches ?? []).map((m: { id: string }) => m.id);
  if (matchIds.length === 0) return { ok: true };
  const { count: againstCount, error: againstErr } = await supabase
    .from("disputes").select("id", { count: "exact", head: true })
    .in("match_id", matchIds).is("resolved_at", null);
  if (againstErr) return { ok: false, defer_reason: "disputes_check_failed", guard_name: "open_disputes", detail: { error: againstErr.message } };
  if ((againstCount ?? 0) > 0) {
    return { ok: false, defer_reason: "org_has_open_disputes", guard_name: "open_disputes", detail: { against_count: againstCount } };
  }
  return { ok: true };
}
