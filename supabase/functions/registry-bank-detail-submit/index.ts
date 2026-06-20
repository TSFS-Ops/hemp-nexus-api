// Batch 4 — M006 Consent-based bank-detail capture.
// Capture is BLOCKED unless the linked authority request is in
// approved or conditionally_approved state. Captured submissions always
// land in status `captured_unverified` — capture alone is never verification.
//
// Canonical user-facing copy (pinned by check-registry-batch4-wording.mjs):
//   "Captured bank details are not verified bank details. They must not be treated as verified unless the status is explicitly marked verified with a valid audit trail and expiry."
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import {
  REGISTRY_BANK_DETAIL_CONSENT_SCOPES,
  REGISTRY_BANK_DETAIL_CAPTURED_NOT_VERIFIED_COPY,
  maskAccountToken,
  obfuscate,
} from "../_shared/registry-bank-details.ts";
import { REGISTRY_AUTHORITY_APPROVED_STATES } from "../_shared/registry-authority.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const BodySchema = z.object({
  authority_request_id: z.string().uuid(),
  claim_id: z.string().uuid().optional(),
  company_reference: z.string().min(1).max(120),
  company_name: z.string().min(1).max(200),
  country_code: z.string().min(2).max(8),
  currency_code: z.string().min(3).max(8),
  account_type: z.string().max(40).optional(),
  account_holder_name: z.string().min(1).max(200),
  bank_name: z.string().min(1).max(200),
  account_number: z.string().min(1).max(64).optional(),
  iban: z.string().min(1).max(64).optional(),
  branch_code: z.string().max(40).optional(),
  swift_bic: z.string().max(40).optional(),
  consent_scopes: z.array(z.enum(REGISTRY_BANK_DETAIL_CONSENT_SCOPES)).min(1),
  acknowledged_captured_not_verified: z.literal(true),
});

Deno.serve(async (req) => {
  const pre = handleCorsPreflight(req);
  if (pre) return pre;
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: userRes } = await userClient.auth.getUser();
    const user = userRes?.user;
    if (!user) return withCors(req, new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } }));

    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) return withCors(req, new Response(JSON.stringify({ error: "invalid_body", details: parsed.error.flatten() }), { status: 400, headers: { "Content-Type": "application/json" } }));
    const input = parsed.data;
    if (!input.account_number && !input.iban) {
      return withCors(req, new Response(JSON.stringify({ error: "missing_account_identifier" }), { status: 400, headers: { "Content-Type": "application/json" } }));
    }

    const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    // Verify authority is approved or conditionally_approved.
    const { data: auth } = await svc.from("registry_authority_requests")
      .select("id, status, requester_user_id").eq("id", input.authority_request_id).maybeSingle();
    if (!auth || auth.requester_user_id !== user.id) {
      return withCors(req, new Response(JSON.stringify({ error: "authority_not_found" }), { status: 404, headers: { "Content-Type": "application/json" } }));
    }
    if (!REGISTRY_AUTHORITY_APPROVED_STATES.includes(auth.status as never)) {
      return withCors(req, new Response(JSON.stringify({ error: "authority_not_approved", current: auth.status }), { status: 403, headers: { "Content-Type": "application/json" } }));
    }

    const { data: row, error } = await svc.from("registry_bank_detail_submissions").insert({
      submitter_user_id: user.id,
      claim_id: input.claim_id ?? null,
      authority_request_id: input.authority_request_id,
      company_reference: input.company_reference,
      company_name: input.company_name,
      country_code: input.country_code,
      currency_code: input.currency_code,
      account_type: input.account_type ?? null,
      enc_account_holder_name: obfuscate(input.account_holder_name),
      enc_bank_name: obfuscate(input.bank_name),
      enc_account_number: input.account_number ? obfuscate(input.account_number) : null,
      enc_branch_code: input.branch_code ? obfuscate(input.branch_code) : null,
      enc_swift_bic: input.swift_bic ? obfuscate(input.swift_bic) : null,
      enc_iban: input.iban ? obfuscate(input.iban) : null,
      masked_account_holder: input.account_holder_name.slice(0, 1) + "•••",
      masked_bank_name: input.bank_name,
      masked_account_number: input.account_number ? maskAccountToken(input.account_number) : null,
      masked_branch_code: input.branch_code ? maskAccountToken(input.branch_code) : null,
      masked_swift_bic: input.swift_bic ? maskAccountToken(input.swift_bic) : null,
      masked_iban: input.iban ? maskAccountToken(input.iban) : null,
      status: "captured_unverified",
    }).select("id").single();
    if (error) throw error;

    // Consent receipts (one per scope).
    for (const scope of input.consent_scopes) {
      await svc.from("registry_bank_detail_consent_receipts").insert({
        submission_id: row.id,
        consent_scope: scope,
        consent_granted: true,
        granted_by: user.id,
        consent_text: REGISTRY_BANK_DETAIL_CAPTURED_NOT_VERIFIED_COPY,
      });
      await svc.from("registry_bank_detail_events").insert({
        submission_id: row.id,
        audit_event_name: "registry_bank_detail_consent_recorded",
        previous_status: null,
        new_status: null,
        actor_id: user.id,
        payload: { scope },
      });
    }

    for (const ev of ["registry_bank_detail_capture_started","registry_bank_detail_submitted","registry_bank_detail_status_changed"]) {
      await svc.from("registry_bank_detail_events").insert({
        submission_id: row.id,
        audit_event_name: ev,
        previous_status: ev === "registry_bank_detail_status_changed" ? "not_provided" : null,
        new_status: ev === "registry_bank_detail_status_changed" ? "captured_unverified" : null,
        actor_id: user.id,
        payload: { authority_request_id: input.authority_request_id },
      });
      await svc.from("event_store").insert({
        event_name: ev,
        aggregate_id: row.id,
        aggregate_type: "registry_bank_detail_submission",
        actor_id: user.id,
        payload: { authority_request_id: input.authority_request_id },
      }).catch(() => {});
    }

    return withCors(req, new Response(JSON.stringify({
      ok: true,
      submission_id: row.id,
      status: "captured_unverified",
      message: REGISTRY_BANK_DETAIL_CAPTURED_NOT_VERIFIED_COPY,
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
  } catch (err) {
    console.error("registry-bank-detail-submit error", err);
    return withCors(req, new Response(JSON.stringify({ error: "internal_error" }), { status: 500, headers: { "Content-Type": "application/json" } }));
  }
});
