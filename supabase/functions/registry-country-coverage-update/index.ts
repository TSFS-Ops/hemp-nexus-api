// Batch 2 — M011 Country Coverage state writer.
// Records coverage state changes per surface. Platform admin / compliance owner.
// Seed-only / sample-only states can NEVER be promoted to production_ready
// without an approved business_decision evidence link.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import {
  COUNTRY_COVERAGE_STATES,
  type CountryCoverageState,
} from "../_shared/registry-country-coverage.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const SURFACES = [
  "coverage_state",
  "registry_data_state",
  "claim_company_state",
  "authority_verification_state",
  "bank_detail_verification_state",
  "api_output_state",
  "outreach_state",
  "demo_readiness_state",
] as const;

const BodySchema = z.object({
  country_code: z.string().min(2).max(8),
  surface: z.enum(SURFACES),
  new_state: z.enum(COUNTRY_COVERAGE_STATES as readonly [CountryCoverageState, ...CountryCoverageState[]]),
  reason: z.string().min(20).max(500),
  evidence_url: z.string().url().optional(),
  business_decision_id: z.string().uuid().optional(),
  public_wording_allowed: z.boolean().optional(),
  internal_notes: z.string().max(2000).optional(),
  next_action: z.string().max(500).optional(),
});

Deno.serve(async (req) => {
  const pre = handleCorsPreflight(req);
  if (pre) return pre;
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: userRes } = await userClient.auth.getUser();
    const user = userRes?.user;
    if (!user) {
      return withCors(req, new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } }));
    }

    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return withCors(req, new Response(JSON.stringify({ error: "invalid_body", details: parsed.error.flatten() }), { status: 400, headers: { "Content-Type": "application/json" } }));
    }
    const input = parsed.data;

    const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { data: roles } = await svc.from("user_roles").select("role").eq("user_id", user.id);
    const roleSet = new Set((roles ?? []).map((r: { role: string }) => r.role));
    const isAuthorised = roleSet.has("platform_admin") || roleSet.has("compliance_owner");
    if (!isAuthorised) {
      return withCors(req, new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { "Content-Type": "application/json" } }));
    }

    const { data: row, error: getErr } = await svc
      .from("registry_country_coverage")
      .select("country_code, coverage_state, registry_data_state, claim_company_state, authority_verification_state, bank_detail_verification_state, api_output_state, outreach_state, demo_readiness_state")
      .eq("country_code", input.country_code)
      .maybeSingle();
    if (getErr) throw getErr;
    if (!row) {
      return withCors(req, new Response(JSON.stringify({ error: "country_not_found" }), { status: 404, headers: { "Content-Type": "application/json" } }));
    }

    const previousState = (row as Record<string, string>)[input.surface] as CountryCoverageState;

    // Hard rule: seed_only / sample_only → production_ready requires an
    // approved business_decision link AND an evidence URL.
    const isSeed = previousState === "seed_only" || previousState === "sample_only";
    const isProductionPromotion = input.new_state === "production_ready";
    if (isSeed && isProductionPromotion) {
      if (!input.business_decision_id || !input.evidence_url) {
        return withCors(req, new Response(JSON.stringify({
          error: "promotion_requires_business_decision_and_evidence",
        }), { status: 400, headers: { "Content-Type": "application/json" } }));
      }
      const { data: decision } = await svc
        .from("business_decisions")
        .select("status, category")
        .eq("id", input.business_decision_id)
        .maybeSingle();
      if (!decision || decision.status !== "approved" || decision.category !== "country") {
        return withCors(req, new Response(JSON.stringify({
          error: "business_decision_not_approved_country",
        }), { status: 400, headers: { "Content-Type": "application/json" } }));
      }
    }

    const update: Record<string, unknown> = {
      [input.surface]: input.new_state,
      last_reviewed_at: new Date().toISOString(),
    };
    if (typeof input.public_wording_allowed === "boolean") update.public_wording_allowed = input.public_wording_allowed;
    if (input.internal_notes !== undefined) update.internal_notes = input.internal_notes;
    if (input.next_action !== undefined) update.next_action = input.next_action;

    const { error: updErr } = await svc.from("registry_country_coverage")
      .update(update).eq("country_code", input.country_code);
    if (updErr) throw updErr;

    const auditName = input.surface === "coverage_state"
      ? "registry_country_coverage_state_changed"
      : "registry_country_coverage_state_changed";

    await svc.from("registry_country_coverage_events").insert({
      country_code: input.country_code,
      surface: input.surface,
      previous_state: previousState,
      new_state: input.new_state,
      reason: input.reason,
      evidence_url: input.evidence_url ?? null,
      business_decision_id: input.business_decision_id ?? null,
      audit_event_name: auditName,
      actor_id: user.id,
    });

    if (typeof input.public_wording_allowed === "boolean") {
      await svc.from("registry_country_coverage_events").insert({
        country_code: input.country_code,
        surface: "public_wording_allowed",
        previous_state: null,
        new_state: String(input.public_wording_allowed),
        reason: input.reason,
        evidence_url: input.evidence_url ?? null,
        business_decision_id: input.business_decision_id ?? null,
        audit_event_name: "registry_country_coverage_wording_changed",
        actor_id: user.id,
      });
    }

    await svc.from("event_store").insert({
      event_name: auditName,
      aggregate_id: input.country_code,
      aggregate_type: "registry_country_coverage",
      actor_id: user.id,
      payload: { surface: input.surface, previous: previousState, next: input.new_state, reason: input.reason },
    }).catch(() => {});

    return withCors(req, new Response(JSON.stringify({ ok: true, country_code: input.country_code, surface: input.surface, previous_state: previousState, new_state: input.new_state }), { status: 200, headers: { "Content-Type": "application/json" } }));
  } catch (err) {
    console.error("registry-country-coverage-update error", err);
    return withCors(req, new Response(JSON.stringify({ error: "internal_error", message: String(err) }), { status: 500, headers: { "Content-Type": "application/json" } }));
  }
});
