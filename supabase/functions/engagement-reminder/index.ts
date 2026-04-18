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

    if (!staleEngagements || staleEngagements.length === 0) {
      console.log(`[${requestId}] No stale engagements found.`);
      return new Response(JSON.stringify({ processed: 0 }), {
        status: 200,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    console.log(`[${requestId}] Found ${staleEngagements.length} stale engagement(s).`);

    // 2. Create admin notifications for each stale engagement
    const notifications = staleEngagements.map((eng: any) => ({
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

    // Insert notifications (best-effort — table may not exist in all envs)
    const { error: notifErr } = await supabase
      .from("notifications")
      .insert(notifications);

    if (notifErr) {
      console.warn(`[${requestId}] Could not insert notifications: ${notifErr.message}`);
    }

    // 3. Audit trail
    await supabase.from("admin_audit_logs").insert({
      admin_user_id: null,
      action: "engagement.reminder_batch",
      target_type: "poi_engagement",
      target_id: null,
      details: {
        request_id: requestId,
        stale_count: staleEngagements.length,
        engagement_ids: staleEngagements.map((e: any) => e.id),
      },
    });

    // 4. Auto-expire engagements past their expires_at date
    const now = new Date().toISOString();
    const { data: expired, error: expireErr } = await supabase
      .from("poi_engagements")
      .update({ engagement_status: "expired" })
      .lt("expires_at", now)
      .in("engagement_status", ["notification_sent", "contacted"])
      .select("id");

    if (expireErr) {
      console.warn(`[${requestId}] Auto-expire error: ${expireErr.message}`);
    } else if (expired && expired.length > 0) {
      console.log(`[${requestId}] Auto-expired ${expired.length} engagement(s).`);
      
      await supabase.from("admin_audit_logs").insert({
        admin_user_id: null,
        action: "engagement.auto_expired",
        target_type: "poi_engagement",
        target_id: null,
        details: {
          request_id: requestId,
          expired_count: expired.length,
          engagement_ids: expired.map((e: any) => e.id),
        },
      });
    }

    return new Response(JSON.stringify({
      processed: staleEngagements.length,
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
