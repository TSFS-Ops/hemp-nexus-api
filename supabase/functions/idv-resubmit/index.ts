/**
 * Batch V-UI — IDV resubmission trigger.
 *
 * Called by the status widget / start screen when the user acts on a
 * non-terminal, resubmit-eligible state (retry_required,
 * alternative_document_required, failed, expired, error, provider_error).
 *
 * Server-side responsibilities:
 *   - authenticate the calling user;
 *   - locate their p5scr_subjects row (if any);
 *   - append a `p5_screening.idv_required` audit event capturing the
 *     resubmission intent (safe payload only — no raw provider data);
 *   - respond with the subject id and the safe reason so the client can
 *     route into the start screen.
 *
 * No provider call is made here. The actual re-verification is issued
 * by `idv-verify` once the user completes the start-screen form.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders as buildCorsHeaders, handleCors } from "../_shared/cors.ts";

const RESUBMIT_REASONS = new Set([
  "retry_required",
  "alternative_document_required",
  "failed",
  "expired",
  "error",
  "provider_error",
  "user_initiated",
]);

Deno.serve(async (req) => {
  const pre = handleCors(req, Deno.env.get("ALLOWED_ORIGINS") || "");
  if (pre) return pre;
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405, req);

  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "UNAUTHORIZED" }, 401, req);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !serviceKey || !anonKey) return json({ error: "MISCONFIGURED" }, 500, req);

    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const authed = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });
    const { data: userRes, error: userErr } = await authed.auth.getUser();
    if (userErr || !userRes?.user) return json({ error: "UNAUTHORIZED" }, 401, req);
    const user = userRes.user;

    const body = await req.json().catch(() => ({}));
    const rawReason = typeof body?.reason === "string" ? body.reason : "user_initiated";
    const reason = RESUBMIT_REASONS.has(rawReason) ? rawReason : "user_initiated";
    const source = typeof body?.source === "string" && body.source.length <= 64
      ? body.source
      : "status_widget";

    // Locate subject (may not exist yet if the user has never provisioned).
    const { data: subject } = await admin
      .from("p5scr_subjects")
      .select("id")
      .eq("person_external_ref", user.id)
      .maybeSingle();

    const subjectId = (subject?.id as string) ?? null;

    // Compliance snapshot: capture prior_state (the state we're moving away
    // from) and resulting_state (the state after recording the intent). A
    // resubmission itself doesn't fire a provider call, so resulting_state
    // is the safe reason label unless there's a newer check row.
    let priorState: string | null = null;
    if (subjectId) {
      const { data: latestCheck } = await admin
        .from("p5scr_check_results")
        .select("state, decided_at, created_at")
        .eq("subject_id", subjectId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      priorState = (latestCheck?.state as string) ?? null;
    }
    const resultingState = "awaiting_resubmission";

    // Resolve org_id for the compliance audit trail (audit_logs.org_id is
    // NOT NULL). If the user has no profile.organization_id we still record
    // the p5scr audit + intent, but skip the org-scoped audit_logs row and
    // surface a flag on the response for observability.
    let orgId: string | null = null;
    try {
      const { data: profile } = await admin
        .from("profiles")
        .select("organization_id")
        .eq("id", user.id)
        .maybeSingle();
      orgId = (profile?.organization_id as string) ?? null;
    } catch { /* best-effort */ }

    // 1) Append screening audit event (append-only, admin-scoped).
    const { error: auditErr } = await admin.from("p5scr_audit_events").insert({
      event: "p5_screening.idv_required",
      subject_id: subjectId,
      category: "idv_person",
      gate: "idv",
      actor_user_id: user.id,
      payload_admin_only: {
        reason,
        source,
        trigger: "user_resubmit",
        prior_state: priorState,
        resulting_state: resultingState,
      },
    });
    if (auditErr) {
      return json({ error: "AUDIT_WRITE_FAILED", detail: auditErr.message }, 500, req);
    }

    // 2) Persist the user-readable resubmit intent (drives the widget).
    const { error: intentErr } = await admin.from("idv_resubmit_intents").insert({
      user_id: user.id,
      subject_id: subjectId,
      reason,
      source,
    });
    if (intentErr) {
      return json({ error: "INTENT_WRITE_FAILED", detail: intentErr.message }, 500, req);
    }

    // 3) Compliance audit_logs entry — structured, org-scoped, queryable
    //    alongside the rest of the platform's compliance events.
    let auditLogged = false;
    if (orgId) {
      const { error: logErr } = await admin.from("audit_logs").insert({
        org_id: orgId,
        actor_user_id: user.id,
        action: "idv.resubmit_requested",
        entity_type: "idv_subject",
        entity_id: subjectId,
        metadata: {
          reason,
          source,
          trigger: "user_resubmit",
          prior_state: priorState,
          resulting_state: resultingState,
          subject_provisioned: Boolean(subjectId),
          user_agent: req.headers.get("user-agent") ?? null,
        },
      });
      if (logErr) {
        // Do NOT fail the request; return audit_logged=false so the caller
        // (and downstream monitoring) can flag the compliance gap.
        console.error("[idv-resubmit] audit_logs insert failed", logErr.message);
      } else {
        auditLogged = true;
      }
    }

    return json({
      ok: true,
      subject_id: subjectId,
      subject_provisioned: Boolean(subjectId),
      reason,
      prior_state: priorState,
      resulting_state: resultingState,
      audit_logged: auditLogged,
      audit_skipped_reason: auditLogged ? null : (orgId ? "audit_logs_write_failed" : "no_org_for_user"),
      next_route: `/desk/idv/start?resubmit=1&reason=${encodeURIComponent(reason)}`,
    }, 200);
  } catch (e) {
    return json({ error: "INTERNAL", message: e instanceof Error ? e.message : "unknown" }, 500, req);
  }
});

function json(payload: unknown, status: number, req: Request) {
  const origin = req.headers.get("origin");
  const cors = buildCorsHeaders(Deno.env.get("ALLOWED_ORIGINS") || "", origin);
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
