/**
 * facilitation-case-sla-evaluate — Batch 7
 *
 * Computes and persists SLA state for a single facilitation case, then sends
 * in-app reminder notifications for any new overdue conditions (deduped via
 * facilitation_case_sla_reminders).
 *
 * Pure, non-destructive:
 *   - Never closes a case.
 *   - Never advances status.
 *   - Never creates/converts a POI.
 *   - Never sends outreach to the counterparty.
 *   - Never mutates payment/token/WaD/match/credit.
 *
 * Callable by:
 *   - platform_admin / compliance_analyst (manual "Refresh SLA")
 *   - get-facilitation-case (server-side, on admin reads — idempotent)
 *
 * Body: { case_id: uuid, internal?: boolean }
 *   When internal=true and caller carries the service-role key (set by
 *   get-facilitation-case via the X-Internal-Caller header), the role check
 *   is skipped — used for read-time evaluation only.
 */
import { createClient } from "npm:@supabase/supabase-js@2.39.3";
import { z } from "npm:zod@3.23.8";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import {
  computeSla,
  OVERDUE_REASON_LABELS,
  type OverdueReasonCode,
  type SlaInputs,
} from "../_shared/facilitation-sla.ts";

const corsHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-internal-caller",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(req: Request, body: unknown, status = 200) {
  return withCors(
    req,
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }),
  );
}

const BodySchema = z.object({
  case_id: z.string().uuid(),
  internal: z.boolean().nullable().optional(),
});

const NOTIFICATION_TITLES: Record<OverdueReasonCode, string> = {
  owner_assignment_overdue: "Facilitation case is unassigned past SLA",
  initial_triage_overdue: "Facilitation case triage is overdue",
  more_information_response_overdue:
    "Facilitation case is waiting on the requester",
  first_outreach_overdue: "First outreach is overdue",
  follow_up_outreach_overdue: "Follow-up outreach is overdue",
  compliance_review_overdue: "Compliance review is overdue",
  next_action_overdue: "A scheduled next action is overdue",
  stale_no_activity: "Facilitation case has had no activity",
};

Deno.serve(async (req) => {
  const pf = handleCorsPreflight(req);
  if (pf) return pf;
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  let parsed;
  try {
    parsed = BodySchema.safeParse(await req.json());
  } catch {
    return json(req, { error: "Invalid JSON" }, 400);
  }
  if (!parsed.success) return json(req, { error: "Validation failed" }, 400);

  const internalCaller = req.headers.get("x-internal-caller") === "facilitation-read";
  const authHeader = req.headers.get("Authorization");

  const admin = createClient(url, service, { auth: { persistSession: false } });

  let userId: string | null = null;
  if (!parsed.data.internal || !internalCaller) {
    if (!authHeader?.startsWith("Bearer ")) {
      return json(req, { error: "Unauthorized" }, 401);
    }
    const userClient = createClient(url, anon, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: claims, error: cerr } = await userClient.auth.getClaims(token);
    if (cerr || !claims?.claims?.sub) return json(req, { error: "Unauthorized" }, 401);
    userId = claims.claims.sub as string;

    const [{ data: isAdmin }, { data: isCompliance }] = await Promise.all([
      admin.rpc("has_role", { _user_id: userId, _role: "platform_admin" }),
      admin.rpc("has_role", { _user_id: userId, _role: "compliance_analyst" }),
    ]);
    if (!isAdmin && !isCompliance) return json(req, { error: "Forbidden" }, 403);
  }

  const caseId = parsed.data.case_id;
  const { data: kase, error: kerr } = await admin
    .from("facilitation_cases")
    .select("*")
    .eq("id", caseId)
    .maybeSingle();
  if (kerr) return json(req, { error: kerr.message }, 500);
  if (!kase) return json(req, { error: "Not found" }, 404);

  // ── Build SlaInputs ──────────────────────────────────────────────────
  const { data: rfcEvents } = await admin
    .from("facilitation_case_events")
    .select("created_at,to_status")
    .eq("case_id", caseId)
    .eq("to_status", "ready_for_contact")
    .order("created_at", { ascending: false })
    .limit(1);

  const { data: crrEvents } = await admin
    .from("facilitation_case_events")
    .select("created_at,to_status")
    .eq("case_id", caseId)
    .eq("to_status", "compliance_review_required")
    .order("created_at", { ascending: false })
    .limit(1);

  const { data: contactAttempts } = await admin
    .from("facilitation_case_contact_attempts")
    .select("contact_at,next_action_date,created_at")
    .eq("case_id", caseId)
    .order("contact_at", { ascending: true });

  const firstContact = contactAttempts?.[0]?.contact_at as string | undefined;
  const lastContact = contactAttempts?.[contactAttempts.length - 1]
    ?.contact_at as string | undefined;
  const lastNextAction = contactAttempts
    ?.map((c) => c.next_action_date as string | null)
    .filter((d): d is string => !!d)
    .sort()
    .at(-1) ?? null;

  // Last meaningful activity = max(latest event, latest contact attempt, kase.updated_at).
  // Exclude SLA/system-internal events so the evaluator's own audit writes do not
  // reset the stale/no-activity clock.
  const SYSTEM_INTERNAL_EVENT_ACTIONS = [
    "facilitation_case.sla_evaluated",
    "facilitation_case.reminder_sent",
    "facilitation_case.overdue_marked",
    "facilitation_case.overdue_cleared",
  ];
  const { data: lastEvent } = await admin
    .from("facilitation_case_events")
    .select("created_at")
    .eq("case_id", caseId)
    .not("action", "in", `(${SYSTEM_INTERNAL_EVENT_ACTIONS.map((a) => `"${a}"`).join(",")})`)
    .order("created_at", { ascending: false })
    .limit(1);

  const candidates: string[] = [];
  if (lastEvent?.[0]?.created_at) candidates.push(lastEvent[0].created_at as string);
  if (lastContact) candidates.push(lastContact);
  if ((kase as { updated_at?: string }).updated_at) {
    candidates.push((kase as { updated_at: string }).updated_at);
  }
  const lastActivityAt = candidates.sort().at(-1) ?? (kase as { created_at: string }).created_at;

  const slaInputs: SlaInputs = {
    created_at: (kase as { created_at: string }).created_at,
    internal_status: (kase as { internal_status: string }).internal_status,
    case_owner_id: (kase as { case_owner_id: string | null }).case_owner_id,
    closed_at: (kase as { closed_at: string | null }).closed_at,
    info_request_requested_at:
      (kase as { info_request_requested_at: string | null }).info_request_requested_at,
    info_request_response_at:
      (kase as { info_request_response_at: string | null }).info_request_response_at,
    ready_for_contact_at: (rfcEvents?.[0]?.created_at as string | undefined) ?? null,
    compliance_review_started_at:
      (crrEvents?.[0]?.created_at as string | undefined) ?? null,
    first_contact_attempt_at: firstContact ?? null,
    latest_contact_attempt_at: lastContact ?? null,
    latest_next_action_date: lastNextAction,
    last_activity_at: lastActivityAt,
  };

  const out = computeSla(slaInputs);

  // ── Persist computed SLA fields ──────────────────────────────────────
  const prevOverdue = !!(kase as { is_overdue?: boolean }).is_overdue;
  const prevReasons =
    ((kase as { overdue_reasons?: string[] }).overdue_reasons ?? []) as OverdueReasonCode[];
  const nowIso = new Date().toISOString();

  const { error: uerr } = await admin
    .from("facilitation_cases")
    .update({
      owner_assignment_due_at: out.owner_assignment_due_at,
      initial_triage_due_at: out.initial_triage_due_at,
      more_info_response_due_at: out.more_info_response_due_at,
      first_outreach_due_at: out.first_outreach_due_at,
      follow_up_outreach_due_at: out.follow_up_outreach_due_at,
      compliance_review_due_at: out.compliance_review_due_at,
      next_action_due_at: out.next_action_due_at,
      is_overdue: out.is_overdue,
      overdue_reasons: out.overdue_reasons,
      sla_last_evaluated_at: nowIso,
      last_activity_at: out.last_activity_at,
    })
    .eq("id", caseId);
  if (uerr) return json(req, { error: uerr.message }, 500);

  // sla_evaluated audit on every run (cheap, useful for "Refresh SLA" trace).
  await admin.from("facilitation_case_events").insert({
    case_id: caseId,
    actor_user_id: userId,
    action: "facilitation_case.sla_evaluated",
    from_status: (kase as { internal_status: string }).internal_status,
    to_status: (kase as { internal_status: string }).internal_status,
    payload: {
      reasons: out.overdue_reasons,
      is_overdue: out.is_overdue,
      triggered_by: internalCaller ? "read" : "manual",
    },
  });

  // overdue_marked / overdue_cleared transitions.
  if (out.is_overdue && !prevOverdue) {
    await admin.from("facilitation_case_events").insert({
      case_id: caseId,
      actor_user_id: userId,
      action: "facilitation_case.overdue_marked",
      from_status: (kase as { internal_status: string }).internal_status,
      to_status: (kase as { internal_status: string }).internal_status,
      payload: { reasons: out.overdue_reasons },
    });
  } else if (!out.is_overdue && prevOverdue) {
    await admin.from("facilitation_case_events").insert({
      case_id: caseId,
      actor_user_id: userId,
      action: "facilitation_case.overdue_cleared",
      from_status: (kase as { internal_status: string }).internal_status,
      to_status: (kase as { internal_status: string }).internal_status,
      payload: { previous_reasons: prevReasons },
    });
    // Clear dedupe rows so future overdue conditions can refire.
    await admin
      .from("facilitation_case_sla_reminders")
      .delete()
      .eq("case_id", caseId);
  }

  // ── In-app reminders — admin/owner targets; dedupe via unique constraint ─
  // Targets: case owner (if any) + all platform_admins (cap to keep noise low).
  // For "more_information_response_overdue" target the requesting user too.
  const targets = new Set<string>();
  const ownerId = (kase as { case_owner_id: string | null }).case_owner_id;
  if (ownerId) targets.add(ownerId);

  const { data: admins } = await admin
    .from("user_roles")
    .select("user_id")
    .eq("role", "platform_admin");
  for (const a of admins ?? []) {
    if (a.user_id) targets.add(a.user_id as string);
  }

  const requesterId = (kase as { requesting_user_id: string | null }).requesting_user_id;

  let remindersSent = 0;
  for (const reason of out.overdue_reasons) {
    const reasonTargets = new Set(targets);
    if (reason === "more_information_response_overdue") {
      // Safe wording only — requester sees the same plain reminder.
      if (requesterId) reasonTargets.add(requesterId);
    }
    if (reason === "compliance_review_overdue") {
      const { data: compliance } = await admin
        .from("user_roles")
        .select("user_id")
        .eq("role", "compliance_analyst");
      for (const c of compliance ?? []) {
        if (c.user_id) reasonTargets.add(c.user_id as string);
      }
    }

    for (const uid of reasonTargets) {
      // Dedupe — insert into ledger first; if conflict, skip notification.
      const { error: dedupeErr } = await admin
        .from("facilitation_case_sla_reminders")
        .insert({ case_id: caseId, reason_code: reason, sent_to_user_id: uid });
      if (dedupeErr) continue; // unique-violation = already sent.

      // For non-admin requester, only show safe wording for the "more info" case.
      const isRequester = uid === requesterId;
      const isMoreInfoReason = reason === "more_information_response_overdue";
      if (isRequester && !isMoreInfoReason) continue;

      await admin.from("notifications").insert({
        user_id: uid,
        type: "facilitation_case_sla",
        title: isRequester
          ? "Reminder: Izenzo is waiting for your information"
          : NOTIFICATION_TITLES[reason],
        body: isRequester
          ? "Izenzo is still waiting on the information you were asked to provide. Open the request to respond."
          : OVERDUE_REASON_LABELS[reason],
        link: `/hq/facilitation`,
        entity_type: "facilitation_case",
        entity_id: caseId,
      });

      await admin.from("facilitation_case_events").insert({
        case_id: caseId,
        actor_user_id: null,
        action: "facilitation_case.reminder_sent",
        from_status: (kase as { internal_status: string }).internal_status,
        to_status: (kase as { internal_status: string }).internal_status,
        payload: { reason_code: reason, target_role: isRequester ? "requester" : "admin_or_owner" },
      });
      remindersSent += 1;
    }
  }

  return json(req, {
    ok: true,
    sla: {
      ...out,
      sla_last_evaluated_at: nowIso,
    },
    reminders_sent: remindersSent,
  });
});
