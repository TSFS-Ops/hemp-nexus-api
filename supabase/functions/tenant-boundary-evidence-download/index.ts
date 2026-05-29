/**
 * Tenant-Boundary Evidence Download — Batch 5 · Stage 1
 *
 * platform_admin-only. Returns the sealed manifest JSON for a given run_id.
 * GET ?run_id=<uuid>
 */

// deno-lint-ignore-file no-explicit-any

import { createClient } from "npm:@supabase/supabase-js@2.39.3";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";

const corsHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function jsonResponse(req: Request, body: unknown, status = 200, extra: Record<string,string> = {}) {
  return withCors(
    req,
    new Response(JSON.stringify(body, null, 2), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json", ...extra },
    }),
  );
}

Deno.serve(async (req) => {
  const __pf = handleCorsPreflight(req);
  if (__pf) return __pf;
  if (req.method !== "GET") {
    return jsonResponse(req, { error: "Method not allowed" }, 405);
  }

  const url = new URL(req.url);
  const runId = url.searchParams.get("run_id");
  if (!runId) return jsonResponse(req, { error: "run_id required" }, 400);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorisation");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return jsonResponse(req, { error: "Unauthorised" }, 401);
  }
  const { data: userRes, error: authErr } = await admin.auth.getUser(authHeader.replace("Bearer ", ""));
  if (authErr || !userRes?.user) return jsonResponse(req, { error: "Invalid token" }, 401);

  const { data: hasAdmin } = await admin.rpc("has_role", {
    _user_id: userRes.user.id,
    _role: "platform_admin",
  });
  if (!hasAdmin) return jsonResponse(req, { error: "Platform admin access required" }, 403);

  const { data, error } = await admin
    .from("tenant_boundary_evidence")
    .select("run_id, run_at, run_by, manifest_sha256, schema_hash, status, results")
    .eq("run_id", runId)
    .maybeSingle();
  if (error) return jsonResponse(req, { error: "Query failed", detail: error.message }, 500);
  if (!data)  return jsonResponse(req, { error: "Not found" }, 404);

  return jsonResponse(req, data, 200, {
    "Content-Disposition": `attachment; filename="tenant-boundary-${runId}.json"`,
  });
});
