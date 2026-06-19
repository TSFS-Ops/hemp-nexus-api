/**
 * facilitation-invite-unopened-detector — Facilitation Batch 11
 *
 * Internal-only detector. Identifies facilitation outreach invites that
 * have been sent at least 3 business days ago, have not been observed as
 * opened/replied, whose parent case is non-terminal, and which have neither
 * an existing equivalent detector flag nor an active SLA-reminder covering
 * the same case.
 *
 * STRICT BOUNDARIES (Batch 11 contract):
 *   - Default DRY-RUN. Live inserts require explicit `live: true` plus a
 *     valid INTERNAL_CRON_KEY.
 *   - Never sends email / Slack / WhatsApp / SMS / webhooks.
 *   - Never mutates POI / WaD / match / token / credit / payment / refund
 *     / fund-flow / deal terms / trade order / collapse ledger /
 *     facilitation_cases.status / facilitation SLA dates.
 *   - Never writes a requester-facing notification.
 *   - Idempotent: re-running cannot duplicate next-step rows.
 *   - Audit row written ONLY when a live flag is created.
 *
 * Gating:
 *   Authorization: Bearer ${INTERNAL_CRON_KEY}   (header)
 *   or  body.internal_cron_key === INTERNAL_CRON_KEY
 *
 * Body (all fields optional):
 *   {
 *     "live": false,                 // default false → dry-run only
 *     "max_sends": 500,              // safety cap on scan size
 *     "internal_cron_key": "..."     // alternative to Authorization header
 *   }
 */
import { createClient } from "npm:@supabase/supabase-js@2.39.3";
import { corsHeaders as baseCors } from "npm:@supabase/supabase-js@2/cors";
import {
  decideFlag,
  buildNextStepRow,
  INVITE_UNOPENED_NEXT_STEP_KIND,
  INVITE_UNOPENED_AUDIT_NAME,
  INVITE_UNOPENED_BUSINESS_DAYS_THRESHOLD,
  SLA_REMINDER_COVERING_REASONS,
  type DetectorSendInput,
} from "../_shared/facilitation-invite-unopened.ts";
import { TERMINAL_STATUSES } from "../_shared/facilitation-case-state.ts";
import { handleHealthProbe } from "../_shared/health.ts";

const corsHeaders = {
  ...baseCors,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function gateInternalCronKey(req: Request, bodyKey: unknown): boolean {
  const expected = Deno.env.get("INTERNAL_CRON_KEY") ?? "";
  if (!expected) return false;
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.toLowerCase().startsWith("bearer ")
    ? auth.slice(7).trim()
    : "";
  if (bearer && bearer === expected) return true;
  if (typeof bodyKey === "string" && bodyKey === expected) return true;
  return false;
}

const TERMINAL_SET: ReadonlySet<string> = TERMINAL_STATUSES as unknown as ReadonlySet<string>;

Deno.serve(async (req) => {
  { const __hp = handleHealthProbe(req, "facilitation-invite-unopened-detector"); if (__hp) return __hp; }
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { body = {}; }

  if (!gateInternalCronKey(req, body.internal_cron_key)) {
    return json({ error: "Unauthorized" }, 401);
  }

  // DRY-RUN BY DEFAULT — Batch 11 contract requires explicit opt-in.
  const live = body.live === true;
  const maxSends = Math.min(
    Math.max(1, typeof body.max_sends === "number" ? body.max_sends : 500),
    2000,
  );

  const url = Deno.env.get("SUPABASE_URL")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(url, service, { auth: { persistSession: false } });

  const now = new Date();

  // Pull recent outreach sends within a reasonable window (last 60 days).
  const SCAN_WINDOW_DAYS = 60;
  const sinceISO = new Date(now.getTime() - SCAN_WINDOW_DAYS * 86_400_000).toISOString();
  const { data: sends, error: sendsErr } = await sb
    .from("facilitation_outreach_sends")
    .select("id,candidate_id,sent_at,status")
    .gte("sent_at", sinceISO)
    .order("sent_at", { ascending: true })
    .limit(maxSends);
  if (sendsErr) return json({ error: "scan_failed", detail: sendsErr.message }, 500);

  const scanned = sends?.length ?? 0;
  if (scanned === 0) {
    return json({
      dry_run: !live,
      scanned: 0, eligible: 0, would_create: 0, created: 0,
      skipped_terminal: 0, skipped_already_flagged: 0,
      skipped_sla_reminder_covered: 0, skipped_engaged: 0,
      skipped_delivery_failed: 0, skipped_too_recent: 0, skipped_never_sent: 0,
      details: [],
    }, 200);
  }

  // Resolve case_id for each candidate.
  const candidateIds = Array.from(new Set((sends ?? []).map((s) => s.candidate_id).filter(Boolean)));
  const { data: candidates, error: candErr } = await sb
    .from("facilitation_outreach_candidates")
    .select("id,case_id")
    .in("id", candidateIds);
  if (candErr) return json({ error: "scan_failed", detail: candErr.message }, 500);
  const candidateToCase = new Map<string, string>();
  for (const c of candidates ?? []) candidateToCase.set(c.id, c.case_id);

  const caseIds = Array.from(new Set([...candidateToCase.values()]));

  // Fetch case statuses.
  const caseStatus = new Map<string, string>();
  if (caseIds.length) {
    const { data: cases } = await sb
      .from("facilitation_cases")
      .select("id,internal_status")
      .in("id", caseIds);
    for (const c of cases ?? []) caseStatus.set(c.id, c.internal_status);
  }

  // Existing detector next-step rows for these cases.
  const alreadyFlaggedSendIds = new Set<string>();
  if (caseIds.length) {
    const { data: existing } = await sb
      .from("facilitation_case_next_steps")
      .select("case_id,required_actions,next_step_type")
      .in("case_id", caseIds)
      .eq("next_step_type", INVITE_UNOPENED_NEXT_STEP_KIND);
    for (const row of existing ?? []) {
      const ra = (row as { required_actions?: unknown }).required_actions;
      if (ra && typeof ra === "object" && !Array.isArray(ra)) {
        const sid = (ra as Record<string, unknown>).outreach_send_id;
        if (typeof sid === "string") alreadyFlaggedSendIds.add(sid);
      }
    }
  }

  // Cases with active SLA reminders covering outreach overdue.
  const slaCoveredCaseIds = new Set<string>();
  if (caseIds.length) {
    const { data: reminders } = await sb
      .from("facilitation_case_sla_reminders")
      .select("case_id,reason_code,sent_at")
      .in("case_id", caseIds);
    for (const r of reminders ?? []) {
      if (SLA_REMINDER_COVERING_REASONS.has(r.reason_code)) {
        slaCoveredCaseIds.add(r.case_id);
      }
    }
  }

  const counts = {
    scanned, eligible: 0, would_create: 0, created: 0,
    skipped_terminal: 0, skipped_already_flagged: 0,
    skipped_sla_reminder_covered: 0, skipped_engaged: 0,
    skipped_delivery_failed: 0, skipped_too_recent: 0, skipped_never_sent: 0,
  };
  const details: Array<Record<string, unknown>> = [];

  for (const s of sends ?? []) {
    const case_id = candidateToCase.get(s.candidate_id);
    if (!case_id) { counts.skipped_terminal++; continue; }
    const input: DetectorSendInput = {
      send_id: s.id,
      case_id,
      sent_at: s.sent_at,
      send_status: s.status,
      case_internal_status: caseStatus.get(case_id) ?? "closed",
      already_flagged: alreadyFlaggedSendIds.has(s.id),
      sla_reminder_covered: slaCoveredCaseIds.has(case_id),
    };
    const decision = decideFlag(input, now, TERMINAL_SET);
    if (decision.action === "flag") {
      counts.eligible++;
      counts.would_create++;
      if (!live) {
        details.push({ send_id: s.id, case_id, action: "would_flag", business_days: decision.business_days });
        continue;
      }
      // Live path — protected. Build row + insert with idempotency guard.
      const row = buildNextStepRow({
        case_id, send_id: s.id, sent_at: s.sent_at!,
        business_days: decision.business_days,
        detector_user_id: "00000000-0000-0000-0000-000000000000",
      });
      const { data: inserted, error: insErr } = await sb
        .from("facilitation_case_next_steps")
        .insert(row)
        .select("id")
        .single();
      if (insErr) {
        details.push({ send_id: s.id, case_id, action: "insert_failed", error: insErr.message });
        continue;
      }
      counts.created++;
      // Audit row — ONLY for live-created flags.
      await sb.from("audit_logs").insert({
        action: INVITE_UNOPENED_AUDIT_NAME,
        entity_type: "facilitation_case",
        entity_id: case_id,
        metadata: {
          source: "facilitation-invite-unopened-detector",
          outreach_send_id: s.id,
          next_step_id: inserted?.id,
          business_days_at_flag: decision.business_days,
          sent_at: s.sent_at,
        },
      });
      details.push({ send_id: s.id, case_id, action: "flagged", next_step_id: inserted?.id, business_days: decision.business_days });
    } else {
      switch (decision.reason) {
        case "terminal_case": counts.skipped_terminal++; break;
        case "already_flagged": counts.skipped_already_flagged++; break;
        case "sla_reminder_covered": counts.skipped_sla_reminder_covered++; break;
        case "engaged": counts.skipped_engaged++; break;
        case "delivery_failed": counts.skipped_delivery_failed++; break;
        case "too_recent": counts.skipped_too_recent++; break;
        case "never_sent": counts.skipped_never_sent++; break;
      }
    }
  }

  return json({
    dry_run: !live,
    threshold_business_days: INVITE_UNOPENED_BUSINESS_DAYS_THRESHOLD,
    ...counts,
    details,
  }, 200);
});
