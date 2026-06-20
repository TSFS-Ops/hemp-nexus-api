// P011 — compute-evidence-rating
// Recalculates the evidence-confidence rating for a (organisation_id, counterparty_id).
// Event-driven only (NOT called on render). Writes a snapshot + audit events.
// On failure: keeps last rating, marks freshness=error, emits rating_recalculation_failed.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import {
  computeEvidenceRating,
  COUNTERPARTY_RATING_METHODOLOGY_VERSION,
  type EvidenceRatingInputs,
} from "../_shared/evidence-rating.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface Body {
  organisation_id: string;
  counterparty_id: string;
  trigger: string;
  inputs: EvidenceRatingInputs;
}

function isUuid(v: unknown): v is string {
  return typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

async function emitAudit(
  admin: ReturnType<typeof createClient>,
  action: string,
  orgId: string,
  cpId: string,
  metadata: Record<string, unknown>,
) {
  await admin.from("audit_logs").insert({
    org_id: orgId,
    action,
    entity_type: "counterparty_evidence_rating",
    entity_id: cpId,
    metadata,
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (
    !isUuid(body.organisation_id) ||
    !isUuid(body.counterparty_id) ||
    typeof body.trigger !== "string" ||
    !body.inputs ||
    typeof body.inputs !== "object"
  ) {
    return new Response(JSON.stringify({ error: "invalid_input" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  });

  // Verify the caller is platform_admin / compliance_owner / service path.
  const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
  const { data: userData } = await userClient.auth.getUser();
  const userId = userData?.user?.id ?? null;
  if (!userId) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const { data: roles } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  const okRole = (roles ?? []).some((r: { role: string }) =>
    ["platform_admin", "compliance_owner"].includes(r.role),
  );
  if (!okRole) {
    return new Response(JSON.stringify({ error: "forbidden" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Read prior snapshot for change detection / failure preservation.
  const { data: prior } = await admin
    .from("counterparty_evidence_ratings")
    .select("id, rating_band, methodology_version")
    .eq("organisation_id", body.organisation_id)
    .eq("counterparty_id", body.counterparty_id)
    .maybeSingle();

  try {
    const result = computeEvidenceRating(body.inputs);

    const summary: Record<string, { label: string; status: string }> = {};
    if (body.inputs.kyb_registry) {
      summary.kyb_registry = { label: "KYB / company registry", status: body.inputs.kyb_registry.status };
    }
    if (body.inputs.sanctions_pep) {
      summary.sanctions_pep = { label: "Sanctions / PEP screening", status: body.inputs.sanctions_pep.status };
    }
    if (body.inputs.ubo_authority) {
      summary.ubo_authority = { label: "UBO / authority", status: body.inputs.ubo_authority.status };
    }
    summary.documents = {
      label: "Approved evidence documents",
      status: body.inputs.documents.some((d) => d.status === "completed") ? "completed" : "not_run",
    };
    summary.public_source = {
      label: "Public-source signals",
      status: body.inputs.public_source_signals.some((s) => s.status === "completed")
        ? "completed"
        : "not_run",
    };

    const row = {
      organisation_id: body.organisation_id,
      counterparty_id: body.counterparty_id,
      rating_band: result.band,
      methodology_version: result.methodology_version,
      calculated_at: new Date().toISOString(),
      calculation_trigger: body.trigger,
      freshness_state: "fresh" as const,
      supporting_factors_json: result.supporting_factors,
      input_summary_json: summary,
      missing_inputs_json: result.missing_inputs,
      stale_inputs_json: result.stale_inputs,
      workflow_effect_json: result.workflow_effect,
    };

    const { error: upErr } = await admin
      .from("counterparty_evidence_ratings")
      .upsert(row, { onConflict: "organisation_id,counterparty_id" });
    if (upErr) throw upErr;

    const action = prior ? "counterparty_rating.rating_refreshed" : "counterparty_rating.rating_calculated";
    await emitAudit(admin, action, body.organisation_id, body.counterparty_id, {
      trigger: body.trigger,
      methodology_version: result.methodology_version,
      band: result.band,
    });

    if (prior && prior.rating_band !== result.band) {
      await emitAudit(
        admin,
        "counterparty_rating.rating_changed",
        body.organisation_id,
        body.counterparty_id,
        { old_rating: prior.rating_band, new_rating: result.band, trigger: body.trigger },
      );
    }

    if (prior && prior.methodology_version !== result.methodology_version) {
      await emitAudit(
        admin,
        "counterparty_rating.methodology_version_changed",
        body.organisation_id,
        body.counterparty_id,
        { from: prior.methodology_version, to: result.methodology_version },
      );
    }

    return new Response(JSON.stringify({ ok: true, rating: result }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    // Preserve the last rating: mark freshness=error.
    if (prior) {
      await admin
        .from("counterparty_evidence_ratings")
        .update({ freshness_state: "error" })
        .eq("organisation_id", body.organisation_id)
        .eq("counterparty_id", body.counterparty_id);
    }
    await emitAudit(
      admin,
      "counterparty_rating.rating_recalculation_failed",
      body.organisation_id,
      body.counterparty_id,
      { trigger: body.trigger, error: String((err as Error)?.message ?? err) },
    );
    return new Response(JSON.stringify({ ok: false, error: "recalculation_failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
