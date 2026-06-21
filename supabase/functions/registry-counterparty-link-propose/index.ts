// Audited, idempotent human proposal for linking a counterparty to a registry record.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import { calculateMatchConfidence } from "../_shared/registry-counterparty-linking.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const Body = z.object({
  registry_company_record_id: z.string().uuid(),
  counterparty_id: z.string().max(120).optional(),
  counterparty_name: z.string().min(2).max(200),
  counterparty_country_code: z.string().min(2).max(8).optional(),
  counterparty_registration_number: z.string().max(60).optional(),
  counterparty_legal_form: z.string().max(60).optional(),
});

function response(req: Request, status: number, body: unknown, extraHeaders: Record<string, string> = {}) {
  return withCors(req, new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...extraHeaders } }));
}

Deno.serve(async (req) => {
  const pre = handleCorsPreflight(req);
  if (pre) return pre;
  try {
    const idempotencyKey = req.headers.get("Idempotency-Key")?.trim();
    if (!idempotencyKey || idempotencyKey.length > 200) {
      return response(req, 400, { error: "idempotency_key_required" });
    }

    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: userRes } = await userClient.auth.getUser();
    const user = userRes?.user;
    if (!user) return response(req, 401, { error: "unauthorized" });

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return response(req, 400, { error: "invalid_body", details: parsed.error.flatten() });

    const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { data: existing } = await svc
      .from("registry_counterparty_link_proposals")
      .select("id, claim_id, status, registry_company_record_id, counterparty_id, counterparty_name, score, score_breakdown, proposed_by_user_id")
      .eq("proposed_by_user_id", user.id)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (existing) {
      return response(req, 200, { ok: true, proposal: existing, idempotent_replay: true }, { "X-Idempotent-Replay": "true" });
    }

    const [{ data: profile }, { data: registry }] = await Promise.all([
      svc.from("profiles").select("org_id, full_name, email").eq("id", user.id).maybeSingle(),
      svc.from("registry_company_records").select("id, company_name, country_code, registration_number, legal_form, claim_status, public_display_allowed").eq("id", parsed.data.registry_company_record_id).maybeSingle(),
    ]);
    if (!profile?.org_id) return response(req, 403, { error: "profile_org_required" });
    if (!registry?.public_display_allowed) return response(req, 404, { error: "registry_record_not_found" });

    let counterparty = {
      id: parsed.data.counterparty_id ?? null,
      name: parsed.data.counterparty_name,
      countryCode: parsed.data.counterparty_country_code ?? null,
      registrationNumber: parsed.data.counterparty_registration_number ?? null,
      legalForm: parsed.data.counterparty_legal_form ?? null,
    };
    if (counterparty.id && UUID.test(counterparty.id)) {
      const { data: cp } = await svc.from("counterparties").select("id, company_name, jurisdiction, registration_number").eq("id", counterparty.id).maybeSingle();
      if (cp) {
        counterparty = { id: cp.id, name: cp.company_name, countryCode: cp.jurisdiction, registrationNumber: cp.registration_number, legalForm: counterparty.legalForm };
      }
    }

    const confidence = calculateMatchConfidence(counterparty, {
      id: registry.id,
      name: registry.company_name,
      countryCode: registry.country_code,
      registrationNumber: registry.registration_number,
      legalForm: registry.legal_form,
    });

    const { data: proposal, error: proposalError } = await svc.from("registry_counterparty_link_proposals").insert({
      org_id: profile.org_id,
      registry_company_record_id: registry.id,
      counterparty_id: counterparty.id && UUID.test(counterparty.id) ? counterparty.id : null,
      counterparty_name: counterparty.name,
      score: confidence.score,
      score_breakdown: confidence.breakdown,
      proposed_by_user_id: user.id,
      idempotency_key: idempotencyKey,
      status: "proposed",
    }).select("id, claim_id, status, registry_company_record_id, counterparty_id, counterparty_name, score, score_breakdown, proposed_by_user_id").single();
    if (proposalError) {
      const { data: replay } = await svc.from("registry_counterparty_link_proposals")
        .select("id, claim_id, status, registry_company_record_id, counterparty_id, counterparty_name, score, score_breakdown, proposed_by_user_id")
        .eq("proposed_by_user_id", user.id).eq("idempotency_key", idempotencyKey).maybeSingle();
      if (replay) return response(req, 200, { ok: true, proposal: replay, idempotent_replay: true }, { "X-Idempotent-Replay": "true" });
      throw proposalError;
    }

    const claimantName = profile.full_name || user.email || "Registry proposer";
    const claimantEmail = profile.email || user.email || "unknown@example.invalid";
    const { data: claim } = await svc.from("registry_company_claims").insert({
      claimant_user_id: user.id,
      company_reference: registry.id,
      company_name: registry.company_name,
      registration_number: registry.registration_number ?? null,
      country_code: registry.country_code,
      claimant_name: claimantName,
      claimant_email: claimantEmail,
      claimant_role: "Counterparty search proposer",
      company_relationship: "Proposed counterparty-to-registry link",
      company_email_domain: null,
      status: "claim_started",
      workflow_status: "claim_started",
    }).select("id").single();

    if (claim?.id) {
      await svc.from("registry_counterparty_link_proposals").update({ claim_id: claim.id }).eq("id", proposal.id);
      await svc.from("registry_company_claim_events").insert({
        claim_id: claim.id,
        audit_event_name: "registry_counterparty_link_proposed",
        actor_id: user.id,
        new_status: "claim_started",
        payload: { proposal_id: proposal.id, registry_company_record_id: registry.id, counterparty_id: counterparty.id, score: confidence.score, score_breakdown: confidence.breakdown },
      }).catch(() => {});
    }

    await svc.from("audit_logs").insert({
      org_id: profile.org_id,
      actor_user_id: user.id,
      action: "registry_counterparty_link_proposed",
      entity_type: "registry_counterparty_link_proposal",
      entity_id: proposal.id,
      metadata: { registry_company_record_id: registry.id, counterparty_id: counterparty.id, score: confidence.score, score_breakdown: confidence.breakdown, claim_id: claim?.id ?? null },
    }).catch(() => {});

    return response(req, 200, { ok: true, proposal: { ...proposal, claim_id: claim?.id ?? null }, idempotent_replay: false });
  } catch (e) {
    console.error("registry-counterparty-link-propose error", e);
    return response(req, 500, { error: "internal", message: (e as Error).message });
  }
});