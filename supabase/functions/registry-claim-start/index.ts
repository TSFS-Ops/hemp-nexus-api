// Batch 11 — registry-claim-start
// Creates a claim_started row against a claim-enabled company record.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import {
  REGISTRY_CLAIMANT_TYPES,
  REGISTRY_PROFESSIONAL_REPRESENTATIVE_TYPES,
  REGISTRY_CLAIM_EXPIRY_DAYS,
} from "../_shared/registry-claim-workflow.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const Body = z.object({
  company_record_id: z.string().uuid().optional(),
  company_reference: z.string().min(1).max(120),
  company_name: z.string().min(1).max(200),
  registration_number: z.string().max(60).optional(),
  country_code: z.string().min(2).max(8),
  company_legal_form: z.enum([
    "sole_proprietor",
    "private_company",
    "close_corporation",
    "corporate_shareholder",
    "third_party_representative",
    "other",
  ]),
  claimant_type: z.enum(REGISTRY_CLAIMANT_TYPES as unknown as [string, ...string[]]),
  claimant_name: z.string().min(1).max(120),
  claimant_email: z.string().email().max(200),
  claimant_role: z.string().min(1).max(120),
  company_relationship: z.string().min(1).max(120),
  company_email_domain: z.string().max(120).optional(),
});

Deno.serve(async (req) => {
  const pre = handleCorsPreflight(req);
  if (pre) return pre;
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes } = await userClient.auth.getUser();
    const user = userRes?.user;
    if (!user) {
      return withCors(req, new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }));
    }
    if (!user.email_confirmed_at) {
      return withCors(req, new Response(JSON.stringify({ error: "email_verification_required" }), { status: 403 }));
    }
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) {
      return withCors(req, new Response(JSON.stringify({ error: "invalid_body", details: parsed.error.flatten() }), { status: 400 }));
    }
    const input = parsed.data;
    const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    // Best-effort claim availability check
    if (input.company_record_id) {
      const { data: rec } = await svc
        .from("registry_company_records")
        .select("claim_activation_state, lifecycle_state")
        .eq("id", input.company_record_id)
        .maybeSingle();
      if (rec && rec.claim_activation_state !== "claim_enabled") {
        return withCors(req, new Response(JSON.stringify({ error: "claim_not_available", reason: "Information under review" }), { status: 409 }));
      }
    }

    const isProRep = REGISTRY_PROFESSIONAL_REPRESENTATIVE_TYPES.includes(input.claimant_type as never);
    const expires = new Date(Date.now() + REGISTRY_CLAIM_EXPIRY_DAYS.draft * 24 * 60 * 60 * 1000).toISOString();

    const { data: row, error } = await svc
      .from("registry_company_claims")
      .insert({
        claimant_user_id: user.id,
        company_reference: input.company_reference,
        company_name: input.company_name,
        registration_number: input.registration_number ?? null,
        country_code: input.country_code,
        claimant_name: input.claimant_name,
        claimant_email: input.claimant_email,
        claimant_role: input.claimant_role,
        company_relationship: input.company_relationship,
        company_email_domain: input.company_email_domain ?? null,
        claimant_type: input.claimant_type,
        company_legal_form: input.company_legal_form,
        is_professional_representative: isProRep,
        status: "claim_started",
        workflow_status: "claim_started",
        expires_at: expires,
      })
      .select("id")
      .single();
    if (error) {
      return withCors(req, new Response(JSON.stringify({ error: "db_error", message: error.message }), { status: 500 }));
    }

    await svc.from("registry_company_claim_events").insert({
      claim_id: row.id,
      audit_event_name: "registry_claim_started",
      actor_user_id: user.id,
      new_status: "claim_started",
    });
    await svc.from("audit_logs").insert({
      action: "registry_claim_started",
      actor_user_id: user.id,
      metadata: { claim_id: row.id, claimant_type: input.claimant_type, company_legal_form: input.company_legal_form },
    });

    return withCors(req, new Response(JSON.stringify({ claim_id: row.id, status: "claim_started" }), { status: 200, headers: { "Content-Type": "application/json" } }));
  } catch (e) {
    return withCors(req, new Response(JSON.stringify({ error: "internal", message: (e as Error).message }), { status: 500 }));
  }
});
