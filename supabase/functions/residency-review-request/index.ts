// DATA-009 Phase 2 — residency-review-request
// Authenticated org user submits a residency requirement. Routes via the
// service_role SECDEF RPC `request_residency_review`. No technical
// hosting / region / backup / export / deletion behaviour is created.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { corsHeaders as __buildCorsHeaders, handleCors as __handleCors } from "../_shared/corsHeaders.ts";

const Body = z.object({
  requirement_source: z.string().min(3).max(200),
  requested_region: z.string().min(2).max(80).optional().nullable(),
  requested_country: z.string().min(2).max(80).optional().nullable(),
  legal_basis: z.string().max(2000).optional().nullable(),
}).strict();

Deno.serve(async (req) => {
  const corsHeaders = __buildCorsHeaders(Deno.env.get("ALLOWED_ORIGINS") || "", req.headers.get("origin"));
  function json(b: unknown, s = 200) {
    return new Response(JSON.stringify(b), {
      status: s,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const __pf = __handleCors(req, Deno.env.get("ALLOWED_ORIGINS") || "");
  if (__pf) return __pf;
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const URL = Deno.env.get("SUPABASE_URL")!;
  const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return json({ error: "unauthorized", code: "UNAUTHENTICATED" }, 401);
  }

  const userClient = createClient(URL, ANON, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: u } = await userClient.auth.getUser();
  if (!u?.user) return json({ error: "unauthorized" }, 401);

  let raw: unknown;
  try { raw = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) return json({ error: "invalid_body", details: parsed.error.flatten() }, 400);

  const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });
  const { data: profile, error: profErr } = await admin
    .from("profiles").select("org_id").eq("id", u.user.id).maybeSingle();
  if (profErr || !profile?.org_id) {
    return json({ error: "no_org_for_user", code: "NO_ORG" }, 403);
  }

  const { data, error } = await admin.rpc("request_residency_review", {
    p_org_id: profile.org_id,
    p_requirement_source: parsed.data.requirement_source,
    p_requested_region: parsed.data.requested_region ?? null,
    p_requested_country: parsed.data.requested_country ?? null,
    p_legal_basis: parsed.data.legal_basis ?? null,
    p_metadata: { requested_by: u.user.id },
  });
  if (error) {
    console.error("[residency-review-request] rpc failed:", error);
    return json({ error: "rpc_failed", message: error.message }, 500);
  }
  return json({ ok: true, code: "RESIDENCY_REVIEW_PENDING", ...(data ?? {}) }, 200);
});
