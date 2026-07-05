/**
 * Batch V-UI — IDV subject provisioning edge function.
 *
 * Ensures a `p5scr_subjects` row exists for the calling user before an
 * IDV submission is made. Uses the existing schema columns:
 *   - organisation_id  = user's active org id (nullable)
 *   - person_external_ref = auth user id
 *   - party_role       = 'authorised_representative'
 *   - display_label    = readable label (email + document country)
 *
 * No provider calls. No secrets required. Idempotent — returns the
 * existing row if one is already provisioned.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders as buildCorsHeaders, handleCors } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  const allowedOrigins = Deno.env.get("ALLOWED_ORIGINS") || "";
  const origin = req.headers.get("origin");
  const cors = buildCorsHeaders(allowedOrigins, origin);
  const pre = handleCors(req, allowedOrigins);
  if (pre) return pre;
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405, cors);

  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "UNAUTHORIZED" }, 401, cors);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !serviceKey || !anonKey) return json({ error: "MISCONFIGURED" }, 500, cors);

    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const authed = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });
    const { data: userRes, error: userErr } = await authed.auth.getUser();
    if (userErr || !userRes?.user) return json({ error: "UNAUTHORIZED" }, 401, cors);
    const user = userRes.user;

    const body = await req.json().catch(() => ({}));
    const documentCountry = typeof body?.document_country === "string" ? body.document_country : null;

    // Look up existing subject by person_external_ref = user.id.
    const { data: existing } = await admin
      .from("p5scr_subjects")
      .select("id")
      .eq("person_external_ref", user.id)
      .maybeSingle();
    if (existing?.id) {
      return json({ subject_id: existing.id, provisioned: false }, 200, cors);
    }

    // Resolve organisation for this user (best-effort; nullable).
    let organisationId: string | null = null;
    try {
      const { data: profile } = await admin
        .from("profiles")
        .select("organization_id")
        .eq("id", user.id)
        .maybeSingle();
      organisationId = (profile?.organization_id as string) ?? null;
    } catch { /* profile lookup optional */ }

    const displayLabel =
      (user.email ? `${user.email}` : `user:${user.id.slice(0, 8)}`) +
      (documentCountry ? ` (${documentCountry})` : "");

    const { data: inserted, error: insErr } = await admin
      .from("p5scr_subjects")
      .insert({
        organisation_id: organisationId,
        party_role: "authorised_representative",
        person_external_ref: user.id,
        display_label: displayLabel.slice(0, 200),
      })
      .select("id")
      .single();
    if (insErr || !inserted?.id) {
      console.error("[idv-subject-provision] insert failed", insErr?.message);
      return json({ error: "PROVISION_FAILED", detail: insErr?.message ?? null }, 500, cors);
    }

    return json({ subject_id: inserted.id, provisioned: true }, 200, cors);
  } catch (e) {
    console.error("[idv-subject-provision] internal error", e);
    return json({ error: "INTERNAL", message: e instanceof Error ? e.message : "unknown" }, 500, cors);
  }
});

function json(payload: unknown, status: number, cors: Record<string, string> = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

