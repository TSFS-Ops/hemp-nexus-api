/**
 * get-facilitation-case — Phase 1 detail view.
 * Returns case + events + evidence metadata. RLS gates visibility.
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

const BodySchema = z.object({ case_id: z.string().uuid() });

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

  let parsed;
  try { parsed = BodySchema.safeParse(await req.json()); } catch { return json(req, { error: "Invalid JSON" }, 400); }
  if (!parsed.success) return json(req, { error: "Validation failed" }, 400);

  // RLS-bound user client filters automatically.
  const { data: kase, error: kerr } = await userClient.from("facilitation_cases").select("*").eq("id", parsed.data.case_id).maybeSingle();
  if (kerr) return json(req, { error: kerr.message }, 500);
  if (!kase) return json(req, { error: "Not found" }, 404);

  const { data: events } = await userClient.from("facilitation_case_events")
    .select("*").eq("case_id", parsed.data.case_id).order("created_at", { ascending: true });
  const { data: evidence } = await userClient.from("facilitation_case_evidence")
    .select("*").eq("case_id", parsed.data.case_id).order("created_at", { ascending: true });

  return json(req, { case: kase, events: events ?? [], evidence: evidence ?? [] });
});
