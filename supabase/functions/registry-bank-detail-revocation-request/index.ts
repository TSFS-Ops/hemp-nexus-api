// Batch 13 — User-driven revocation request for an existing bank-detail
// submission. Requires active `bank_detail_revocation_request` scope.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import { REGISTRY_AUTHORITY_APPROVED_STATES } from "../_shared/registry-authority.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const BodySchema = z.object({
  submission_id: z.string().uuid(),
  authority_request_id: z.string().uuid(),
  reason: z.string().min(10).max(2000),
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
    if (!parsed.success) return json(req, { error: "invalid_body" }, 400);
    const input = parsed.data;

    const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    const { data: auth } = await svc.from("registry_authority_requests")
      .select("id, status, requester_user_id, requested_scopes, expiry_at, revoked_at, disputed_at")
      .eq("id", input.authority_request_id).maybeSingle();
    if (!auth || auth.requester_user_id !== user.id) return json(req, { error: "authority_not_found" }, 404);
    if (!REGISTRY_AUTHORITY_APPROVED_STATES.includes(auth.status as never)) return json(req, { error: "authority_not_approved" }, 403);
    if (auth.revoked_at) return json(req, { error: "authority_revoked" }, 403);
    if (auth.disputed_at) return json(req, { error: "authority_disputed" }, 403);
    if (auth.expiry_at && new Date(auth.expiry_at).getTime() < Date.now()) return json(req, { error: "authority_expired" }, 403);

    const scopes: string[] = Array.isArray(auth.requested_scopes) ? auth.requested_scopes : [];
    if (!scopes.includes("bank_detail_revocation_request")) {
      return json(req, { error: "scope_missing", required: "bank_detail_revocation_request" }, 403);
    }

    const { data: sub } = await svc.from("registry_bank_detail_submissions")
      .select("id, submitter_user_id, b13_status").eq("id", input.submission_id).maybeSingle();
    if (!sub) return json(req, { error: "not_found" }, 404);

    await svc.from("registry_bank_detail_submissions").update({
      b13_status: "revocation_requested",
      revocation_requested_at: new Date().toISOString(),
    }).eq("id", input.submission_id);

    await svc.from("registry_bank_detail_events").insert({
      submission_id: input.submission_id,
      audit_event_name: "registry_bank_detail_revocation_requested",
      previous_status: sub.b13_status, new_status: "revocation_requested",
      reason: input.reason, actor_id: user.id, payload: { authority_request_id: input.authority_request_id },
    });
    await svc.from("event_store").insert({
      event_name: "registry_bank_detail_revocation_requested",
      aggregate_id: input.submission_id, aggregate_type: "registry_bank_detail_submission",
      actor_id: user.id, payload: { reason: input.reason },
    }).catch(() => {});

    return json(req, { ok: true, b13_status: "revocation_requested" });
  } catch (err) {
    console.error("registry-bank-detail-revocation-request error", err);
    return json(req, { error: "internal_error" }, 500);
  }
});
