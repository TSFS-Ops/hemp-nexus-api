// outreach-sla-monitor
//
// Scans pending/awaiting-outreach POI engagements that have been sitting
// longer than the configured SLA threshold (default 48h, configurable in
// admin_settings.outreach_sla.threshold_hours) and dispatches a single
// digest email to the configured reminder recipient.
//
// Designed to be invoked on a pg_cron schedule (e.g. hourly) but also
// supports manual POST for ad-hoc triggering from the admin UI.
//
// To prevent duplicate spam, an engagement is only included in the digest
// if its `sla_reminder_sent_at` is null or older than the threshold/2
// since last reminder. Successful inclusion bumps `sla_reminder_count`
// and updates `sla_reminder_sent_at`.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { webhookCorsHeaders } from "../_shared/cors.ts";

// Cron-triggered server-to-server SLA monitor. Emit only Vary: Origin.
const corsHeaders = {
  ...webhookCorsHeaders(),
};

const DEFAULT_THRESHOLD_HOURS = 48;
const DEFAULT_REMINDER_EMAIL = "support@izenzo.co.za";

interface SlaSettings {
  threshold_hours: number;
  reminder_email: string;
  digest_enabled: boolean;
}

async function loadSettings(supabase: ReturnType<typeof createClient>): Promise<SlaSettings> {
  const { data, error } = await supabase
    .from("admin_settings")
    .select("value")
    .eq("key", "outreach_sla")
    .maybeSingle();

  if (error) {
    console.warn("Failed to load outreach_sla settings, using defaults:", error.message);
  }

  const v = (data?.value ?? {}) as Partial<SlaSettings>;
  return {
    threshold_hours: typeof v.threshold_hours === "number" && v.threshold_hours > 0
      ? v.threshold_hours
      : DEFAULT_THRESHOLD_HOURS,
    reminder_email: typeof v.reminder_email === "string" && v.reminder_email.includes("@")
      ? v.reminder_email
      : DEFAULT_REMINDER_EMAIL,
    digest_enabled: v.digest_enabled !== false,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const requestId = crypto.randomUUID();
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const settings = await loadSettings(supabase);

    if (!settings.digest_enabled) {
      return new Response(
        JSON.stringify({ ok: true, skipped: "digest_disabled" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const thresholdMs = settings.threshold_hours * 60 * 60 * 1000;
    const now = Date.now();
    const cutoffIso = new Date(now - thresholdMs).toISOString();
    // Re-remind interval = half the SLA window, clamped to [6h, 24h]
    // so an admin isn't paged hourly about the same overdue item.
    const reReminderMs = Math.max(6 * 3600_000, Math.min(24 * 3600_000, thresholdMs / 2));
    const reReminderCutoffIso = new Date(now - reReminderMs).toISOString();

    // Pull overdue engagements still awaiting outreach. Status filter aligns
    // with the partial index `idx_poi_engagements_sla_scan` for fast scans.
    const { data: overdue, error: queryErr } = await supabase
      .from("poi_engagements")
      .select(`
        id, match_id, engagement_status, counterparty_email,
        counterparty_org_id, created_at,
        sla_reminder_sent_at, sla_reminder_count, org_id,
        matches:match_id ( id, commodity ),
        initiator_org:org_id ( id, name )
      `)
      .in("engagement_status", ["pending", "notification_sent"])
      .lte("created_at", cutoffIso)
      .eq("is_demo", false) // Phase 1 demo isolation: skip Daniel-facing demo rows
      .order("created_at", { ascending: true })
      .limit(50);

    if (queryErr) throw queryErr;

    // Filter out items reminded too recently (avoid duplicate digests).
    const eligibleAfterCadence = (overdue ?? []).filter((e) => {
      if (!e.sla_reminder_sent_at) return true;
      return e.sla_reminder_sent_at <= reReminderCutoffIso;
    });

    // ── NOT-010: TOCTOU recheck ──────────────────────────────────────
    // Status may have flipped (e.g. counterparty accepted) between the
    // initial fetch and now. Re-read the live status for every candidate
    // and drop anything that has left the reminder-eligible set so we
    // never include an accepted/declined/expired engagement in the
    // digest or bump its reminder counter.
    const REMINDER_ELIGIBLE = ["pending", "notification_sent"];
    const candidateIds = eligibleAfterCadence.map((e) => e.id);
    let liveStatusById = new Map<string, string | null>();
    if (candidateIds.length > 0) {
      const { data: liveRows } = await supabase
        .from("poi_engagements")
        .select("id, engagement_status")
        .in("id", candidateIds);
      liveStatusById = new Map(
        (liveRows ?? []).map((r: { id: string; engagement_status: string | null }) => [
          r.id,
          r.engagement_status,
        ]),
      );
    }
    const eligible: typeof eligibleAfterCadence = [];
    const skippedStale: { id: string; org_id: string | null; status: string | null }[] = [];
    for (const e of eligibleAfterCadence) {
      const liveStatus = liveStatusById.get(e.id) ?? null;
      if (liveStatus && REMINDER_ELIGIBLE.includes(liveStatus)) {
        eligible.push(e);
      } else {
        skippedStale.push({ id: e.id, org_id: e.org_id ?? null, status: liveStatus });
      }
    }

    // Audit silent skips so they're observable (idempotent per target/day).
    for (const s of skippedStale) {
      try {
        await supabase.from("audit_logs").insert({
          org_id: s.org_id ?? "00000000-0000-0000-0000-000000000000",
          action: "notification_skipped",
          entity_type: "notification",
          entity_id: s.id,
          metadata: {
            reason: "lifecycle_noop",
            source_function: "outreach-sla-monitor",
            channel: "email",
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

    if (eligible.length === 0) {
      console.log(`[${requestId}] SLA scan: 0 eligible overdue (${(overdue ?? []).length} overdue total, ${skippedStale.length} stale, others recently reminded)`);
      return new Response(
        JSON.stringify({
          ok: true,
          overdue_total: overdue?.length ?? 0,
          eligible_for_reminder: 0,
          skipped_stale: skippedStale.length,
          email_sent: false,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const items = eligible.map((e) => {
      const ageHours = (now - new Date(e.created_at).getTime()) / 3600_000;
      const m = e.matches as any;
      const initiator = e.initiator_org as any;
      return {
        engagementId: e.id,
        matchId: e.match_id,
        commodity: m?.commodity ?? null,
        initiatorOrgName: initiator?.name ?? null,
        counterpartyEmail: e.counterparty_email ?? null,
        counterpartyName: null,
        status: e.engagement_status,
        ageHours,
        reminderCount: e.sla_reminder_count ?? 0,
      };
    });

    // Dispatch single digest email to the configured recipient.
    const idempotencyKey = `sla-digest-${new Date().toISOString().slice(0, 13)}`; // hourly bucket
    const { data: sendResult, error: sendErr } = await supabase.functions.invoke(
      "send-transactional-email",
      {
        body: {
          templateName: "outreach-sla-digest",
          recipientEmail: settings.reminder_email,
          idempotencyKey,
          templateData: {
            thresholdHours: settings.threshold_hours,
            overdueCount: items.length,
            items,
            generatedAt: new Date().toISOString(),
          },
        },
      }
    );

    if (sendErr || (sendResult && (sendResult as any).success === false)) {
      const reason = (sendResult as any)?.reason || (sendErr as any)?.message || "send_failed";
      console.error(`[${requestId}] SLA digest send failed:`, reason);
      return new Response(
        JSON.stringify({ ok: false, error: "digest_send_failed", reason }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Mark each included engagement as reminded so we don't re-spam next tick.
    // ── NOT-010: status predicate on the UPDATE ─────────────────────
    // Even after the recheck above, a final per-row predicate ensures
    // that if status flipped between the recheck and this UPDATE, the
    // counter still won't be bumped on a now-ineligible row.
    const ids = eligible.map((e) => e.id);
    const nowIso = new Date().toISOString();
    // Bump counter individually since Supabase JS doesn't support col + 1 in update.
    await Promise.all(
      eligible.map((e) =>
        supabase
          .from("poi_engagements")
          .update({
            sla_reminder_sent_at: nowIso,
            sla_reminder_count: (e.sla_reminder_count ?? 0) + 1,
          })
          .eq("id", e.id)
          .in("engagement_status", REMINDER_ELIGIBLE)
      )
    );

    // Audit log entry summarising the run.
    await supabase.from("admin_audit_logs").insert({
      action: "outreach.sla_digest_dispatched",
      target_type: "poi_engagement",
      target_id: null,
      details: {
        request_id: requestId,
        threshold_hours: settings.threshold_hours,
        recipient: settings.reminder_email,
        overdue_total: overdue?.length ?? 0,
        included: ids.length,
        engagement_ids: ids,
      },
    });

    // ── DEC-004 (signed): canonical per-engagement "SLA scan flagged
    // manual follow-up" rows (dual-write). One row per engagement
    // included in the digest so HQ → Audit can filter by canonical
    // action name. SSOT: src/lib/outreach/dec-004-states.ts.
    if (ids.length > 0) {
      try {
        await supabase.from("admin_audit_logs").insert(
          ids.map((engagementId) => ({
            action: "outreach.sla_scan_flagged_manual_follow_up",
            target_type: "poi_engagement",
            target_id: engagementId,
            details: {
              dec_rule: "DEC-004",
              manual_owner: "izenzo_platform_admin",
              canonical_state: "reminder_review_required",
              threshold_hours: settings.threshold_hours,
              request_id: requestId,
            },
          })),
        );
      } catch (_e) { /* non-fatal — Phase 1 dual-write */ }
    }


    console.log(
      `[${requestId}] SLA digest dispatched: ${ids.length} engagement(s) to ${settings.reminder_email}`
    );

    return new Response(
      JSON.stringify({
        ok: true,
        overdue_total: overdue?.length ?? 0,
        eligible_for_reminder: ids.length,
        email_sent: true,
        recipient: settings.reminder_email,
        threshold_hours: settings.threshold_hours,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error(`[${requestId}] outreach-sla-monitor error:`, err);
    return new Response(
      JSON.stringify({ ok: false, error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
