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
import { corsHeaders } from "../_shared/cors.ts";

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
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "UNAUTHORIZED" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !serviceKey || !anonKey) return json({ error: "MISCONFIGURED" }, 500);

    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const authed = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });
    const { data: userRes, error: userErr } = await authed.auth.getUser();
    if (userErr || !userRes?.user) return json({ error: "UNAUTHORIZED" }, 401);
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

    // Append audit event. The p5scr_audit_events payload key-guard trigger
    // rejects banned keys — we only send safe scalars: reason + source.
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
      },
    });
    if (auditErr) {
      return json({ error: "AUDIT_WRITE_FAILED", detail: auditErr.message }, 500);
    }

    return json({
      ok: true,
      subject_id: subjectId,
      subject_provisioned: Boolean(subjectId),
      reason,
      next_route: `/desk/idv/start?resubmit=1&reason=${encodeURIComponent(reason)}`,
    }, 200);
  } catch (e) {
    return json({ error: "INTERNAL", message: e instanceof Error ? e.message : "unknown" }, 500);
  }
});

function json(payload: unknown, status: number) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
