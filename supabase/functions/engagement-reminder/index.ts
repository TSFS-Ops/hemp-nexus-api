/**
 * engagement-reminder — Cron-triggered function that flags engagements
 * stuck in 'notification_sent' for 7+ days and sends admin alerts.
 *
 * Called by pg_cron on a daily schedule.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, handleCors } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  const allowedOrigins = Deno.env.get("ALLOWED_ORIGINS") || "*";
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

      if (stillStale.length === 0) {
        console.log(`[${requestId}] All ${staleEngagements!.length} fetched stale engagements have since moved status — no reminders inserted.`);
      } else {
        const notifications = stillStale.map((eng: any) => ({
          user_id: null, // Admin-targeted (null = system)
          type: "engagement_reminder",
          title: "Stale engagement - 7 days without contact",
          message: `Engagement for ${eng.matches?.commodity || "unknown commodity"} from ${eng.initiator_org?.name || "unknown org"} has been waiting 7+ days. Counterparty: ${eng.counterparty_email || eng.counterparty_type}. Consider manual outreach.`,
          metadata: {
            engagement_id: eng.id,
            match_id: eng.match_id,
            org_id: eng.org_id,
            days_stale: Math.floor((Date.now() - new Date(eng.created_at).getTime()) / (1000 * 60 * 60 * 24)),
          },
          read: false,
        }));

        const { error: notifErr } = await supabase
          .from("notifications")
          .insert(notifications);
        if (notifErr) {
          console.warn(`[${requestId}] Could not insert notifications: ${notifErr.message}`);
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
            engagement_ids: stillStale.map((e: any) => e.id),
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
