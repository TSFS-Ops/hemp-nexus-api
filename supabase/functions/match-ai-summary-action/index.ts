/**
 * match-ai-summary-action
 * ──────────────────────────────────────────────────────────────────────
 * Phase 4 — Originator-visible approved AI summary actions.
 *
 * External/originator users may take EXACTLY one of three lightweight,
 * non-stateful actions on an approved AI summary surfaced on their Match
 * page. Every action:
 *
 *   • creates an internal admin task (`ai_intel_tasks`) for Izenzo Ops
 *     to action — never the user;
 *   • writes a canonical `ai_review.*` audit event;
 *   • DOES NOT change AI approval state, POI state, match state, outreach
 *     state, verification state, or anything user-visible beyond a small
 *     "thanks, we have it" confirmation.
 *
 * Supported actions:
 *   - flag_incorrect            (note required)
 *   - request_more_intel        (note optional)
 *   - ask_izenzo_to_proceed     (note optional)
 *
 * Access gate:
 *   - caller must be authenticated;
 *   - caller's org must equal one of matches.org_id / buyer_org_id /
 *     seller_org_id  (platform admins also allowed);
 *   - the proposed match must currently satisfy the Phase 4 visibility
 *     gates: client_visible = true AND status = 'approved_client_view' AND
 *     approved_payload IS NOT NULL.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import { authenticateRequest } from "../_shared/auth.ts";
import { writeAdminAudit, extractIp, extractUserAgent } from "../_shared/admin-audit.ts";
import { AI_REVIEW_AUDIT_NAMES } from "../_shared/ai-review-audit.ts";

const ACTIONS = ["flag_incorrect", "request_more_intel", "ask_izenzo_to_proceed"] as const;
type Action = (typeof ACTIONS)[number];

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const AUDIT_BY_ACTION: Record<Action, string> = {
  flag_incorrect: "ai_review.client_summary_flagged_incorrect",
  request_more_intel: "ai_review.client_summary_requested_more_intel",
  ask_izenzo_to_proceed: "ai_review.client_summary_asked_to_proceed",
};

const TASK_KIND_BY_ACTION: Record<Action, string> = {
  flag_incorrect: "review_ai_result",
  request_more_intel: "widen_search_criteria",
  ask_izenzo_to_proceed: "notify_originator",
};

serve(async (req) => {
  const pre = handleCorsPreflight(req);
  if (pre) return pre;
  return withCors(req, await _handle(req));
});

async function _handle(req: Request): Promise<Response> {
  const requestId = crypto.randomUUID();
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);

  let userId: string | null = null;
  let action: Action | null = null;
  let matchId: string | null = null;

  try {
    const ctx = await authenticateRequest(req, supabaseUrl, serviceKey);
    userId = ctx.userId;

    const body = await req.json().catch(() => ({}));
    matchId = typeof body?.match_id === "string" ? body.match_id : null;
    action = ACTIONS.includes(body?.action) ? (body.action as Action) : null;
    const note: string | null = typeof body?.note === "string" ? body.note.trim() : null;

    if (!matchId) return json(400, { error: "match_id is required" });
    if (!action) return json(400, { error: `action must be one of: ${ACTIONS.join(", ")}` });
    if (action === "flag_incorrect" && (!note || note.length < 3)) {
      return json(400, { error: "note is required for flag_incorrect" });
    }
    if (note && note.length > 2000) {
      return json(400, { error: "note must be 2000 chars or fewer" });
    }

    // Resolve match + access gate.
    const { data: match, error: mErr } = await admin
      .from("matches")
      .select("id, org_id, buyer_org_id, seller_org_id, trade_request_id")
      .eq("id", matchId)
      .maybeSingle();
    if (mErr) throw mErr;
    if (!match) return json(404, { error: "match not found" });

    // Caller's org.
    const { data: profile } = await admin
      .from("profiles")
      .select("org_id")
      .eq("id", userId)
      .maybeSingle();
    const callerOrg: string | null = (profile as { org_id?: string } | null)?.org_id ?? null;

    // Platform admin?
    const { data: roleRow } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .in("role", ["platform_admin", "admin"]);
    const isAdmin = Array.isArray(roleRow) && roleRow.length > 0;

    const allowed =
      isAdmin ||
      (callerOrg != null &&
        (callerOrg === (match as any).org_id ||
          callerOrg === (match as any).buyer_org_id ||
          callerOrg === (match as any).seller_org_id));
    if (!allowed) return json(403, { error: "forbidden" });

    // Resolve the live client-visible approved AI row (Phase 4 gate).
    const { data: apm, error: apmErr } = await admin
      .from("ai_proposed_matches")
      .select("id, status, client_visible, approved_payload, trade_request_id")
      .eq("match_id", matchId)
      .eq("client_visible", true)
      .eq("status", "approved_client_view")
      .not("approved_payload", "is", null)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (apmErr) throw apmErr;
    if (!apm) {
      return json(409, { error: "no client-visible approved AI summary on this match" });
    }

    // Create the internal admin task. This is the ONLY state mutation.
    const taskKind = TASK_KIND_BY_ACTION[action];
    const { data: task, error: taskErr } = await admin
      .from("ai_intel_tasks")
      .insert({
        match_id: matchId,
        proposed_match_id: (apm as any).id,
        trade_request_id: (apm as any).trade_request_id ?? (match as any).trade_request_id ?? null,
        kind: taskKind,
        description: note ?? null,
        status: "open",
        created_by: userId,
        metadata: {
          source: "originator_match_page",
          action,
          note,
          submitted_at: new Date().toISOString(),
        },
      })
      .select("id")
      .maybeSingle();
    if (taskErr) throw taskErr;

    const auditAction = AUDIT_BY_ACTION[action];
    if (!AI_REVIEW_AUDIT_NAMES.includes(auditAction as never)) {
      return json(500, { error: `audit name not canonical: ${auditAction}` });
    }

    await writeAdminAudit({
      admin,
      action: auditAction,
      status: "success",
      actorUserId: userId,
      targetType: "ai_proposed_match",
      targetId: (apm as any).id,
      requestId,
      endpoint: "match-ai-summary-action",
      ipAddress: extractIp(req),
      userAgent: extractUserAgent(req),
      extra: {
        match_id: matchId,
        task_id: (task as any)?.id ?? null,
        action,
        note_present: !!note,
      },
    });

    return json(200, { ok: true, task_id: (task as any)?.id ?? null });
  } catch (e: unknown) {
    const err = e as { statusCode?: number; message?: string };
    console.error("[match-ai-summary-action] error:", err);
    const status = err?.statusCode ?? 500;
    try {
      await writeAdminAudit({
        admin,
        action: "ai_review.admin_override_applied",
        status: "error",
        actorUserId: userId,
        targetType: "match",
        targetId: matchId ?? undefined,
        requestId,
        endpoint: "match-ai-summary-action",
        reason: err?.message ?? "unknown",
        ipAddress: extractIp(req),
        userAgent: extractUserAgent(req),
        extra: { action },
      });
    } catch (_) {
      /* never let audit failure mask real error */
    }
    return json(status, { error: err?.message ?? "internal error" });
  }
}
