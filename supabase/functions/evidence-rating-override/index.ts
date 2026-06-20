// P011 — evidence-rating-override
// Action: "apply" | "change" | "remove". Role-gated (platform_admin / compliance_owner).
// All validation duplicated client-side checks; the BEFORE-INSERT trigger is the
// last line of defence in the database.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import {
  EVIDENCE_RATING_OVERRIDE_MIN_REASON_LENGTH,
  EVIDENCE_RATING_OVERRIDE_REASONS,
} from "../_shared/evidence-rating.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const NINETY_DAYS_MS = 90 * 86_400_000;

interface Body {
  action: "apply" | "change" | "remove";
  organisation_id: string;
  counterparty_id: string;
  override_id?: string;
  override_rating?: string;
  reason_code?: string;
  reason_text?: string;
  evidence_document_id?: string;
  expires_at?: string;
  removal_reason?: string;
}

function jsonErr(status: number, error: string) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonErr(405, "method_not_allowed");

  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return jsonErr(401, "unauthorized");

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return jsonErr(400, "invalid_json");
  }

  if (!body.action || !body.organisation_id || !body.counterparty_id) {
    return jsonErr(400, "invalid_input");
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
  const { data: userData } = await userClient.auth.getUser();
  const userId = userData?.user?.id;
  if (!userId) return jsonErr(401, "unauthorized");

  const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", userId);
  const okRole = (roles ?? []).some((r: { role: string }) =>
    ["platform_admin", "compliance_owner"].includes(r.role),
  );
  if (!okRole) return jsonErr(403, "forbidden");

  // Validation block (apply/change)
  if (body.action !== "remove") {
    if (
      !body.reason_code ||
      !(EVIDENCE_RATING_OVERRIDE_REASONS as readonly string[]).includes(body.reason_code)
    ) {
      return jsonErr(400, "invalid_reason_code");
    }
    if (!body.reason_text || body.reason_text.length < EVIDENCE_RATING_OVERRIDE_MIN_REASON_LENGTH) {
      return jsonErr(400, "reason_text_too_short");
    }
    if (!body.expires_at) return jsonErr(400, "expires_at_required");
    const expiresMs = new Date(body.expires_at).getTime();
    if (Number.isNaN(expiresMs)) return jsonErr(400, "invalid_expires_at");
    if (body.reason_code !== "admin_block" && expiresMs > Date.now() + NINETY_DAYS_MS) {
      return jsonErr(400, "expiry_too_far");
    }
    if (body.override_rating === "verification_complete") {
      return jsonErr(400, "cannot_override_to_verification_complete");
    }
    // Block hiding of active critical sanctions: caller must clear the flag separately.
    const { data: snap } = await admin
      .from("counterparty_evidence_ratings")
      .select("rating_band")
      .eq("organisation_id", body.organisation_id)
      .eq("counterparty_id", body.counterparty_id)
      .maybeSingle();
    if (
      snap?.rating_band === "flagged" &&
      body.override_rating &&
      body.override_rating !== "flagged"
    ) {
      return jsonErr(400, "cannot_hide_active_critical_flag");
    }
  }

  if (body.action === "apply") {
    const { data: snap } = await admin
      .from("counterparty_evidence_ratings")
      .select("rating_band")
      .eq("organisation_id", body.organisation_id)
      .eq("counterparty_id", body.counterparty_id)
      .maybeSingle();
    const oldRating = snap?.rating_band ?? "limited_information";
    const { data: inserted, error } = await admin
      .from("counterparty_rating_overrides")
      .insert({
        organisation_id: body.organisation_id,
        counterparty_id: body.counterparty_id,
        old_rating: oldRating,
        override_rating: body.override_rating!,
        reason_code: body.reason_code!,
        reason_text: body.reason_text!,
        evidence_document_id: body.evidence_document_id ?? null,
        expires_at: body.expires_at!,
        created_by: userId,
      })
      .select("id")
      .single();
    if (error) return jsonErr(400, error.message);

    await admin
      .from("counterparty_evidence_ratings")
      .update({ has_admin_override: true, override_id: inserted!.id })
      .eq("organisation_id", body.organisation_id)
      .eq("counterparty_id", body.counterparty_id);

    await admin.from("audit_logs").insert({
      org_id: body.organisation_id,
      actor_user_id: userId,
      action: "counterparty_rating.rating_override_applied",
      entity_type: "counterparty_rating_override",
      entity_id: inserted!.id,
      metadata: { reason_code: body.reason_code, override_rating: body.override_rating },
    });
    return new Response(JSON.stringify({ ok: true, override_id: inserted!.id }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (body.action === "change") {
    if (!body.override_id) return jsonErr(400, "override_id_required");
    const { error } = await admin
      .from("counterparty_rating_overrides")
      .update({
        override_rating: body.override_rating!,
        reason_code: body.reason_code!,
        reason_text: body.reason_text!,
        evidence_document_id: body.evidence_document_id ?? null,
        expires_at: body.expires_at!,
        updated_by: userId,
      })
      .eq("id", body.override_id);
    if (error) return jsonErr(400, error.message);
    await admin.from("audit_logs").insert({
      org_id: body.organisation_id,
      actor_user_id: userId,
      action: "counterparty_rating.rating_override_changed",
      entity_type: "counterparty_rating_override",
      entity_id: body.override_id,
      metadata: { reason_code: body.reason_code },
    });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // remove
  if (!body.override_id) return jsonErr(400, "override_id_required");
  if (!body.removal_reason || body.removal_reason.length < EVIDENCE_RATING_OVERRIDE_MIN_REASON_LENGTH) {
    return jsonErr(400, "removal_reason_too_short");
  }
  const { error: remErr } = await admin
    .from("counterparty_rating_overrides")
    .update({
      removed_by: userId,
      removed_at: new Date().toISOString(),
      removal_reason: body.removal_reason,
    })
    .eq("id", body.override_id);
  if (remErr) return jsonErr(400, remErr.message);
  await admin
    .from("counterparty_evidence_ratings")
    .update({ has_admin_override: false, override_id: null })
    .eq("organisation_id", body.organisation_id)
    .eq("counterparty_id", body.counterparty_id);
  await admin.from("audit_logs").insert({
    org_id: body.organisation_id,
    actor_user_id: userId,
    action: "counterparty_rating.rating_override_removed",
    entity_type: "counterparty_rating_override",
    entity_id: body.override_id,
    metadata: { removal_reason: body.removal_reason },
  });
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
