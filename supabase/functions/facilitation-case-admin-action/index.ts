/**
 * facilitation-case-admin-action — Phase 1 admin/requester triage actions.
 *
 * Supported actions:
 *   - assign                      (admin only)        — set/clear case_owner_id
 *   - status_change               (admin or requester w/ allowed transition)
 *   - note                        (any party with case visibility)
 *   - request_more_information    (admin only)        — Batch 4
 *   - submit_more_information     (requester only)    — Batch 4
 *
 * No outreach, no SLA, no email, no POI/WaD/match/token mutation.
 * Notifications: in-app `notifications` rows only.
 */
import { createClient } from "npm:@supabase/supabase-js@2.39.3";
import { z } from "npm:zod@3.23.8";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import {
  INTERNAL_STATUSES,
  OUTCOMES,
  isTransitionAllowed,
  type FacilitationInternalStatus,
} from "../_shared/facilitation-case-state.ts";

const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(req: Request, body: unknown, status = 200) {
  return withCors(req, new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }));
}

const StatusSchema = z.enum(INTERNAL_STATUSES as unknown as [string, ...string[]]);
const OutcomeSchema = z.enum(OUTCOMES as unknown as [string, ...string[]]);

const RegistryResult = z.enum(["clear","possible_match","no_match","unavailable","failed"]);
const Confidence    = z.enum(["high","medium","low","unknown"]);
const SanctionsResult   = z.enum(["clear","possible_match","confirmed_match","unavailable","failed"]);
const RiskLevel         = z.enum(["low","medium","high","critical","unknown"]);
const ComplianceDecision = z.enum(["no_issue","review_required","blocked","cleared_after_review"]);
const ContactChannel = z.enum(["phone","email_outside_system","meeting","other"]);
const ContactResult  = z.enum(["no_answer","left_message","reached_counterparty","wrong_contact","declined","requested_more_information","other"]);
const optStr = (max: number) => z.string().trim().max(max).nullable().optional();

const BodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("assign"),
    case_id: z.string().uuid(),
    owner_user_id: z.string().uuid().nullable(),
  }),
  z.object({
    action: z.literal("status_change"),
    case_id: z.string().uuid(),
    to_status: StatusSchema,
    closing_reason: z.string().trim().min(3).max(2000).nullable().optional(),
    final_outcome: OutcomeSchema.nullable().optional(),
    linked_organization_id: z.string().uuid().nullable().optional(),
  }),
  z.object({
    action: z.literal("note"),
    case_id: z.string().uuid(),
    body: z.string().trim().min(2).max(4000),
  }),
  z.object({
    action: z.literal("request_more_information"),
    case_id: z.string().uuid(),
    message: z.string().trim().min(5).max(2000),
    items: z.array(z.string().trim().min(1).max(200)).min(1).max(20),
    due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
  z.object({
    action: z.literal("submit_more_information"),
    case_id: z.string().uuid(),
    response_message: z.string().trim().min(2).max(4000),
    evidence_summary: z.string().trim().max(2000).nullable().optional(),
  }),
  z.object({
    action: z.literal("record_registry_check"),
    case_id: z.string().uuid(),
    provider_name: z.string().trim().min(1).max(200),
    lookup_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    result: RegistryResult,
    confidence: Confidence,
    source_reference: optStr(500),
    note: optStr(4000),
    evidence_summary: optStr(2000),
  }),
  z.object({
    action: z.literal("record_sanctions_check"),
    case_id: z.string().uuid(),
    screening_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    result: SanctionsResult,
    screening_source: z.string().trim().min(1).max(200),
    matched_name: optStr(300),
    risk_level: RiskLevel,
    compliance_decision: ComplianceDecision,
    note: optStr(4000),
    evidence_summary: optStr(2000),
  }),
  z.object({
    action: z.literal("record_contact_attempt"),
    case_id: z.string().uuid(),
    channel: ContactChannel,
    contact_at: z.string().datetime(),
    recipient: optStr(200),
    contact_details_used: optStr(300),
    result: ContactResult,
    note: optStr(4000),
    next_action_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    evidence_summary: optStr(2000),
    advance_status: z.enum(["contact_attempted","counterparty_responded"]).nullable().optional(),
  }),
  z.object({
    action: z.literal("link_organisation"),
    case_id: z.string().uuid(),
    organization_id: z.string().uuid(),
    reason: z.string().trim().min(3).max(2000),
    evidence_summary: optStr(2000),
  }),
  z.object({
    action: z.literal("record_profile_created"),
    case_id: z.string().uuid(),
    organization_id: z.string().uuid().nullable().optional(),
    profile_reference: optStr(500),
    note: z.string().trim().min(3).max(4000),
    evidence_summary: optStr(2000),
  }),
  z.object({
    action: z.literal("mark_ready_for_poi"),
    case_id: z.string().uuid(),
    authority_summary: z.string().trim().min(3).max(4000),
  }),
  z.object({
    action: z.literal("record_poi_conversion"),
    case_id: z.string().uuid(),
    poi_reference: z.string().trim().min(3).max(500),
    reason: z.string().trim().min(3).max(2000),
    evidence_summary: optStr(2000),
  }),
]);

Deno.serve(async (req) => {
  const pf = handleCorsPreflight(req);
  if (pf) return pf;
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json(req, { error: "Unauthorized" }, 401);

  const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const token = authHeader.replace("Bearer ", "");
  const { data: claims, error: cerr } = await userClient.auth.getClaims(token);
  if (cerr || !claims?.claims?.sub) return json(req, { error: "Unauthorized" }, 401);
  const userId = claims.claims.sub as string;

  let parsed;
  try { parsed = BodySchema.safeParse(await req.json()); } catch { return json(req, { error: "Invalid JSON" }, 400); }
  if (!parsed.success) return json(req, { error: "Validation failed", details: parsed.error.flatten() }, 400);

  const admin = createClient(url, service, { auth: { persistSession: false } });

  async function hasRole(role: string): Promise<boolean> {
    const { data } = await admin.rpc("has_role", { _user_id: userId, _role: role });
    return !!data;
  }
  const isPlatformAdmin = await hasRole("platform_admin");
  const isComplianceAnalyst = await hasRole("compliance_analyst");
  const isAdmin = isPlatformAdmin || (await hasRole("admin")) || isComplianceAnalyst;

  const caseId = parsed.data.case_id;
  const { data: kase, error: kerr } = await admin.from("facilitation_cases").select("*").eq("id", caseId).maybeSingle();
  if (kerr) return json(req, { error: kerr.message }, 500);
  if (!kase) return json(req, { error: "Not found" }, 404);

  const { data: profile } = await admin.from("profiles").select("org_id").eq("id", userId).maybeSingle();
  const isRequesterUser = kase.requesting_user_id === userId;
  const isSameRequestingOrg = profile?.org_id === kase.requesting_org_id;
  const isOwner = kase.case_owner_id === userId;
  if (!(isAdmin || isSameRequestingOrg || isOwner)) return json(req, { error: "Forbidden" }, 403);

  // Helper: insert in-app notification row (RLS bypassed via service role).
  async function notifyUser(opts: { user_id: string; title: string; body: string }) {
    try {
      await admin.from("notifications").insert({
        user_id: opts.user_id,
        type: "facilitation_case",
        title: opts.title,
        body: opts.body,
        link: `/facilitation/cases/${caseId}`,
        entity_type: "facilitation_case",
        entity_id: caseId,
      });
    } catch (_e) { /* non-fatal */ }
  }

  if (parsed.data.action === "assign") {
    if (!isAdmin) return json(req, { error: "Only admins can assign cases" }, 403);
    const { error: uerr } = await admin.from("facilitation_cases")
      .update({ case_owner_id: parsed.data.owner_user_id }).eq("id", caseId);
    if (uerr) return json(req, { error: uerr.message }, 500);
    await admin.from("facilitation_case_events").insert({
      case_id: caseId, actor_user_id: userId,
      action: "facilitation_case.assigned",
      from_status: kase.internal_status, to_status: kase.internal_status,
      payload: { owner_user_id: parsed.data.owner_user_id },
    });
    return json(req, { ok: true });
  }

  if (parsed.data.action === "status_change") {
    const role = isAdmin ? "admin" : "requester";
    const from = kase.internal_status as FacilitationInternalStatus;
    if (!isTransitionAllowed(from, parsed.data.to_status as FacilitationInternalStatus, role)) {
      return json(req, { error: "Transition not allowed", from, to: parsed.data.to_status, role }, 409);
    }
    const patch: Record<string, unknown> = { internal_status: parsed.data.to_status };
    if (parsed.data.closing_reason !== undefined) patch.closing_reason = parsed.data.closing_reason;
    if (parsed.data.final_outcome !== undefined) patch.final_outcome = parsed.data.final_outcome;
    if (parsed.data.linked_organization_id !== undefined) patch.linked_organization_id = parsed.data.linked_organization_id;
    if (["closed", "cancelled_by_requester", "unable_to_proceed", "converted_to_known_counterparty_poi"].includes(parsed.data.to_status)) {
      patch.closed_at = new Date().toISOString();
    }
    const { error: uerr } = await admin.from("facilitation_cases").update(patch).eq("id", caseId);
    if (uerr) return json(req, { error: uerr.message }, 500);

    const action = parsed.data.to_status === "cancelled_by_requester"
      ? "facilitation_case.cancelled_by_requester"
      : parsed.data.to_status === "closed"
        ? "facilitation_case.closed"
        : "facilitation_case.status_changed";

    await admin.from("facilitation_case_events").insert({
      case_id: caseId, actor_user_id: userId,
      action,
      from_status: from, to_status: parsed.data.to_status,
      payload: {
        closing_reason: parsed.data.closing_reason ?? null,
        final_outcome: parsed.data.final_outcome ?? null,
        linked_organization_id: parsed.data.linked_organization_id ?? null,
      },
    });
    return json(req, { ok: true });
  }

  if (parsed.data.action === "note") {
    await admin.from("facilitation_case_events").insert({
      case_id: caseId, actor_user_id: userId,
      action: "facilitation_case.note_added",
      from_status: kase.internal_status, to_status: kase.internal_status,
      payload: { body: parsed.data.body, by_admin: isAdmin },
    });
    return json(req, { ok: true });
  }

  if (parsed.data.action === "request_more_information") {
    if (!(isPlatformAdmin || isOwner)) {
      return json(req, { error: "Only platform admins or the assigned case owner can request more information" }, 403);
    }
    const from = kase.internal_status as FacilitationInternalStatus;
    if (!isTransitionAllowed(from, "more_information_needed", "admin")) {
      return json(req, { error: "More information cannot be requested from the current status", from }, 409);
    }
    const nowIso = new Date().toISOString();
    const { error: uerr } = await admin.from("facilitation_cases").update({
      internal_status: "more_information_needed",
      info_request_message: parsed.data.message,
      info_request_items: parsed.data.items,
      info_request_due_date: parsed.data.due_date,
      info_request_requested_by: userId,
      info_request_requested_at: nowIso,
      // clear any prior response so a fresh round is independent
      info_request_response_message: null,
      info_request_response_at: null,
      info_request_response_evidence_summary: null,
    }).eq("id", caseId);
    if (uerr) return json(req, { error: uerr.message }, 500);

    await admin.from("facilitation_case_events").insert({
      case_id: caseId, actor_user_id: userId,
      action: "facilitation_case.more_information_requested",
      from_status: from, to_status: "more_information_needed",
      payload: {
        message: parsed.data.message,
        items: parsed.data.items,
        due_date: parsed.data.due_date,
      },
    });

    // Notify the requesting user (in-app only).
    if (kase.requesting_user_id) {
      await notifyUser({
        user_id: kase.requesting_user_id,
        title: "More information is required",
        body: "Izenzo needs more information before your facilitation request can continue. Open the request to respond.",
      });
    }
    return json(req, { ok: true });
  }

  if (parsed.data.action === "submit_more_information") {
    // Only the requester (same org) may submit. Owners/admins cannot submit on
    // behalf of a requester.
    if (!isSameRequestingOrg) {
      return json(req, { error: "Only the requester can submit more information" }, 403);
    }
    if (kase.internal_status !== "more_information_needed") {
      return json(req, { error: "No active information request for this case", current_status: kase.internal_status }, 409);
    }
    const nowIso = new Date().toISOString();

    // Block compliance/hard-block edge case: if a compliance status appeared
    // (defence in depth — current state machine routes through admin only),
    // keep the case as-is.
    const toStatus: FacilitationInternalStatus =
      isTransitionAllowed("more_information_needed", "admin_reviewing", "admin")
        ? "admin_reviewing"
        : "more_information_needed";

    const { error: uerr } = await admin.from("facilitation_cases").update({
      internal_status: toStatus,
      info_request_response_message: parsed.data.response_message,
      info_request_response_at: nowIso,
      info_request_response_evidence_summary: parsed.data.evidence_summary ?? null,
    }).eq("id", caseId);
    if (uerr) return json(req, { error: uerr.message }, 500);

    await admin.from("facilitation_case_events").insert({
      case_id: caseId, actor_user_id: userId,
      action: "facilitation_case.more_information_submitted",
      from_status: "more_information_needed", to_status: toStatus,
      payload: {
        response_message: parsed.data.response_message,
        evidence_summary: parsed.data.evidence_summary ?? null,
      },
    });

    // Notify the assigned case owner if any.
    if (kase.case_owner_id) {
      await notifyUser({
        user_id: kase.case_owner_id,
        title: "Requester has submitted more information",
        body: "A facilitation requester has provided the additional information you asked for. Open the case to review.",
      });
    }
    // Also notify platform admins so the queue is picked up even if unassigned.
    try {
      const { data: admins } = await admin
        .from("user_roles")
        .select("user_id")
        .eq("role", "platform_admin");
      for (const a of admins ?? []) {
        if (a.user_id && a.user_id !== kase.case_owner_id) {
          await notifyUser({
            user_id: a.user_id,
            title: "Requester has submitted more information",
            body: "A facilitation requester has provided additional information on a case.",
          });
        }
      }
    } catch (_e) { /* non-fatal */ }

    return json(req, { ok: true });
  }

  // ─── Batch 5 — manual check & contact-attempt capture ───────────────────
  if (parsed.data.action === "record_registry_check") {
    if (!(isPlatformAdmin || isComplianceAnalyst || isOwner)) {
      return json(req, { error: "Only platform admins, compliance analysts, or the assigned case owner can record registry checks" }, 403);
    }
    const p = parsed.data;
    const { error: ierr } = await admin.from("facilitation_case_registry_checks").insert({
      case_id: caseId,
      actor_user_id: userId,
      provider_name: p.provider_name,
      lookup_date: p.lookup_date,
      result: p.result,
      confidence: p.confidence,
      source_reference: p.source_reference ?? null,
      note: p.note ?? null,
      evidence_summary: p.evidence_summary ?? null,
    });
    if (ierr) return json(req, { error: ierr.message }, 500);
    await admin.from("facilitation_case_events").insert({
      case_id: caseId, actor_user_id: userId,
      action: "facilitation_case.registry_check_recorded",
      from_status: kase.internal_status, to_status: kase.internal_status,
      payload: {
        provider_name: p.provider_name,
        lookup_date: p.lookup_date,
        result: p.result,
        confidence: p.confidence,
        source_reference: p.source_reference ?? null,
      },
    });
    return json(req, { ok: true });
  }

  if (parsed.data.action === "record_sanctions_check") {
    const p = parsed.data;
    // Only platform_admin or compliance_analyst may record; case owner may not.
    if (!(isPlatformAdmin || isComplianceAnalyst)) {
      return json(req, { error: "Only platform admins or compliance analysts can record sanctions/PEP results" }, 403);
    }
    // Clearing a prior possible/confirmed match requires compliance_analyst.
    const { data: priorRows } = await admin
      .from("facilitation_case_sanctions_checks")
      .select("result")
      .eq("case_id", caseId)
      .order("created_at", { ascending: false })
      .limit(1);
    const priorResult = priorRows?.[0]?.result as string | undefined;
    const priorWasMatch = priorResult === "possible_match" || priorResult === "confirmed_match";
    const clearingMatch = priorWasMatch
      && (p.result === "clear" || p.result === "no_match")
      && p.compliance_decision === "cleared_after_review";
    if (clearingMatch && !isComplianceAnalyst) {
      return json(req, { error: "Only a compliance analyst can clear a prior possible or confirmed match" }, 403);
    }
    const { error: ierr } = await admin.from("facilitation_case_sanctions_checks").insert({
      case_id: caseId,
      actor_user_id: userId,
      screening_date: p.screening_date,
      result: p.result,
      screening_source: p.screening_source,
      matched_name: p.matched_name ?? null,
      risk_level: p.risk_level,
      compliance_decision: p.compliance_decision,
      note: p.note ?? null,
      evidence_summary: p.evidence_summary ?? null,
    });
    if (ierr) return json(req, { error: ierr.message }, 500);

    // Hard-block routing — confirmed match preserves/creates a compliance block.
    // Possible match requires compliance review before any outreach/conversion.
    const from = kase.internal_status as FacilitationInternalStatus;
    let nextStatus: FacilitationInternalStatus | null = null;
    if (p.result === "confirmed_match" || p.compliance_decision === "blocked") {
      if (isTransitionAllowed(from, "blocked_by_compliance", "admin")) nextStatus = "blocked_by_compliance";
      else if (isTransitionAllowed(from, "compliance_review_required", "admin")) nextStatus = "compliance_review_required";
    } else if (p.result === "possible_match" || p.compliance_decision === "review_required") {
      if (isTransitionAllowed(from, "compliance_review_required", "admin")) nextStatus = "compliance_review_required";
    }
    if (nextStatus) {
      await admin.from("facilitation_cases").update({ internal_status: nextStatus }).eq("id", caseId);
    }

    await admin.from("facilitation_case_events").insert({
      case_id: caseId, actor_user_id: userId,
      action: "facilitation_case.sanctions_pep_recorded",
      from_status: from, to_status: nextStatus ?? from,
      payload: {
        screening_date: p.screening_date,
        result: p.result,
        screening_source: p.screening_source,
        risk_level: p.risk_level,
        compliance_decision: p.compliance_decision,
        matched_name: p.matched_name ?? null,
      },
    });
    return json(req, { ok: true, new_status: nextStatus ?? from });
  }

  if (parsed.data.action === "record_contact_attempt") {
    if (!(isPlatformAdmin || isOwner || isComplianceAnalyst)) {
      return json(req, { error: "Only platform admins, compliance analysts, or the assigned case owner can record contact attempts" }, 403);
    }
    const p = parsed.data;
    const { error: ierr } = await admin.from("facilitation_case_contact_attempts").insert({
      case_id: caseId,
      actor_user_id: userId,
      channel: p.channel,
      contact_at: p.contact_at,
      recipient: p.recipient ?? null,
      contact_details_used: p.contact_details_used ?? null,
      result: p.result,
      note: p.note ?? null,
      next_action_date: p.next_action_date ?? null,
      evidence_summary: p.evidence_summary ?? null,
    });
    if (ierr) return json(req, { error: ierr.message }, 500);

    // Optional state transition — only when the operator explicitly requests it
    // and the normal transition rules allow it.
    const from = kase.internal_status as FacilitationInternalStatus;
    let nextStatus: FacilitationInternalStatus | null = null;
    if (p.advance_status && isTransitionAllowed(from, p.advance_status as FacilitationInternalStatus, "admin")) {
      nextStatus = p.advance_status as FacilitationInternalStatus;
      await admin.from("facilitation_cases").update({ internal_status: nextStatus }).eq("id", caseId);
    }

    await admin.from("facilitation_case_events").insert({
      case_id: caseId, actor_user_id: userId,
      action: "facilitation_case.contact_attempt_recorded",
      from_status: from, to_status: nextStatus ?? from,
      payload: {
        channel: p.channel,
        result: p.result,
        contact_at: p.contact_at,
        next_action_date: p.next_action_date ?? null,
      },
    });
    return json(req, { ok: true, new_status: nextStatus ?? from });
  }

  return json(req, { error: "Unsupported action" }, 400);
});
