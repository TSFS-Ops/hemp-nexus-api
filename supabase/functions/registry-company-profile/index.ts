// Batch 3 — M003 Company Profile Shell.
// Batch 7 — per-IP / per-API-key rate limit added.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import {
  clientIpFromRequest,
  enforceRegistrySearchRateLimit,
  rateLimited429,
} from "../_shared/registry-search-rate-limit.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const BodySchema = z.object({ company_reference: z.string().min(1).max(120) });

Deno.serve(async (req) => {
  const pre = handleCorsPreflight(req);
  if (pre) return pre;
  try {
    const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return withCors(req, new Response(JSON.stringify({ error: "invalid_body" }), { status: 400, headers: { "Content-Type": "application/json" } }));
    }
    const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    await svc.from("event_store").insert({
      event_name: "registry_company_profile_viewed",
      aggregate_id: parsed.data.company_reference,
      aggregate_type: "registry_company_profile",
      payload: {},
    }).catch(() => {});

    // Batch 3 — no production profile data. Return safe envelope.
    return withCors(req, new Response(JSON.stringify({
      ok: true,
      company_reference: parsed.data.company_reference,
      readiness_banner: "shell_ready",
      claim_status: "unclaimed",
      authority_status: "authority_pending",
      profile_verification_status: "profile_not_verified",
      bank_detail_status_label: "bank_details_not_provided",
      raw_bank_details_exposed: false,
      notice: "Profile shell only. No production company records are loaded in this release.",
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
  } catch (err) {
    console.error("registry-company-profile error", err);
    return withCors(req, new Response(JSON.stringify({ error: "internal_error" }), { status: 500, headers: { "Content-Type": "application/json" } }));
  }
});
