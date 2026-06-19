/**
 * facilitation-case-search-organisations — Batch 6.
 *
 * Allows platform_admin, compliance_analyst, or the assigned case owner
 * to search the organisations table when linking a facilitation case to
 * an existing organisation. No org creation, no merging — read only.
 */
import { createClient } from "npm:@supabase/supabase-js@2.39.3";
import { z } from "npm:zod@3.23.8";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import { handleHealthProbe } from "../_shared/health.ts";

const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(req: Request, body: unknown, status = 200) {
  return withCors(req, new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }));
}

const BodySchema = z.object({
  case_id: z.string().uuid(),
  query: z.string().trim().min(1).max(200),
  limit: z.number().int().positive().max(25).optional(),
});

Deno.serve(async (req) => {
  const pf = handleCorsPreflight(req);
  if (pf) return pf;
  const __hp = handleHealthProbe(req, "facilitation-case-search-organisations");
  if (__hp) return __hp;
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json(req, { error: "Unauthorized" }, 401);

  const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const token = authHeader.replace("Bearer ", "");
  const { data: claims, error: cerr } = await userClient.auth.getClaims(token);
  if (cerr || !claims?.claims?.sub) return json(req, { error: "Unauthorized" }, 401);
  const userId = claims.claims.sub as string;

  let parsed;
  try { parsed = BodySchema.safeParse(await req.json()); } catch { return json(req, { error: "Invalid JSON" }, 400); }
  if (!parsed.success) return json(req, { error: "Validation failed" }, 400);

  const admin = createClient(url, service, { auth: { persistSession: false } });

  const { data: kase } = await admin.from("facilitation_cases").select("case_owner_id").eq("id", parsed.data.case_id).maybeSingle();
  if (!kase) return json(req, { error: "Not found" }, 404);

  async function hasRole(role: string): Promise<boolean> {
    const { data } = await admin.rpc("has_role", { _user_id: userId, _role: role });
    return !!data;
  }
  const isPlatformAdmin = await hasRole("platform_admin");
  const isComplianceAnalyst = await hasRole("compliance_analyst");
  const isOwner = (kase as { case_owner_id: string | null }).case_owner_id === userId;
  if (!(isPlatformAdmin || isComplianceAnalyst || isOwner)) return json(req, { error: "Forbidden" }, 403);

  const q = parsed.data.query.replace(/[%_]/g, (m) => "\\" + m);
  const limit = parsed.data.limit ?? 10;
  const { data, error } = await admin
    .from("organizations")
    .select("id,name,legal_name,registration_number,jurisdictions,status")
    .or(`name.ilike.%${q}%,legal_name.ilike.%${q}%,registration_number.ilike.%${q}%`)
    .limit(limit);
  if (error) return json(req, { error: error.message }, 500);

  return json(req, { organisations: data ?? [] });
});
