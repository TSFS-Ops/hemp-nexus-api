/**
 * list-facilitation-cases — Phase 1 queue listing.
 *
 * - Regular users see their org's cases (RLS).
 * - platform_admin / admin / compliance_analyst see all cases (RLS).
 * Supports filters: status, urgency, assigned_to_me, q (case_number prefix).
 */
import { createClient } from "npm:@supabase/supabase-js@2.39.3";
import { z } from "npm:zod@3.23.8";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";

const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(req: Request, body: unknown, status = 200) {
  return withCors(req, new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }));
}

const BodySchema = z.object({
  status: z.string().trim().max(64).nullable().optional(),
  urgency: z.enum(["low", "normal", "high", "critical"]).nullable().optional(),
  assigned_to_me: z.boolean().nullable().optional(),
  overdue_only: z.boolean().nullable().optional(),
  q: z.string().trim().max(64).nullable().optional(),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).max(10000).default(0),
});

Deno.serve(async (req) => {
  const pf = handleCorsPreflight(req);
  if (pf) return pf;
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json(req, { error: "Unauthorized" }, 401);
  const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const token = authHeader.replace("Bearer ", "");
  const { data: claims, error: cerr } = await userClient.auth.getClaims(token);
  if (cerr || !claims?.claims?.sub) return json(req, { error: "Unauthorized" }, 401);
  const userId = claims.claims.sub as string;

  let parsed;
  try { parsed = BodySchema.safeParse(await req.json().catch(() => ({}))); } catch { return json(req, { error: "Invalid JSON" }, 400); }
  if (!parsed.success) return json(req, { error: "Validation failed", details: parsed.error.flatten() }, 400);

  let q = userClient.from("facilitation_cases").select("*", { count: "exact" }).order("created_at", { ascending: false });
  if (parsed.data.status) q = q.eq("internal_status", parsed.data.status);
  if (parsed.data.urgency) q = q.eq("urgency", parsed.data.urgency);
  if (parsed.data.assigned_to_me) q = q.eq("case_owner_id", userId);
  if (parsed.data.q) q = q.ilike("case_number", `${parsed.data.q}%`);
  q = q.range(parsed.data.offset, parsed.data.offset + parsed.data.limit - 1);

  const { data, error, count } = await q;
  if (error) return json(req, { error: error.message }, 500);
  return json(req, { cases: data ?? [], total: count ?? 0 });
});
