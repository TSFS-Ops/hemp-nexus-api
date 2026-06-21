// Batch 13 — Create a draft bank-detail submission.
// Requires authenticated + verified-email user with an ACTIVE authority
// holding the `bank_detail_submission` scope (or `bank_detail_update` when
// reopening). Draft rows are pre-submit only; they hold no bank fields.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import {
  REGISTRY_BANK_DETAIL_B13_AUTHORITY_SCOPES,
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
  intended_action: z.enum(["submit", "update", "revoke"]).default("submit"),
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

    const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return json(req, { error: "invalid_body", details: parsed.error.flatten() }, 400);
    const input = parsed.data;

    const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    const { data: auth } = await svc.from("registry_authority_requests")
      .select("id, status, requester_user_id, requested_scopes, expiry_at, revoked_at, disputed_at")
      .eq("id", input.authority_request_id).maybeSingle();
    if (!auth || auth.requester_user_id !== user.id) return json(req, { error: "authority_not_found" }, 404);
    if (!REGISTRY_AUTHORITY_APPROVED_STATES.includes(auth.status as never)) {
      return json(req, { error: "authority_not_approved", current: auth.status }, 403);
    }
    if (auth.revoked_at) return json(req, { error: "authority_revoked" }, 403);
    if (auth.disputed_at) return json(req, { error: "authority_disputed" }, 403);
    if (auth.expiry_at && new Date(auth.expiry_at).getTime() < Date.now()) {
      return json(req, { error: "authority_expired" }, 403);
    }

    const scopes: string[] = Array.isArray(auth.requested_scopes) ? auth.requested_scopes : [];
    const requiredScope =
      input.intended_action === "submit" ? "bank_detail_submission" :
      input.intended_action === "update" ? "bank_detail_update" :
      "bank_detail_revocation_request";
    if (!REGISTRY_BANK_DETAIL_B13_AUTHORITY_SCOPES.includes(requiredScope as never)) {
      return json(req, { error: "scope_unknown" }, 400);
    }
    if (!scopes.includes(requiredScope)) {
      return json(req, { error: "scope_missing", required: requiredScope, present: scopes }, 403);
    }

    const { data: row, error } = await svc.from("registry_bank_detail_submissions").insert({
      submitter_user_id: user.id,
      claim_id: input.claim_id ?? null,
      authority_request_id: input.authority_request_id,
      company_reference: input.company_reference,
      company_name: input.company_name,
      country_code: input.country_code,
      currency_code: "XXX",
      status: "captured_unverified",
      b13_status: "draft",
    }).select("id").single();
    if (error) throw error;

    await svc.from("registry_bank_detail_events").insert({
      submission_id: row.id,
      audit_event_name: "registry_bank_detail_started",
      previous_status: null,
      new_status: "draft",
      actor_id: user.id,
      payload: { authority_request_id: input.authority_request_id, intended_action: input.intended_action },
    });
    await svc.from("event_store").insert({
      event_name: "registry_bank_detail_started",
      aggregate_id: row.id,
      aggregate_type: "registry_bank_detail_submission",
      actor_id: user.id,
      payload: { intended_action: input.intended_action },
    }).catch(() => {});

    return json(req, { ok: true, submission_id: row.id, b13_status: "draft" });
  } catch (err) {
    console.error("registry-bank-detail-start error", err);
    return json(req, { error: "internal_error" }, 500);
  }
});
