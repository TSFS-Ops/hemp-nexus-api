// Batch 4 + Batch 13 — M006 Consent-based bank-detail capture.
// Batch 13 hardening:
//   - email_confirmed_at required
//   - active authority must include `bank_detail_submission` (or
//     `bank_detail_update` for replacement); revoked/disputed/expired blocked
//   - country-specific required fields enforced via SSOT
//   - declaration_acknowledged required
//   - account fingerprint computed; duplicate fingerprint on another
//     company surfaces a duplicate event for risk-evaluation
//   - b13_status seeded to `submitted` (Batch 4 `status` stays
//     `captured_unverified` as before for the legacy state model)
//
// Canonical user-facing copy (pinned by check-registry-batch4-wording.mjs):
//   "Captured bank details are not verified bank details. They must not be
//    treated as verified unless the status is explicitly marked verified with
//    a valid audit trail and expiry."
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import {
  REGISTRY_BANK_DETAIL_CONSENT_SCOPES,
  REGISTRY_BANK_DETAIL_CAPTURED_NOT_VERIFIED_COPY,
  maskAccountToken,
  obfuscate,
} from "../_shared/registry-bank-details.ts";
import {
  computeAccountFingerprintSha256,
  findMissingBankFields,
  REGISTRY_BANK_DETAIL_B13_HOLDER_KINDS,
  REGISTRY_BANK_DETAIL_B13_CONSENT_SCOPES,
  REGISTRY_BANK_DETAIL_B13_CONSENT_WORDING,
} from "../_shared/registry-bank-details-b13.ts";
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
  bank_code: z.string().max(40).optional(),
  routing_number: z.string().max(40).optional(),
  sort_code: z.string().max(40).optional(),
  branch_name: z.string().max(120).optional(),
  bank_country_code: z.string().max(8).optional(),
  bank_purpose: z.string().max(200).optional(),
  account_holder_kind: z.enum(REGISTRY_BANK_DETAIL_B13_HOLDER_KINDS).default("company"),
  is_third_party: z.boolean().default(false),
  is_primary_account: z.boolean().default(true),
  intermediary_admin_meta: z.record(z.unknown()).optional(),
  consent_scopes: z.array(z.enum(REGISTRY_BANK_DETAIL_CONSENT_SCOPES)).min(1),
  b13_consent_scopes: z.array(z.enum(REGISTRY_BANK_DETAIL_B13_CONSENT_SCOPES)).optional(),
  acknowledged_captured_not_verified: z.literal(true),
  declaration_acknowledged: z.literal(true),
  intended_action: z.enum(["submit", "update"]).default("submit"),
});

function json(req: Request, body: unknown, status = 200): Response {
  return withCors(req, new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

Deno.serve(async (req) => {
  const pre = handleCorsPreflight(req);
  if (pre) return pre;
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: userRes } = await userClient.auth.getUser();
    const user = userRes?.user;
    if (!user) return json(req, { error: "unauthorized" }, 401);
    if (!user.email_confirmed_at) return json(req, { error: "email_not_verified" }, 403);

    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) return json(req, { error: "invalid_body", details: parsed.error.flatten() }, 400);
    const input = parsed.data;
    if (!input.account_number && !input.iban) {
      return json(req, { error: "missing_account_identifier" }, 400);
    }

    // Country-specific field requirements (Batch 13 SSOT).
    const missing = findMissingBankFields(input.country_code, input as unknown as Record<string, unknown>);
    if (missing.length) {
      return json(req, { error: "missing_required_country_fields", missing, country: input.country_code }, 400);
    }

    const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    // Active-authority scope check (Batch 13).
    const { data: auth } = await svc.from("registry_authority_requests")
      .select("id, status, requester_user_id, requested_scopes, expiry_at, revoked_at, disputed_at")
      .eq("id", input.authority_request_id).maybeSingle();
    if (!auth || auth.requester_user_id !== user.id) {
      return json(req, { error: "authority_not_found" }, 404);
    }
    if (!REGISTRY_AUTHORITY_APPROVED_STATES.includes(auth.status as never)) {
      return json(req, { error: "authority_not_approved", current: auth.status }, 403);
    }
    if (auth.revoked_at) return json(req, { error: "authority_revoked" }, 403);
    if (auth.disputed_at) return json(req, { error: "authority_disputed" }, 403);
    if (auth.expiry_at && new Date(auth.expiry_at).getTime() < Date.now()) {
      return json(req, { error: "authority_expired" }, 403);
    }
    const scopes: string[] = Array.isArray(auth.requested_scopes) ? auth.requested_scopes : [];
    const requiredScope = input.intended_action === "update" ? "bank_detail_update" : "bank_detail_submission";
    if (!scopes.includes(requiredScope)) {
      return json(req, { error: "scope_missing", required: requiredScope, present: scopes }, 403);
    }

    const fingerprint = await computeAccountFingerprintSha256({
      countryCode: input.bank_country_code ?? input.country_code,
      bankCode: input.bank_code ?? null,
      branchCode: input.branch_code ?? null,
      accountNumber: input.account_number ?? null,
      iban: input.iban ?? null,
    });

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
      account_number_last4: input.account_number ? input.account_number.slice(-4) : null,
      account_fingerprint: fingerprint,
      account_holder_kind: input.account_holder_kind,
      is_third_party: input.is_third_party,
      is_primary_account: input.is_primary_account,
      bank_purpose: input.bank_purpose ?? null,
      bank_country_code: input.bank_country_code ?? input.country_code,
      bank_code: input.bank_code ?? null,
      routing_number: input.routing_number ?? null,
      sort_code: input.sort_code ?? null,
      branch_name: input.branch_name ?? null,
      intermediary_admin_meta: input.intermediary_admin_meta ?? {},
      declaration_acknowledged: true,
      status: "captured_unverified",
      b13_status: "submitted",
    }).select("id").single();
    if (error) throw error;

    // Consent receipts (legacy Batch 4 scopes + optional Batch 13 scopes).
    const allConsentScopes: { scope: string; wording: string }[] = [
      ...input.consent_scopes.map((s) => ({ scope: s, wording: REGISTRY_BANK_DETAIL_CAPTURED_NOT_VERIFIED_COPY })),
      ...(input.b13_consent_scopes ?? []).map((s) => ({ scope: s, wording: REGISTRY_BANK_DETAIL_B13_CONSENT_WORDING })),
    ];
    for (const c of allConsentScopes) {
      await svc.from("registry_bank_detail_consent_receipts").insert({
        submission_id: row.id, consent_scope: c.scope, consent_granted: true, granted_by: user.id, consent_text: c.wording,
      });
      await svc.from("registry_bank_detail_events").insert({
        submission_id: row.id,
        audit_event_name: "registry_bank_detail_consent_accepted",
        previous_status: null, new_status: null, actor_id: user.id, payload: { scope: c.scope },
      });
    }

    for (const ev of [
      "registry_bank_detail_capture_started",
      "registry_bank_detail_submitted",
      "registry_bank_detail_status_changed",
    ]) {
      await svc.from("registry_bank_detail_events").insert({
        submission_id: row.id,
        audit_event_name: ev,
        previous_status: ev === "registry_bank_detail_status_changed" ? "not_provided" : null,
        new_status: ev === "registry_bank_detail_status_changed" ? "captured_unverified" : null,
        actor_id: user.id,
        payload: { authority_request_id: input.authority_request_id, b13_status: "submitted" },
      });
      await svc.from("event_store").insert({
        event_name: ev, aggregate_id: row.id, aggregate_type: "registry_bank_detail_submission",
        actor_id: user.id, payload: { authority_request_id: input.authority_request_id },
      }).catch(() => {});
    }

    // Duplicate fingerprint detection on insert (just-in-time).
    const { data: dupes } = await svc.from("registry_bank_detail_submissions")
      .select("id, company_reference").eq("account_fingerprint", fingerprint).neq("id", row.id).limit(5);
    if (dupes && dupes.some((d: { company_reference: string }) => d.company_reference !== input.company_reference)) {
      await svc.from("registry_bank_detail_events").insert({
        submission_id: row.id, audit_event_name: "registry_bank_detail_duplicate_fingerprint_detected",
        previous_status: null, new_status: null, actor_id: user.id, payload: { matches: dupes.length },
      });
      await svc.from("registry_bank_detail_risk_flags").insert({
        submission_id: row.id, flag_type: "duplicate_fingerprint_on_other_company",
        risk_level: "high", details: { matches: dupes.length }, raised_by: user.id,
      }).catch(() => {});
      await svc.from("registry_bank_detail_submissions").update({ risk_level: "high" }).eq("id", row.id);
    }

    return json(req, {
      ok: true,
      submission_id: row.id,
      status: "captured_unverified",
      b13_status: "submitted",
      verified: false,
      message: REGISTRY_BANK_DETAIL_CAPTURED_NOT_VERIFIED_COPY,
      consent_wording: REGISTRY_BANK_DETAIL_B13_CONSENT_WORDING,
    });
  } catch (err) {
    console.error("registry-bank-detail-submit error", err);
    return json(req, { error: "internal_error" }, 500);
  }
});
