import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { triggerWebhooks } from "../_shared/webhooks.ts";
import { cacheHeaders } from "../_shared/cache.ts";
import { clampSubject } from "../_shared/email-subject.ts";
import { recordNotificationSkipped } from "../_shared/notification-skip-audit.ts";

/**
 * Lifecycle Scheduler - handles periodic tasks:
 *
 * 1. INT-UNLOCK: Expire mutual interests after 30 days → revoke intelligence
 * 2. POD/BREACH: Auto-detect breached milestones (overdue) + 7-day grace period
 * 3. NOTIFICATIONS: Dispatch overdue/breach alerts via notification-dispatch
 * 4. ESCALATION: Escalate unresolved breaches past grace period
 * 4. ESCALATION: Escalate unresolved breaches past grace period
 * 5. STALE-UNILATERAL: Flag unilateral intents with no trading partner after N days
 *
 * Designed to be called via pg_cron (daily at 3 AM UTC).
 * Deduplication: Uses breach_detected_at on milestones and unique index on breaches
 * to prevent duplicate records on repeated runs.
 */

const STALE_UNILATERAL_DAYS = 7;

const BREACH_GRACE_DAYS = 7;
const OVERDUE_SEVERITY_THRESHOLDS = {
  low: 0,       // Just overdue
  medium: 3,    // 3+ days overdue
  high: 7,      // 7+ days overdue (past grace)
  critical: 14, // 14+ days overdue
};

function computeSeverity(daysOverdue: number): string {
  if (daysOverdue >= OVERDUE_SEVERITY_THRESHOLDS.critical) return "critical";
  if (daysOverdue >= OVERDUE_SEVERITY_THRESHOLDS.high) return "high";
  if (daysOverdue >= OVERDUE_SEVERITY_THRESHOLDS.medium) return "medium";
  return "low";
}

Deno.serve(async (req: Request) => {
  const allowedOrigins = Deno.env.get("ALLOWED_ORIGINS") || "*";
  const origin = req.headers.get("origin");
  const headers = corsHeaders(allowedOrigins, origin);

  try {
    const corsResponse = handleCors(req, allowedOrigins);
    if (corsResponse) return corsResponse;

    // ── Auth: require internal cron key OR service_role JWT ──
    const internalKey = Deno.env.get("INTERNAL_CRON_KEY");
    const providedKey = req.headers.get("x-internal-key");
    const authHeader = req.headers.get("authorization") || "";
    const isServiceRole = authHeader.includes(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "NEVER_MATCH");

    if (internalKey && providedKey !== internalKey && !isServiceRole) {
      return new Response(JSON.stringify({ error: "Unauthorised" }), {
        status: 401,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    // ── Dry-run flag (Stage 2C-B) ──
    let dryRun = false;
    if (req.method === "POST") {
      try {
        const body = await req.clone().json().catch(() => ({}));
        dryRun = body?.dry_run === true || body?.dryRun === true;
      } catch { /* no/invalid body — treat as production run */ }
    }

    const results: Record<string, unknown> = { dry_run: dryRun };
    const runRequestId = (typeof crypto !== "undefined" && (crypto as any).randomUUID)
      ? (crypto as any).randomUUID()
      : `lcs-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const startedAt = new Date();
    const startedAtIso = startedAt.toISOString();
    const now = new Date();
    const nowIso = now.toISOString();
    results.request_id = runRequestId;
    results.started_at = startedAtIso;

    // CONCURRENCY GUARD: Advisory lock prevents duplicate scheduler runs
    const { data: lockAcquired, error: lockErr } = await admin.rpc('try_lifecycle_lock');
    if (lockErr || !lockAcquired) {
      console.warn("[lifecycle-scheduler] Another instance is already running. Skipping.");
      // D-07: audit the silent skip so concurrent no-ops are distinguishable
      // from successful runs in 24h skip-by-reason rollups.
      await recordNotificationSkipped(admin, {
        reason: "concurrent_run_blocked",
        sourceFunction: "lifecycle-scheduler",
        lifecycleEventType: "scheduler.run",
        extra: { lock_error: lockErr?.message ?? null, dry_run: dryRun },
      });
      return new Response(JSON.stringify({
        success: false,
        reason: "CONCURRENT_RUN_BLOCKED",
        message: "Another lifecycle-scheduler instance is already running.",
      }), { status: 200, headers: { ...headers, ...cacheHeaders("no-cache"), "Content-Type": "application/json" } });
    }

    // Ensure lock is released even on error
    const releaseLock = async () => {
      try { await admin.rpc('release_lifecycle_lock'); } catch { /* best-effort */ }
    };

    // ────────────────────────────────────────────
    // 1. INT-UNLOCK: Expire mutual interests > 30 days
    // ────────────────────────────────────────────
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    // 1a. Expire stale accepted invites
    const { data: expiredInvites, error: inviteErr } = dryRun
      ? await admin
          .from("invites")
          .select("id")
          .eq("status", "accepted")
          .lt("accepted_at", thirtyDaysAgo)
          .is("match_id", null)
      : await admin
          .from("invites")
          .update({ status: "expired" })
          .eq("status", "accepted")
          .lt("accepted_at", thirtyDaysAgo)
          .is("match_id", null)
          .select("id");

    results.expired_invites = {
      count: (expiredInvites || []).length,
      error: inviteErr?.message || null,
    };

    // 1b. Expire stale active signals
    const { data: expiredSignals, error: signalErr } = dryRun
      ? await admin
          .from("signals")
          .select("id")
          .eq("status", "active")
          .lt("created_at", thirtyDaysAgo)
      : await admin
          .from("signals")
          .update({ status: "expired" })
          .eq("status", "active")
          .lt("created_at", thirtyDaysAgo)
          .select("id");

    results.expired_signals = {
      count: (expiredSignals || []).length,
      error: signalErr?.message || null,
    };

    // 1c. Expire stale draft/pending matches - only update poi_state (avoid status constraint violation)
    // Phase 1 demo isolation: never expire demo matches via lifecycle.
    // Batch K Fix 6/7: capture before-snapshot per match and write per-match audit on apply runs.
    const { data: matchesToExpire, error: matchSelectErr } = await admin
      .from("matches")
      .select("id, org_id, state, status, poi_state")
      .in("poi_state", ["DRAFT", "PENDING_APPROVAL"])
      .lt("created_at", thirtyDaysAgo)
      .eq("is_demo", false);

    let expiredMatches: Array<{ id: string }> = [];
    let matchErr: { message?: string } | null = matchSelectErr ?? null;
    if (!dryRun && matchesToExpire && matchesToExpire.length > 0) {
      const ids = matchesToExpire.map((m: any) => m.id);
      const { data: updated, error: updErr } = await admin
        .from("matches")
        .update({ poi_state: "EXPIRED" })
        .in("id", ids)
        .select("id");
      expiredMatches = updated ?? [];
      matchErr = updErr ?? matchErr;

      // Per-match audit rows (Fix 6).
      const auditRows = matchesToExpire
        .filter((m: any) => expiredMatches.some((u) => u.id === m.id))
        .map((m: any) => ({
          org_id: m.org_id ?? "00000000-0000-0000-0000-000000000000",
          action: "match.expired_by_lifecycle",
          entity_type: "match",
          entity_id: m.id,
          metadata: {
            request_id: runRequestId,
            cutoff: thirtyDaysAgo,
            reason: "poi_pending_age_exceeded",
            before: { state: m.state, status: m.status, poi_state: m.poi_state },
            after: { state: m.state, status: m.status, poi_state: "EXPIRED" },
            note: "matches.state/status retained — schema has no 'expired' value; UI must derive from poi_state. (Fix 7)",
          },
        }));
      if (auditRows.length > 0) {
        try { await admin.from("audit_logs").insert(auditRows); } catch (e) {
          console.error("[lifecycle-scheduler] per-match expiry audit failed:", e);
        }
      }
    } else if (dryRun) {
      expiredMatches = (matchesToExpire ?? []).map((m: any) => ({ id: m.id }));
    }

    results.expired_matches = {
      count: expiredMatches.length,
      error: matchErr?.message || null,
    };

    // ────────────────────────────────────────────
    // 1d. Expire trade_orders past their expires_at
    // ────────────────────────────────────────────
    const { data: expiredOrders, error: orderErr } = dryRun
      ? await admin
          .from("trade_orders")
          .select("id")
          .eq("status", "active")
          .lt("expires_at", nowIso)
      : await admin
          .from("trade_orders")
          .update({ status: "expired" })
          .eq("status", "active")
          .lt("expires_at", nowIso)
          .select("id");

    results.expired_trade_orders = {
      count: (expiredOrders || []).length,
      error: orderErr?.message || null,
    };

    // ────────────────────────────────────────────
    // 2. POD/BREACH: Auto-detect overdue milestones
    // ────────────────────────────────────────────
    // Find milestones that are overdue (due_at < now, not completed, no breach detected yet)
    // The `breach_detected_at IS NULL` guard prevents duplicate processing on re-runs.
    const { data: overdueMilestones, error: msErr } = await admin
      .from("pod_milestones")
      .select("id, pod_id, org_id, name, due_at")
      .lt("due_at", nowIso)
      .is("completed_at", null)
      .is("breach_detected_at", null)
      .in("status", ["pending", "OPEN"]);

    let breachesCreated = 0;
    const notificationQueue: Array<{
      event_type: string;
      subject: string;
      message: string;
      metadata: Record<string, unknown>;
    }> = [];

    if (overdueMilestones && overdueMilestones.length > 0) {
      for (const ms of overdueMilestones) {
        const dueDate = new Date(ms.due_at);
        const daysOverdue = Math.floor((now.getTime() - dueDate.getTime()) / (24 * 60 * 60 * 1000));
        const severity = computeSeverity(daysOverdue);
        const gracePeriodEnd = new Date(dueDate.getTime() + BREACH_GRACE_DAYS * 24 * 60 * 60 * 1000).toISOString();

        if (dryRun) {
          // Dry-run: count what WOULD become a breach, do not mutate
          breachesCreated++;
          continue;
        }

        // Mark breach detected with grace period on milestone
        await admin
          .from("pod_milestones")
          .update({
            status: "breach_detected",
            breach_detected_at: nowIso,
            grace_period_ends_at: gracePeriodEnd,
            detected_deficiency_at: nowIso,
            overdue_notified_at: nowIso,
          })
          .eq("id", ms.id)
          .is("breach_detected_at", null); // Double-guard against race conditions

        // Create breach record - unique index prevents duplicates per milestone
        const { error: breachErr } = await admin.from("breaches").insert({
          org_id: ms.org_id,
          pod_id: ms.pod_id,
          milestone_id: ms.id,
          reason: `Milestone "${ms.name}" overdue since ${dueDate.toISOString().split("T")[0]} (${daysOverdue} day${daysOverdue !== 1 ? "s" : ""})`,
          status: "grace_period",
          severity,
          detected_at: nowIso,
        });

        if (!breachErr) {
          breachesCreated++;
          // Queue notification
          notificationQueue.push({
            event_type: "delivery.milestone.overdue",
            subject: `Milestone overdue: ${ms.name}`,
            message: `Milestone "${ms.name}" is ${daysOverdue} day${daysOverdue !== 1 ? "s" : ""} overdue. A ${BREACH_GRACE_DAYS}-day grace period has been applied. Severity: ${severity}.`,
            metadata: {
              org_id: ms.org_id,
              pod_id: ms.pod_id,
              milestone_id: ms.id,
              days_overdue: daysOverdue,
              severity,
              grace_period_ends: gracePeriodEnd,
            },
          });
        }
        // If breach insert failed due to unique constraint, that's expected dedup - skip silently
      }
    }

    results.breach_detection = {
      overdue_milestones_found: (overdueMilestones || []).length,
      breaches_created: breachesCreated,
      error: msErr?.message || null,
    };

    // ────────────────────────────────────────────
    // 3. BREACH ESCALATION: Finalise breaches past grace period
    // ────────────────────────────────────────────
    const gracePeriodCutoff = new Date(Date.now() - BREACH_GRACE_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const { data: expiredBreaches, error: expBreachErr } = await admin
      .from("breaches")
      .select("id, pod_id, org_id, milestone_id, severity")
      .eq("status", "grace_period")
      .lt("detected_at", gracePeriodCutoff);

    let breachesFinalised = 0;
    let breachesRemediated = 0;

    if (expiredBreaches && expiredBreaches.length > 0) {
      for (const breach of expiredBreaches) {
        // Check if milestone was remediated during grace period (read-only — safe in dry-run)
        const { data: milestone } = await admin
          .from("pod_milestones")
          .select("completed_at")
          .eq("id", breach.milestone_id)
          .maybeSingle();

        if (milestone?.completed_at) {
          if (dryRun) {
            breachesRemediated++;
            continue;
          }
          // Remediated - close breach
          await admin.from("breaches")
            .update({ status: "remediated", resolved_at: nowIso, resolution_note: "Milestone completed during grace period" })
            .eq("id", breach.id);
          breachesRemediated++;
        } else {
          // Not remediated - escalate to finalised, increase severity
          const escalatedSeverity = breach.severity === "low" ? "medium"
            : breach.severity === "medium" ? "high"
            : "critical";

          if (dryRun) {
            breachesFinalised++;
            // Still record what notification WOULD be queued
            notificationQueue.push({
              event_type: "delivery.breach.escalated",
              subject: `Breach escalated - grace period expired`,
              message: `[DRY-RUN] Would escalate PoD ${breach.pod_id} breach to "${escalatedSeverity}".`,
              metadata: {
                org_id: breach.org_id,
                pod_id: breach.pod_id,
                breach_id: breach.id,
                severity: escalatedSeverity,
              },
            });
            continue;
          }

          await admin.from("breaches")
            .update({ status: "finalised", severity: escalatedSeverity, escalated_at: nowIso })
            .eq("id", breach.id);
          await admin
            .from("pod_milestones")
            .update({ status: "breached" })
            .eq("id", breach.milestone_id);

          // Update PoD state to BREACHED
          await admin.from("pods")
            .update({ state: "BREACHED" })
            .eq("id", breach.pod_id);

          breachesFinalised++;

          // Queue escalation notification
          notificationQueue.push({
            event_type: "delivery.breach.escalated",
            subject: `Breach escalated - grace period expired`,
            message: `A breach on PoD ${breach.pod_id} has been escalated to "${escalatedSeverity}" severity after the ${BREACH_GRACE_DAYS}-day grace period expired without remediation.`,
            metadata: {
              org_id: breach.org_id,
              pod_id: breach.pod_id,
              breach_id: breach.id,
              severity: escalatedSeverity,
            },
          });
        }
      }
    }

    results.breach_finalisation = {
      evaluated: (expiredBreaches || []).length,
      finalised: breachesFinalised,
      remediated: breachesRemediated,
      error: expBreachErr?.message || null,
    };

    // ────────────────────────────────────────────
    // 4. DISPATCH NOTIFICATIONS
    // ────────────────────────────────────────────
    let notificationsSent = 0;
    if (!dryRun) {
      for (const notification of notificationQueue) {
        try {
          const { error: dispatchErr } = await admin.functions.invoke("notification-dispatch", {
            body: notification,
          });
          if (!dispatchErr) {
            notificationsSent++;
            // Mark breach notification_sent_at if it's a breach notification
            if (notification.metadata.breach_id) {
              await admin.from("breaches")
                .update({ notification_sent_at: nowIso })
                .eq("id", notification.metadata.breach_id as string);
            }
          } else {
            // D-07: dispatcher invocation returned an error — record skip
            await recordNotificationSkipped(admin, {
              reason: "dispatcher_unavailable",
              sourceFunction: "lifecycle-scheduler",
              lifecycleEventType: notification.event_type,
              orgId: (notification.metadata.org_id as string) || null,
              targetId: (notification.metadata.breach_id as string)
                || (notification.metadata.milestone_id as string)
                || null,
              extra: { dispatch_error: dispatchErr.message ?? String(dispatchErr) },
            });
          }
        } catch (err) {
          console.error("[lifecycle-scheduler] Notification dispatch failed:", err);
          await recordNotificationSkipped(admin, {
            reason: "dispatcher_unavailable",
            sourceFunction: "lifecycle-scheduler",
            lifecycleEventType: notification.event_type,
            orgId: (notification.metadata.org_id as string) || null,
            targetId: (notification.metadata.breach_id as string)
              || (notification.metadata.milestone_id as string)
              || null,
            extra: { error: err instanceof Error ? err.message : String(err) },
          });
        }
      }
    } else {
      // D-07: dry-run intentionally suppresses every queued notification.
      // Audit one row per queued notification so the skip is visible in the
      // 24h skip-by-reason rollup.
      for (const notification of notificationQueue) {
        await recordNotificationSkipped(admin, {
          reason: "dry_run",
          sourceFunction: "lifecycle-scheduler",
          lifecycleEventType: notification.event_type,
          orgId: (notification.metadata.org_id as string) || null,
          targetId: (notification.metadata.breach_id as string)
            || (notification.metadata.milestone_id as string)
            || null,
        });
      }
      // If there were zero queued notifications during a dry-run, also record
      // a single lifecycle_noop row so the absence is observable.
      if (notificationQueue.length === 0) {
        await recordNotificationSkipped(admin, {
          reason: "lifecycle_noop",
          sourceFunction: "lifecycle-scheduler",
          lifecycleEventType: "scheduler.dry_run.no_queue",
          extra: { dry_run: true },
        });
      }
    }

    results.notifications = {
      queued: notificationQueue.length,
      sent: notificationsSent,
      skipped_dry_run: dryRun ? notificationQueue.length : 0,
    };

    // ────────────────────────────────────────────
    // 5. STALE UNILATERAL INTENTS
    // ────────────────────────────────────────────
    const staleCutoff = new Date(Date.now() - STALE_UNILATERAL_DAYS * 24 * 60 * 60 * 1000).toISOString();

    // Find unilateral intents older than threshold with no trading partner attached.
    //
    // Stage 2C-D1: tightened predicate. Excludes records that have already
    // reached a terminal commercial state (committed/settled/COMPLETED) but
    // still have a NULL counterparty due to historical unilateral data shape.
    // Without this, the dry-run flagged completed deals as "stale" and would
    // emit misleading admin alerts on cron activation.
    //
    // Predicate (all must hold):
    //   match_type = 'unilateral'
    //   created_at < staleCutoff
    //   (buyer_id IS NULL OR seller_id IS NULL)
    //   state NOT IN ('completed','cancelled','committed')
    //   status NOT IN ('settled','cancelled')
    //   poi_state IN ('DRAFT','PENDING_APPROVAL','ELIGIBLE')
    const { data: staleIntents, error: staleErr } = await admin
      .from("matches")
      .select("id, org_id, commodity, state, status, poi_state, created_at, buyer_id, seller_id")
      .eq("match_type", "unilateral")
      .lt("created_at", staleCutoff)
      .or("buyer_id.is.null,seller_id.is.null")
      .not("state", "in", "(completed,cancelled,committed)")
      .not("status", "in", "(settled,cancelled)")
      .in("poi_state", ["DRAFT", "PENDING_APPROVAL", "ELIGIBLE"])
      .eq("is_demo", false) // Phase 1 demo isolation
      .limit(200);

    let staleAuditCount = 0;
    let staleNotificationsSkipped = 0;
    let staleWebhooksSkipped = 0;
    if (staleIntents && staleIntents.length > 0) {
      for (const intent of staleIntents) {
        const ageMs = now.getTime() - new Date(intent.created_at).getTime();
        const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));

        if (dryRun) {
          // Count what WOULD happen, do nothing
          staleAuditCount++;
          staleNotificationsSkipped++;
          staleWebhooksSkipped++;
          continue;
        }

        // Log to admin audit
        await admin.from("admin_audit_logs").insert({
          admin_user_id: "00000000-0000-0000-0000-000000000000",
          action: "unilateral.stale_detected",
          target_type: "match",
          target_id: intent.id,
          details: {
            org_id: intent.org_id,
            commodity: intent.commodity,
            state: intent.state,
            age_days: ageDays,
            missing_party: intent.buyer_id == null ? "buyer" : "seller",
          },
        });
        staleAuditCount++;

        // Fire webhook
        try {
          await admin.functions.invoke("notification-dispatch", {
            body: {
              event_type: "unilateral.stale",
              subject: clampSubject(`Stale unilateral intent: ${intent.commodity}`),
              message: `Unilateral intent for "${intent.commodity}" has been waiting ${ageDays} days with no trading partner. Consider following up or expiring.`,
              metadata: {
                org_id: intent.org_id,
                match_id: intent.id,
                age_days: ageDays,
                commodity: intent.commodity,
              },
            },
          });
        } catch {
          // Non-critical
        }

        // Also fire org-level webhooks
        // Stable per-day key so the daily sweeper does not duplicate
        // the same stale notification across runs.
        const staleDay = new Date().toISOString().slice(0, 10);
        triggerWebhooks(admin, intent.org_id, "unilateral.stale", {
          match_id: intent.id,
          commodity: intent.commodity,
          age_days: ageDays,
          state: intent.state,
          missing_party: intent.buyer_id == null ? "buyer" : "seller",
        }, { eventIdempotencyKey: `unilateral.stale:${intent.id}:${staleDay}` }).catch(() => {});
      }
    }

    results.stale_unilateral = {
      detected: (staleIntents || []).length,
      audited: staleAuditCount,
      notifications_skipped_dry_run: staleNotificationsSkipped,
      webhooks_skipped_dry_run: staleWebhooksSkipped,
      error: staleErr?.message || null,
    };

    // ────────────────────────────────────────────
    // 6. LATE-ACCEPTANCE RECONFIRMATION-WINDOW EXPIRY (Batch B Phase 6)
    // ────────────────────────────────────────────
    // Find engagements still in the late-acceptance hold whose 7-day
    // reconfirmation window has elapsed and which have no resolution yet.
    // Each candidate is processed via the atomic RPC, which is idempotent:
    // re-runs against an already-resolved row write nothing and emit no
    // additional audit rows.
    const lateAcceptanceCandidates = await admin
      .from("poi_engagements")
      .select("id, match_id, org_id, reconfirmation_window_expires_at")
      .eq("engagement_status", "late_acceptance_pending_initiator_reconfirmation")
      .is("late_acceptance_resolution", null)
      .lt("reconfirmation_window_expires_at", nowIso)
      .eq("is_demo", false) // Phase 1 demo isolation
      .limit(500);

    let lateAcceptanceSweptCount = 0;
    let lateAcceptanceIdempotentCount = 0;
    let lateAcceptanceErrorCount = 0;
    const lateAcceptanceErrors: Array<{ id: string; error: string }> = [];

    if (lateAcceptanceCandidates.error) {
      lateAcceptanceErrorCount = 1;
      lateAcceptanceErrors.push({ id: "<query>", error: lateAcceptanceCandidates.error.message });
    } else if (lateAcceptanceCandidates.data && lateAcceptanceCandidates.data.length > 0) {
      for (const row of lateAcceptanceCandidates.data) {
        if (dryRun) {
          // Dry-run: count what WOULD be swept; emit no DB writes / audit rows.
          lateAcceptanceSweptCount++;
          continue;
        }
        try {
          const { data: rpcResult, error: rpcErr } = await admin.rpc(
            "atomic_expire_late_acceptance_reconfirmation_window",
            { p_engagement_id: row.id },
          );
          if (rpcErr) {
            lateAcceptanceErrorCount++;
            lateAcceptanceErrors.push({ id: row.id, error: rpcErr.message });
            continue;
          }
          const result = rpcResult as { success?: boolean; idempotent?: boolean; error?: string } | null;
          if (result?.success === false) {
            lateAcceptanceErrorCount++;
            lateAcceptanceErrors.push({ id: row.id, error: result.error ?? "rpc_failure" });
          } else if (result?.idempotent) {
            lateAcceptanceIdempotentCount++;
          } else {
            lateAcceptanceSweptCount++;
          }
        } catch (err) {
          lateAcceptanceErrorCount++;
          lateAcceptanceErrors.push({
            id: row.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    results.late_acceptance_window_expiry = {
      candidates_found: lateAcceptanceCandidates.data?.length ?? 0,
      swept: lateAcceptanceSweptCount,
      idempotent_skips: lateAcceptanceIdempotentCount,
      errors: lateAcceptanceErrorCount,
      error_samples: lateAcceptanceErrors.slice(0, 5),
      // Phase 6 emits NO notifications. The late acceptance remains
      // recorded; the original engagement remains expired and cannot
      // proceed. No counterparty/initiator messaging is dispatched here.
      notifications_dispatched: 0,
    };

    // ────────────────────────────────────────────
    // 7. D4b BINDING-REVIEW BACKLOG DIGEST (admin-only)
    // ────────────────────────────────────────────
    // Counts engagements still parked in `binding_review_required` whose
    // age exceeds 24h, and emits a SINGLE rolled-up admin alert per run
    // (not one per row). Recipient is the platform admin mailbox + Slack
    // webhook only — no org-admin / counterparty / external recipient is
    // ever derived. Helper enforces the recipient policy.
    let bindingBacklogCount = 0;
    let bindingBacklogDispatched = false;
    try {
      const backlogCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: backlog } = await admin
        .from("poi_engagements")
        .select("id, created_at")
        .eq("operational_state", "binding_review_required")
        .lt("created_at", backlogCutoff)
        .eq("is_demo", false) // Phase 1 demo isolation
        .limit(500);
      bindingBacklogCount = backlog?.length ?? 0;

      if (bindingBacklogCount > 0 && !dryRun) {
        const { dispatchD4bAdminAlert } = await import(
          "../_shared/batch-d-admin-notify.ts"
        );
        // Anchor the digest dedupe key to the OLDEST backlog row so a
        // re-run within 60 minutes won't double-fire while still allowing
        // a fresh digest as the backlog turns over.
        const anchorId = backlog![0].id as string;
        const result = await dispatchD4bAdminAlert(admin, {
          eventType: "engagement.binding_review_required",
          engagementId: anchorId,
          backlogCount: bindingBacklogCount,
          sourceFunction: "lifecycle-scheduler:binding_backlog_digest",
        });
        bindingBacklogDispatched = result.dispatched;
      } else if (bindingBacklogCount > 0 && dryRun) {
        await recordNotificationSkipped(admin, {
          reason: "dry_run",
          sourceFunction: "lifecycle-scheduler:binding_backlog_digest",
          lifecycleEventType: "engagement.binding_review_required",
          extra: { backlog_count: bindingBacklogCount },
        });
      }
    } catch (digestErr) {
      console.error("[lifecycle-scheduler] binding-review digest failed:", digestErr);
    }

    results.binding_review_backlog = {
      pending: bindingBacklogCount,
      admin_alert_dispatched: bindingBacklogDispatched,
    };


    // ── Webhook replay-guard pruning ──
    // Drops webhook_replay_guard rows older than 24h so the table stays
    // bounded. Safe to call even if there's nothing to prune.
    // SKIPPED in dry-run (DELETE).
    if (dryRun) {
      results.webhook_replay_guard_pruned = {
        deleted: 0,
        skipped_dry_run: true,
        error: null,
      };
    } else {
      try {
        const { data: prunedCount, error: pruneErr } = await admin.rpc(
          "prune_webhook_replay_guard",
        );
        results.webhook_replay_guard_pruned = {
          deleted: prunedCount ?? 0,
          error: pruneErr?.message || null,
        };
      } catch (pruneErr) {
        results.webhook_replay_guard_pruned = {
          deleted: 0,
          error: pruneErr instanceof Error ? pruneErr.message : String(pruneErr),
        };
      }
    }

    // ── Batch I Fix 4: WaD / POI drift reconciliation ──
    // Read-only probe. Sealed WaDs whose underlying POI later became
    // terminal/disputed/cancelled, or that have a missing POI, are surfaced as
    // idempotent admin_risk_items (deduped via stable dedup_key) so an admin
    // can investigate. The probe NEVER mutates WaD/POI state itself.
    try {
      const driftStates = ["EXPIRED", "REJECTED", "ANNULLED"];
      const { data: sealedWads } = await admin
        .from("wads")
        .select("id, poi_id, status, sealed_at, org_id")
        .not("sealed_at", "is", null)
        .neq("status", "revoked")
        .neq("status", "superseded")
        .limit(500);

      let driftDetected = 0;
      let driftSkipped = 0;
      for (const w of sealedWads ?? []) {
        const { data: poi } = await admin
          .from("matches")
          .select("id, poi_state")
          .eq("id", w.poi_id)
          .maybeSingle();

        let driftKind: string | null = null;
        let driftDetail: Record<string, unknown> = {};
        if (!poi) {
          driftKind = "wad_missing_poi";
          driftDetail = { wad_id: w.id, poi_id: w.poi_id };
        } else if (driftStates.includes(poi.poi_state)) {
          driftKind = "wad_poi_terminal_drift";
          driftDetail = { wad_id: w.id, poi_id: poi.id, poi_state: poi.poi_state };
        }

        if (!driftKind) continue;

        if (dryRun) { driftSkipped++; continue; }
        const dedupKey = `${driftKind}:${w.id}`;
        const { error: riskErr } = await admin
          .from("admin_risk_items")
          .upsert(
            {
              title: `WaD/POI drift: ${driftKind}`,
              description: `Sealed WaD ${w.id} has drifted from its POI: ${JSON.stringify(driftDetail)}`,
              severity: "high",
              status: "open",
              org_id: w.org_id ?? null,
              kind: driftKind,
              dedup_key: dedupKey,
              metadata: driftDetail,
            },
            { onConflict: "dedup_key", ignoreDuplicates: true },
          );
        if (riskErr) {
          console.warn(`[wad-poi-drift] upsert failed for ${w.id}:`, riskErr.message);
          continue;
        }
        await admin.from("audit_logs").insert({
          org_id: w.org_id ?? "00000000-0000-0000-0000-000000000000",
          action: "wad.poi_drift_detected",
          entity_type: "wad",
          entity_id: w.id,
          metadata: { ...driftDetail, dedup_key: dedupKey },
        });
        driftDetected++;
      }
      results.wad_poi_drift = {
        scanned: sealedWads?.length ?? 0,
        drift_detected: driftDetected,
        drift_skipped_dry_run: driftSkipped,
      };
    } catch (err) {
      results.wad_poi_drift = {
        scanned: 0,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    // ── Audit ──
    // Production runs write a completion row. Dry-runs write NOTHING to the
    // database (true zero-mutation contract); the manifest is returned in the
    // HTTP response only.
    if (!dryRun) {
      await admin.from("audit_logs").insert({
        org_id: "00000000-0000-0000-0000-000000000000",
        action: "lifecycle.scheduler.completed",
        entity_type: "system",
        metadata: results,
      }).then(() => {}).catch(() => {});
    }

    // Release advisory lock
    await releaseLock();

    return new Response(JSON.stringify({
      success: true,
      dry_run: dryRun,
      timestamp: nowIso,
      results,
    }), { status: 200, headers: { ...headers, ...cacheHeaders("no-cache"), "Content-Type": "application/json" } });
  } catch (err) {
    // Release advisory lock even on error
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const adminClient = createClient(supabaseUrl, serviceKey);
      await adminClient.rpc('release_lifecycle_lock');
    } catch { /* best-effort */ }

    console.error("Lifecycle scheduler error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }), {
      status: 500,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }
});
