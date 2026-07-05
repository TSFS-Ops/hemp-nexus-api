/**
 * Batch V-UI-Fix-2 — User-callable IDV manual-review opener.
 *
 * Purpose: when the /desk/idv/start page routes to an unsupported /
 * provider_not_available document combination, the authenticated user
 * must be able to OPEN a manual review case for themselves. The admin-
 * only `idv-manual-review` function is reserved for decision recording
 * by platform_admin and MUST NOT be called by end users. This function
 * fills the gap:
 *   - authenticates the caller;
 *   - verifies the target `p5scr_subjects` row belongs to them
 *     (person_external_ref = auth.uid);
 *   - inserts (or returns the existing) OPEN idv_person case;
 *   - never records a decision (that stays admin-only);
 *   - stores no raw provider payload, no ID number, no biometric data.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders as buildCorsHeaders, handleCors } from "../_shared/cors.ts";

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

    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return json({ error: "BAD_REQUEST" }, 400, req);

    const subjectId = typeof body.subject_id === "string" ? body.subject_id : null;
    const documentCountry = typeof body.document_country === "string" ? body.document_country : null;
    const documentType = typeof body.document_type === "string" ? body.document_type : null;
    const reason = typeof body.reason === "string" ? body.reason.slice(0, 200) : "provider_not_available_from_ui";

    if (!subjectId) return json({ error: "subject_id required" }, 400, req);

    // Ownership check — subject must belong to the calling user.
    const { data: subj, error: subjErr } = await admin
      .from("p5scr_subjects")
      .select("id, person_external_ref")
      .eq("id", subjectId)
      .maybeSingle();
    if (subjErr) return json({ error: "SUBJECT_LOOKUP_FAILED" }, 500, req);
    if (!subj || subj.person_external_ref !== userId) {
      return json({ error: "FORBIDDEN" }, 403, req);
    }

    // Return existing open case if any.
    const { data: existing } = await admin
      .from("p5scr_manual_reviews")
      .select("id")
      .eq("subject_id", subjectId)
      .eq("category", "idv_person")
      .is("decided_at", null)
      .maybeSingle();
    if (existing?.id) {
      return json({ ok: true, review_id: existing.id, already_open: true }, 200, req);
    }

    const { data: opened, error: openErr } = await admin
      .from("p5scr_manual_reviews")
      .insert({
        subject_id: subjectId,
        category: "idv_person",
        opened_by: userId,
        reason,
        notes_admin_only: JSON.stringify({
          document_country: documentCountry,
          document_type: documentType,
          opened_via: "user_ui_provider_not_available",
          opened_by_batch: "batch_v_ui_fix_2",
        }),
      })
      .select("id")
      .single();

    if (openErr || !opened) {
      console.error("[idv-open-manual-review] insert failed", openErr?.message);
      return json({ error: "MANUAL_REVIEW_OPEN_FAILED", detail: openErr?.message ?? null }, 500, req);
    }

    // Best-effort audit; do not fail the caller if the audit table is absent.
    try {
      await admin.from("audit_logs").insert({
        actor_user_id: userId,
        action: "idv.manual_review_opened_by_user",
        entity_type: "p5scr_manual_review",
        entity_id: opened.id,
        metadata: {
          subject_id: subjectId,
          document_country: documentCountry,
          document_type: documentType,
          reason,
        },
      });
    } catch { /* audit optional */ }

    return json({ ok: true, review_id: opened.id, already_open: false }, 200, req);
  } catch (e) {
    console.error("[idv-open-manual-review] internal", e);
    return json({ error: "INTERNAL", message: e instanceof Error ? e.message : "unknown" }, 500, req);
  }
});

function json(payload: unknown, status: number, req: Request): Response {
  const origin = req.headers.get("origin");
  const cors = buildCorsHeaders(Deno.env.get("ALLOWED_ORIGINS") || "", origin);
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
