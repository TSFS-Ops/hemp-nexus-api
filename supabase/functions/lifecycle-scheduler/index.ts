import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, handleCors } from "../_shared/cors.ts";

/**
 * Lifecycle Scheduler — handles multiple periodic tasks:
 *
 * 1. INT-UNLOCK: Expire mutual interests after 30 days → revoke intelligence
 * 2. POD/BREACH: Auto-detect breached milestones (overdue) + 7-day grace period
 *
 * Designed to be called via pg_cron (daily at 3 AM UTC).
 */

Deno.serve(async (req: Request) => {
  const allowedOrigins = Deno.env.get("ALLOWED_ORIGINS") || "*";
  const origin = req.headers.get("origin");
  const headers = corsHeaders(allowedOrigins, origin);

  try {
    const corsResponse = handleCors(req, allowedOrigins);
    if (corsResponse) return corsResponse;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    const results: Record<string, unknown> = {};

    // ────────────────────────────────────────────
    // 1. INT-UNLOCK: Expire mutual interests > 30 days
    // ────────────────────────────────────────────
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    // Expire accepted invites that are older than 30 days and haven't progressed to a match
    const { data: expiredInvites, error: inviteErr } = await admin
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

    // Expire pending signals older than 30 days
    const { data: expiredSignals, error: signalErr } = await admin
      .from("signals")
      .update({ status: "expired" })
      .eq("status", "active")
      .lt("created_at", thirtyDaysAgo)
      .select("id");

    results.expired_signals = {
      count: (expiredSignals || []).length,
      error: signalErr?.message || null,
    };

    // Expire matches in DRAFT/PENDING_APPROVAL state older than 30 days
    const { data: expiredMatches, error: matchErr } = await admin
      .from("matches")
      .update({ poi_state: "EXPIRED", status: "expired" })
      .in("poi_state", ["DRAFT", "PENDING_APPROVAL"])
      .lt("created_at", thirtyDaysAgo)
      .select("id");

    results.expired_matches = {
      count: (expiredMatches || []).length,
      error: matchErr?.message || null,
    };

    // ────────────────────────────────────────────
    // 2. POD/BREACH: Auto-detect overdue milestones
    // ────────────────────────────────────────────
    const now = new Date().toISOString();

    // Find milestones that are overdue (due_at < now, not completed, no breach detected yet)
    const { data: overdueMilestones, error: msErr } = await admin
      .from("pod_milestones")
      .select("id, pod_id, org_id, name, due_at")
      .lt("due_at", now)
      .is("completed_at", null)
      .is("breach_detected_at", null)
      .eq("status", "pending");

    let breachesCreated = 0;
    if (overdueMilestones && overdueMilestones.length > 0) {
      for (const ms of overdueMilestones) {
        const gracePeriodEnd = new Date(new Date(ms.due_at).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

        // Mark breach detected with 7-day grace period
        await admin
          .from("pod_milestones")
          .update({
            status: "breach_detected",
            breach_detected_at: now,
            grace_period_ends_at: gracePeriodEnd,
            detected_deficiency_at: now,
          })
          .eq("id", ms.id);

        // Create breach record
        const { error: breachErr } = await admin.from("breaches").insert({
          org_id: ms.org_id,
          pod_id: ms.pod_id,
          milestone_id: ms.id,
          reason: `Milestone "${ms.name}" overdue since ${ms.due_at}`,
          status: "grace_period",
          detected_at: now,
        });

        if (!breachErr) breachesCreated++;
      }
    }

    results.breach_detection = {
      overdue_milestones_found: (overdueMilestones || []).length,
      breaches_created: breachesCreated,
      error: msErr?.message || null,
    };

    // Finalise breaches past grace period (7 days after detection)
    const { data: expiredBreaches, error: expBreachErr } = await admin
      .from("breaches")
      .select("id, pod_id, org_id, milestone_id")
      .eq("status", "grace_period")
      .lt("detected_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());

    let breachesFinalised = 0;
    if (expiredBreaches && expiredBreaches.length > 0) {
      for (const breach of expiredBreaches) {
        // Check if milestone was remediated during grace period
        const { data: milestone } = await admin
          .from("pod_milestones")
          .select("completed_at")
          .eq("id", breach.milestone_id)
          .maybeSingle();

        if (milestone?.completed_at) {
          // Remediated — close breach
          await admin.from("breaches").update({ status: "remediated" }).eq("id", breach.id);
        } else {
          // Not remediated — finalise breach
          await admin.from("breaches").update({ status: "finalised" }).eq("id", breach.id);
          await admin
            .from("pod_milestones")
            .update({ status: "breached" })
            .eq("id", breach.milestone_id);
          breachesFinalised++;
        }
      }
    }

    results.breach_finalisation = {
      evaluated: (expiredBreaches || []).length,
      finalised: breachesFinalised,
      error: expBreachErr?.message || null,
    };

    // ── Audit ──
    await admin.from("audit_logs").insert({
      org_id: "00000000-0000-0000-0000-000000000000",
      action: "lifecycle.scheduler.completed",
      entity_type: "system",
      metadata: results,
    }).then(() => {}).catch(() => {});

    return new Response(JSON.stringify({
      success: true,
      timestamp: now,
      results,
    }), { status: 200, headers: { ...headers, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("Lifecycle scheduler error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }), {
      status: 500,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }
});
