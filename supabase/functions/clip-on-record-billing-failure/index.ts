// Durable capture of clip-on billing failures.
//
// The reviewer-pickup status update fails atomically when
// bill_clip_on_request raises P0541 (CLIP_ON_INSUFFICIENT_CREDITS) or any
// other billing error. Because the client cannot call
// record_clip_on_billing_failure directly (EXECUTE revoked from
// authenticated), this edge function performs that write under the
// service role after verifying the caller is a platform admin.
//
// Contract:
//   POST { request_id: uuid, reason: { code: string, message?: string,
//          credits_required?: number, current_balance?: number, ... } }
//   -> 200 { ok: true }   on success
//   -> 401 { error }      missing/invalid JWT
//   -> 403 { error }      not a platform admin
//   -> 400 { error }      validation failed
//
// The function is deliberately small and idempotent-safe: callers may
// invoke it multiple times for the same request_id; each call appends a
// new row to clip_on_billing_failures (an append-only failure ledger).
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";

const corsHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

function json(req: Request, status: number, body: Record<string, unknown>) {
  return withCors(req, new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  }));
}

function isUuid(v: unknown): v is string {
  return typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

Deno.serve(async (req) => {
  const __pf = handleCorsPreflight(req);
  if (__pf) return __pf;
  if (req.method !== "POST") return json(req, 405, { error: "method_not_allowed" });

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return json(req, 401, { error: "missing_bearer_token" });
  }

  // Verify the caller and check role using the user's JWT.
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return json(req, 401, { error: "invalid_token" });
  const userId = userData.user.id;

  const { data: roleRow, error: roleErr } = await userClient
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "platform_admin")
    .maybeSingle();
  if (roleErr) return json(req, 500, { error: "role_check_failed" });
  if (!roleRow) return json(req, 403, { error: "not_platform_admin" });

  let body: { request_id?: unknown; reason?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(req, 400, { error: "invalid_json" });
  }

  if (!isUuid(body.request_id)) {
    return json(req, 400, { error: "invalid_request_id" });
  }
  const reason =
    body.reason && typeof body.reason === "object" && !Array.isArray(body.reason)
      ? (body.reason as Record<string, unknown>)
      : { code: "UNKNOWN", message: "no reason supplied" };

  // Service-role write so the helper RPC executes despite the lockdown
  // grants on record_clip_on_billing_failure.
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // Stamp the actor for the audit_logs insert inside the helper. The
  // helper uses auth.uid(), which under service role is null — so we
  // also append an explicit audit_logs row with the real actor.
  const { error: rpcErr } = await admin.rpc("record_clip_on_billing_failure", {
    p_request_id: body.request_id,
    p_reason: reason,
  });
  if (rpcErr) {
    console.error("[clip-on-record-billing-failure] rpc failed", rpcErr);
    return json(req, 500, { error: "record_failed", detail: rpcErr.message });
  }

  // Best-effort: enrich the audit trail with the human actor (the helper
  // wrote one under auth.uid()=null when called via service role).
  try {
    const { data: req2 } = await admin
      .from("operator_verification_requests")
      .select("org_id")
      .eq("id", body.request_id)
      .maybeSingle();
    if (req2?.org_id) {
      await admin.from("audit_logs").insert([{
        org_id: req2.org_id,
        actor_user_id: userId,
        action: "clip_on.request_charge_failed.actor",
        entity_type: "operator_verification_request",
        entity_id: body.request_id,
        metadata: reason,
      }]);
    }
  } catch (e) {
    console.warn("[clip-on-record-billing-failure] actor audit append failed", e);
  }

  return json(req, 200, { ok: true });
});
