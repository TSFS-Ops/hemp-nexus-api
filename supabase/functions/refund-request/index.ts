// DEC-007 — Client refund request.
// Org members request a refund for a token_purchase they own.
// Performs server-side classification (within-window, expired, all-burned)
// and emits the appropriate canonical audit via the request_refund RPC.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { corsHeaders as __buildCorsHeaders, handleCors as __handleCors } from "../_shared/cors.ts";

const BodySchema = z.object({
  token_purchase_id: z.string().uuid(),
  reason_code: z.enum([
    "unused_within_window",
    "unused_outside_window",
    "accidental_purchase",
    "duplicate_purchase",
    "service_dissatisfaction",
    "other",
  ]),
  reason_detail: z.string().trim().min(20).max(2000),
}).strict();

Deno.serve(async (req) => {
  const corsHeaders = __buildCorsHeaders(Deno.env.get("ALLOWED_ORIGINS") || "", req.headers.get("origin"));
  const __pf = __handleCors(req, Deno.env.get("ALLOWED_ORIGINS") || "");
  if (__pf) return __pf;
  function json(b: unknown, s = 200) {
    return new Response(JSON.stringify(b), {
      status: s,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

  const userClient = createClient(SUPABASE_URL, ANON, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: u, error: uerr } = await userClient.auth.getUser();
  if (uerr || !u?.user) return json({ error: "unauthorized" }, 401);

  let raw: unknown;
  try { raw = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }
  const p = BodySchema.safeParse(raw);
  if (!p.success) {
    return json({
      error: "invalid_body",
      code: p.error.flatten().fieldErrors.reason_detail ? "REASON_REQUIRED" : "INVALID_BODY",
      details: p.error.flatten().fieldErrors,
    }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Resolve caller's org_id via profile
  const { data: profile } = await admin
    .from("profiles").select("org_id").eq("id", u.user.id).maybeSingle();
  const orgId = profile?.org_id;
  if (!orgId) return json({ error: "no_org", code: "NO_ORG" }, 400);

  const { data: result, error } = await admin.rpc("request_refund", {
    p_org_id: orgId,
    p_user_id: u.user.id,
    p_token_purchase_id: p.data.token_purchase_id,
    p_reason_code: p.data.reason_code,
    p_reason_detail: p.data.reason_detail,
  });
  if (error) {
    console.error("[refund-request] rpc error", error);
    return json({ error: "rpc_failed", message: error.message }, 500);
  }
  const r = result as { success?: boolean; code?: string; status?: string };
  if (!r?.success) {
    const code = r?.code ?? "REFUND_FAILED";
    const status = code === "REASON_REQUIRED" ? 400
      : code === "PURCHASE_NOT_FOUND" ? 404
      : code === "REFUND_ALREADY_PENDING" ? 409
      : 400;
    return json({ error: code.toLowerCase(), code, details: r }, status);
  }
  // DEC-007 retest fix — when the RPC persists a blocked outcome
  // (credits already burned / refund window expired) it still returns
  // success=true with a status of 'blocked_credits_used' / 'blocked_expired'.
  // From the caller's perspective this is NOT a successful refund request
  // — surface it as a hard failure with a stable code so the dialog can
  // render a persistent inline alert instead of a misleading
  // "submitted for review" toast.
  if (r.status === "blocked_credits_used") {
    return json({
      error: "blocked_credits_used",
      code: "BLOCKED_CREDITS_USED",
      message:
        "Credits from this purchase have already been used, so a refund cannot be requested.",
      details: r,
    }, 409);
  }
  if (r.status === "blocked_expired") {
    return json({
      error: "blocked_expired",
      code: "BLOCKED_EXPIRED",
      message:
        "This purchase is outside the refund window and cannot be refunded.",
      details: r,
    }, 409);
  }
  return json(r, 200);
});
