/**
 * Batch V -- Manual IDV review edge function.
 *
 * Persists an IDV manual-review decision into `public.p5scr_manual_reviews`
 * (category = 'idv_person'). Extended decision + reason are preserved in
 * `notes_admin_only`; the constrained `decision` column receives the
 * mapped value (see src/lib/idv/manual-review.ts).
 *
 * Requires the caller to be platform_admin. Fail-closed on every path.
 * No provider calls. No Memory writes of raw payloads.
 *
 * Batch V-UI-Fix-4: after a decision is persisted, the safe gate-facing
 * status is also projected into `p5scr_idv_records` via the existing
 * `p5scr_record_idv` RPC (never a raw insert). This is what makes
 * `p5scr_manual_reviews` the true source of truth end-to-end: the admin
 * queue reads open cases from it, decisions are written to it, AND the
 * user-facing status widget / controlled-action gates now see the
 * resolved state too. Only `manual_review_accepted` releases a gate --
 * see `mapDecisionToGateState` in `idv-manual-review-shape.ts`.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders as buildCorsHeaders, handleCors } from "../_shared/cors.ts";
import {
  mapToP5ScrDecisionColumn,
  mapDecisionToGateState,
} from "../_shared/idv-manual-review-shape.ts";

Deno.serve(async (req) => {
  const allowedOrigins = Deno.env.get("ALLOWED_ORIGINS") || "";
  const origin = req.headers.get("origin");
  const corsH = buildCorsHeaders(allowedOrigins, origin);
  const pre = handleCors(req, allowedOrigins);
  if (pre) return pre;
  if (req.method !== "POST") {
    return json({ error: "METHOD_NOT_ALLOWED" }, 405, req);
  }
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "UNAUTHORIZED" }, 401, req);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !serviceKey || !anonKey) {
      return json({ error: "MISCONFIGURED" }, 500, req);
    }
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const authed = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });
    const { data: userRes, error: userErr } = await authed.auth.getUser();
    if (userErr || !userRes?.user) return json({ error: "UNAUTHORIZED" }, 401, req);
    const userId = userRes.user.id;

  const { data: isAdmin } = await admin.rpc("has_role", {
    _user_id: userId,
    _role: "platform_admin",
  });
    if (!isAdmin) return json({ error: "FORBIDDEN" }, 403, req);

  const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") return json({ error: "BAD_REQUEST" }, 400, req);

  const {
    subject_id,
    reason,
    decision,
    decision_reason,
    document_country,
    document_type,
    provider_status,
  } = body as Record<string, unknown>;

  if (!subject_id || typeof subject_id !== "string") {
    return json({ error: "subject_id required" }, 400, req);
  }
    if (!decision || typeof decision !== "string") {
      return json({ error: "decision required" }, 400, req);
    }
    const validDecisions = [
      "manual_review_accepted",
      "manual_review_rejected",
      "more_information_required",
      "alternative_document_required",
      "provider_retry_required",
      "blocked_pending_admin_decision",
      "waived_with_reason",
      ];
    if (!validDecisions.includes(decision)) {
      return json({ error: "invalid decision" }, 400, req);
    }
    const mapped = mapToP5ScrDecisionColumn(
      decision as Parameters<typeof mapToP5ScrDecisionColumn>[0],
      );

  // No raw payload storage. Only structured, safe fields.
  const notes = JSON.stringify({
    extended_decision: decision,
    extended_reason: reason ?? null,
    decision_reason: decision_reason ?? null,
    document_country: document_country ?? null,
    document_type: document_type ?? null,
    provider_attempted: "verifynow",
    provider_status: provider_status ?? null,
    recorded_by_batch: "batch_v",
  });

  // Find or open an idv_person review for this subject.
  const { data: openReview } = await admin
    .from("p5scr_manual_reviews")
    .select("id")
    .eq("subject_id", subject_id)
    .eq("category", "idv_person")
    .is("decided_at", null)
    .maybeSingle();

  let reviewId: string;
    if (openReview?.id) {
      reviewId = openReview.id;
    } else {
      const { data: opened, error: openErr } = await admin
      .from("p5scr_manual_reviews")
      .insert({
        subject_id,
        category: "idv_person",
        opened_by: userId,
        reason: typeof reason === "string" ? reason : "admin_required_review",
      })
      .select("id")
      .single();
      if (openErr || !opened) {
        return json({ error: "MANUAL_REVIEW_STORE_NOT_WIRED", detail: openErr?.message ?? null }, 501, req);
      }
      reviewId = opened.id;
    }

  const { error: updErr } = await admin
    .from("p5scr_manual_reviews")
    .update({
      decided_at: new Date().toISOString(),
      decided_by: userId,
      decision: mapped,
      reason: typeof reason === "string" ? reason : null,
      notes_admin_only: notes,
    })
    .eq("id", reviewId);

  if (updErr) {
    return json({ error: "MANUAL_REVIEW_STORE_NOT_WIRED", detail: updErr.message }, 501, req);
  }

  // Batch V-UI-Fix-4: project the decision into the gate-readable
  // p5scr_idv_records table via the existing p5scr_record_idv RPC --
  // never a raw insert. This is what the user status widget and every
  // controlled-action gate actually read, so a decision recorded here
  // can never leave the gate/user view stuck on a stale/unwritten
  // state (no split-brain between p5scr_manual_reviews and
  // p5scr_idv_records).
  const gateState = mapDecisionToGateState(
    decision as Parameters<typeof mapDecisionToGateState>[0],
    );
    const { error: projectionErr } = await admin.rpc("p5scr_record_idv", {
      p_subject_id: subject_id,
      p_state: gateState,
      p_provider_ref: null,
      p_provider_live_now: false,
      p_raw_provider_payload_admin_only: {
        source: "idv-manual-review",
        review_id: reviewId,
        admin_decision: decision,
      },
    });
    if (projectionErr) {
      console.error("[idv-manual-review] p5scr_record_idv projection failed", projectionErr.message);
      return json({
        error: "GATE_PROJECTION_FAILED",
        detail: projectionErr.message,
        review_id: reviewId,
        subject_id,
        recorded_decision: decision,
        stored_column_decision: mapped,
      }, 502, req);
    }

  // Audit event -- best-effort, non-fatal if audit table absent.
  try {
    await admin.from("audit_logs").insert({
      actor_id: userId,
      action: "idv.manual_review_decision",
      entity_type: "p5scr_manual_review",
      entity_id: reviewId,
      metadata: {
        subject_id,
        decision,
        mapped_column_decision: mapped,
        projected_gate_state: gateState,
        reason: reason ?? null,
      },
    });
  } catch { /* audit best-effort */ }

  return json({
    ok: true,
    review_id: reviewId,
    subject_id,
    recorded_decision: decision,
    stored_column_decision: mapped,
    projected_gate_state: gateState,
  }, 200, req);
  } catch (e) {
    return json({ error: "INTERNAL_ERROR", detail: String(e) }, 500, req);
  }
});

function json(body: unknown, status: number, req: Request): Response {
  const allowedOrigins = Deno.env.get("ALLOWED_ORIGINS") || "";
  const origin = req.headers.get("origin");
  const cors = buildCorsHeaders(allowedOrigins, origin);
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });
}
