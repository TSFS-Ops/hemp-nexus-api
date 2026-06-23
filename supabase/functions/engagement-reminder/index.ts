/**
 * engagement-reminder — Cron-triggered function that flags engagements
 * stuck in 'notification_sent' for 7+ days and sends admin alerts.
 *
 * Called by pg_cron on a daily schedule.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { resolveNotificationsFor } from "../_shared/resolve-notifications.ts";
import { resolveAdminRecipients } from "../_shared/admin-recipients.ts";

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  const allowedOrigins = Deno.env.get("ALLOWED_ORIGINS") || '';
  const origin = req.headers.get("origin");
  const headers = corsHeaders(allowedOrigins, origin);

  const corsResponse = handleCors(req, allowedOrigins);
  if (corsResponse) return corsResponse;

  try {
    // SECURITY: Internal cron auth — INTERNAL_CRON_KEY must be set in production.
    // No fallback to ANON_KEY (which ships in browser bundle) or SERVICE_ROLE_KEY.
    const cronKey = req.headers.get("x-internal-key") || req.headers.get("authorization")?.replace("Bearer ", "");
    const expectedKey = Deno.env.get("INTERNAL_CRON_KEY");
    if (!expectedKey) {
      console.error("[engagement-reminder] INTERNAL_CRON_KEY is not configured — refusing to run.");
      return new Response(JSON.stringify({ error: "Server not configured" }), { status: 503, headers });
    }
    if (!cronKey || cronKey !== expectedKey) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // 1. Find engagements stuck in 'notification_sent' for 7+ days
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: staleEngagements, error: fetchErr } = await supabase
      .from("poi_engagements")
      .select(`
        id, match_id, org_id, counterparty_email, counterparty_type, created_at,
        matches:match_id ( commodity, quantity_amount, quantity_unit, price_amount, price_currency ),
        initiator_org:org_id ( name )
      `)
      .eq("engagement_status", "notification_sent")
      .lt("created_at", sevenDaysAgo)
      .limit(50);

    if (fetchErr) throw fetchErr;

    // NOTE: Do NOT early-return here — auto-expiry below must always run regardless
    // of whether there are stale (≥7-day) engagements needing reminders.
    const hasStale = staleEngagements && staleEngagements.length > 0;
    if (!hasStale) {
      console.log(`[${requestId}] No stale engagements found — proceeding to auto-expiry sweep.`);
    }

    console.log(`[${requestId}] Found ${staleEngagements.length} stale engagement(s).`);

    // 2. Create admin notifications for each stale engagement (skip when none)
    if (hasStale) {
      // ── NOT-010: TOCTOU recheck ─────────────────────────────────
      // The fetch above used a stale snapshot. Re-read live status for
      // each candidate and skip any that have moved out of
      // 'notification_sent' (e.g. counterparty just accepted). Each
      // skip is recorded as notification_skipped(lifecycle_noop) so
      // operators can count silent skips by cause.
      const candidateIds = staleEngagements!.map((e: any) => e.id);
      const { data: liveRows } = await supabase
        .from("poi_engagements")
        .select("id, engagement_status")
        .in("id", candidateIds);
      const liveStatusById = new Map<string, string | null>(
        (liveRows ?? []).map((r: any) => [r.id, r.engagement_status]),
      );

      const stillStale: any[] = [];
      const skippedStale: { id: string; org_id: string | null; status: string | null }[] = [];
      for (const e of staleEngagements as any[]) {
        const live = liveStatusById.get(e.id) ?? null;
        if (live === "notification_sent") {
          stillStale.push(e);
        } else {
          skippedStale.push({ id: e.id, org_id: e.org_id ?? null, status: live });
        }
      }

      for (const s of skippedStale) {
        try {
          await supabase.from("audit_logs").insert({
            org_id: s.org_id ?? "00000000-0000-0000-0000-000000000000",
            action: "notification_skipped",
            entity_type: "notification",
            entity_id: s.id,
            metadata: {
              reason: "lifecycle_noop",
              source_function: "engagement-reminder",
              channel: "in_app",
              target_id: s.id,
              current_status: s.status,
              request_id: requestId,
              timestamp: new Date().toISOString(),
            },
          });
        } catch (auditErr) {
          console.warn(`[${requestId}] Failed to write lifecycle_noop skip audit for ${s.id}:`, auditErr);
        }
      }

      let insertedReminderCount = 0;
      let duplicateSkippedCount = 0;
      let duplicateSkippedIds: string[] = [];

      // ── Admin recipient resolution (P011 routing) ─────────────
      // Resolve real platform_admin user_ids. notifications.user_id is NOT NULL,
      // so we MUST route to actual admin users. If no admins exist, skip insert
      // entirely and record routing_failed in admin_audit_logs.
      const adminRouting = await resolveAdminRecipients(supabase, "engagement.reminder");
      const adminRecipients = adminRouting.recipients;
      const routingFailed = adminRouting.routingFailed || adminRecipients.length === 0;

      if (stillStale.length === 0) {
        console.log(`[${requestId}] All ${staleEngagements!.length} fetched stale engagements have since moved status — no reminders inserted.`);
      } else if (routingFailed) {
        console.warn(`[${requestId}] No admin recipients resolved for engagement.reminder — skipping notification insert.`);
        await supabase.from("admin_audit_logs").insert({
          admin_user_id: null,
          action: "engagement.reminder_batch",
          target_type: "poi_engagement",
          target_id: null,
          details: {
            request_id: requestId,
            stale_count: stillStale.length,
            skipped_lifecycle_noop_count: skippedStale.length,
            notifications_inserted_count: 0,
            duplicate_skipped_count: 0,
            duplicate_skipped_engagement_ids: [],
            engagement_ids: stillStale.map((e: any) => e.id),
            recipient_count: 0,
            routing_failed: true,
            routed_to_fallback: false,
            routing_policy_key: adminRouting.policy.policyKey,
          },
        });
      } else {
        // ── Idempotency pre-filter ─────────────────────────────────
        // Backed by partial unique index
        //   notifications_engagement_reminder_unresolved_uniq
        //   ON (entity_id, user_id)
        //   WHERE type='engagement_reminder'
        //     AND entity_type='poi_engagement'
        //     AND resolved_at IS NULL
        // Skip any (engagement, recipient) pair that already has an UNRESOLVED
        // admin reminder. The unique index is the durable guard against
        // concurrent overlap; this pre-filter avoids unnecessary insert failures.
        const stillStaleIds = stillStale.map((e: any) => e.id);
        const recipientIds = adminRecipients.map((r) => r.userId);
        const { data: existingReminders, error: existingErr } = await supabase
          .from("notifications")
          .select("entity_id, user_id")
          .eq("type", "engagement_reminder")
          .eq("entity_type", "poi_engagement")
          .is("resolved_at", null)
          .in("entity_id", stillStaleIds)
          .in("user_id", recipientIds);
        if (existingErr) {
          console.warn(`[${requestId}] Could not pre-filter existing reminders: ${existingErr.message}`);
        }
        const alreadyKey = (entityId: string, userId: string) => `${entityId}::${userId}`;
        const alreadyReminded = new Set<string>(
          (existingReminders ?? []).map((r: any) => alreadyKey(r.entity_id, r.user_id)),
        );

        // Build cross-product (engagement × admin recipient) skipping pre-existing pairs.
        const notifications: Array<{
          user_id: string;
          type: string;
          title: string;
          body: string;
          entity_type: string;
          entity_id: string;
          read: boolean;
        }> = [];
        const duplicateSkippedEntityIds = new Set<string>();
        for (const eng of stillStale as any[]) {
          for (const r of adminRecipients) {
            if (alreadyReminded.has(alreadyKey(eng.id, r.userId))) {
              duplicateSkippedEntityIds.add(eng.id);
              duplicateSkippedCount += 1;
              continue;
            }
            notifications.push({
              user_id: r.userId,
              type: "engagement_reminder",
              title: "Stale engagement - 7 days without contact",
              body: `Engagement for ${eng.matches?.commodity || "unknown commodity"} from ${eng.initiator_org?.name || "unknown org"} has been waiting 7+ days. Counterparty: ${eng.counterparty_email || eng.counterparty_type}. Consider manual outreach.`,
              entity_type: "poi_engagement",
              entity_id: eng.id,
              read: false,
            });
          }
        }
        duplicateSkippedIds = Array.from(duplicateSkippedEntityIds);

        if (notifications.length > 0) {
          // Batch insert first; on unique-violation race (23505), retry per-row
          // and silently skip the duplicates that the partial unique index caught.
          const { data: batchInserted, error: notifErr } = await supabase
            .from("notifications")
            .insert(notifications)
            .select("entity_id");
          if (notifErr) {
            const isUniqueViolation =
              (notifErr as any).code === "23505" ||
              /duplicate key|unique constraint/i.test(notifErr.message ?? "");
            if (isUniqueViolation) {
              console.warn(`[${requestId}] Batch reminder insert hit unique-violation race — falling back to per-row inserts.`);
              for (const row of notifications) {
                const { error: rowErr } = await supabase
                  .from("notifications")
                  .insert(row)
                  .select("entity_id")
                  .single();
                if (!rowErr) {
                  insertedReminderCount += 1;
                } else {
                  const rowUniqueViolation =
                    (rowErr as any).code === "23505" ||
                    /duplicate key|unique constraint/i.test(rowErr.message ?? "");
                  if (rowUniqueViolation) {
                    duplicateSkippedCount += 1;
                    if (!duplicateSkippedIds.includes(row.entity_id)) {
                      duplicateSkippedIds.push(row.entity_id);
                    }
                  } else {
                    console.warn(`[${requestId}] Could not insert reminder for ${row.entity_id}: ${rowErr.message}`);
                  }
                }
              }
            } else {
              console.warn(`[${requestId}] Could not insert notifications: ${notifErr.message}`);
            }
          } else {
            insertedReminderCount = batchInserted?.length ?? notifications.length;
          }
        }

        await supabase.from("admin_audit_logs").insert({
          admin_user_id: null,
          action: "engagement.reminder_batch",
          target_type: "poi_engagement",
          target_id: null,
          details: {
            request_id: requestId,
            stale_count: stillStale.length,
            skipped_lifecycle_noop_count: skippedStale.length,
            notifications_inserted_count: insertedReminderCount,
            duplicate_skipped_count: duplicateSkippedCount,
            duplicate_skipped_engagement_ids: duplicateSkippedIds,
            engagement_ids: stillStale.map((e: any) => e.id),
            recipient_count: adminRecipients.length,
            routing_failed: false,
            routed_to_fallback: adminRouting.routedToFallback,
            routing_policy_key: adminRouting.policy.policyKey,
          },
        });
      }
    }

    // 4. Auto-expire engagements past their expires_at date
    const now = new Date().toISOString();

    // Fetch first so we can record previous_status in the immutable outreach log.
    const { data: toExpire, error: fetchExpireErr } = await supabase
      .from("poi_engagements")
      .select("id, engagement_status")
      .lt("expires_at", now)
      .in("engagement_status", ["notification_sent", "contacted"]);

    let expired: { id: string }[] = [];
    if (fetchExpireErr) {
      console.warn(`[${requestId}] Auto-expire fetch error: ${fetchExpireErr.message}`);
    } else if (toExpire && toExpire.length > 0) {
      // ── Atomic per-row expiry via transactional RPC ──
      // Eliminates the race where a row could be marked 'expired' without its outreach log row.
      // Each call wraps update + outreach log + audit log in one transaction with an advisory lock.
      const expiredIds: string[] = [];
      const failedIds: string[] = [];
      for (const e of toExpire as any[]) {
        const { data: txnResult, error: txnErr } = await supabase.rpc(
          "atomic_engagement_transition",
          {
            p_engagement_id: e.id,
            p_actor_type: "system",
            p_actor_user_id: null,
            p_actor_email: null,
            p_actor_name: "Lifecycle Scheduler",
            p_new_status: "expired",
            p_entry_type: "system_action",
            p_contact_method: null,
            p_contact_detail: null,
            p_notes: `Auto-expired by lifecycle scheduler at ${now}`,
            p_audit_action: null,
            p_audit_org_id: null,
          }
        );
        const txn = txnResult as { success: boolean; error?: string } | null;
        if (txnErr || !txn?.success) {
          failedIds.push(e.id);
          console.warn(`[${requestId}] Atomic expiry failed for ${e.id}: ${txnErr?.message || txn?.error}`);
        } else {
          expiredIds.push(e.id);
        }
      }
      expired = expiredIds.map((id) => ({ id }));
      console.log(`[${requestId}] Auto-expired ${expired.length} engagement(s) atomically; ${failedIds.length} failed.`);

      if (expiredIds.length > 0) {
        await supabase.from("admin_audit_logs").insert({
          admin_user_id: null,
          action: "engagement.auto_expired",
          target_type: "poi_engagement",
          target_id: null,
          details: {
            request_id: requestId,
            expired_count: expiredIds.length,
            failed_count: failedIds.length,
            engagement_ids: expiredIds,
            failed_ids: failedIds,
          },
        });

        // NOT-008: resolve any unread in-app notifications (stale-reminder
        // admin alerts, counterparty "respond" pings) attached to these
        // now-expired engagements.
        for (const id of expiredIds) {
          await resolveNotificationsFor(supabase, "poi_engagement", id, {
            requestId,
            source: "engagement-reminder:auto_expired",
          });
        }
      }
    }

    return new Response(JSON.stringify({
      processed: staleEngagements?.length || 0,
      expired: expired?.length || 0,
      request_id: requestId,
    }), {
      status: 200,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error(`[${requestId}] engagement-reminder error:`, error);
    return new Response(JSON.stringify({
      error: "Internal error",
      request_id: requestId,
    }), {
      status: 500,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }
});
