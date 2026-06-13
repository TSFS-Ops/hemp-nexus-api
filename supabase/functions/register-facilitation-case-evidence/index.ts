/**
 * register-facilitation-case-evidence — Phase 1.
 *
 * Client uploads to the `facilitation-evidence` storage bucket directly
 * (RLS enforces case-scoped writes). This function records the row in
 * facilitation_case_evidence + writes an audit event.
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
  case_id: z.string().uuid(),
  storage_path: z.string().trim().min(3).max(512),
  original_filename: z.string().trim().min(1).max(255),
  mime_type: z.string().trim().max(120).nullable().optional(),
  size_bytes: z.number().int().min(0).max(50 * 1024 * 1024).nullable().optional(),
});

Deno.serve(async (req) => {
  const pf = handleCorsPreflight(req);
  if (pf) return pf;
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
  if (!parsed.success) return json(req, { error: "Validation failed", details: parsed.error.flatten() }, 400);

  // Enforce storage_path begins with `<case_id>/` so it lines up with the storage RLS policy.
  if (!parsed.data.storage_path.startsWith(`${parsed.data.case_id}/`)) {
    return json(req, { error: "storage_path must be prefixed with case_id/" }, 400);
  }

  const admin = createClient(url, service, { auth: { persistSession: false } });

  // Visibility check via RLS-bound user client.
  const { data: kase } = await userClient.from("facilitation_cases").select("id").eq("id", parsed.data.case_id).maybeSingle();
  if (!kase) return json(req, { error: "Not found" }, 404);

  const { data: row, error: insErr } = await admin.from("facilitation_case_evidence").insert({
    case_id: parsed.data.case_id,
    storage_path: parsed.data.storage_path,
    original_filename: parsed.data.original_filename,
    mime_type: parsed.data.mime_type ?? null,
    size_bytes: parsed.data.size_bytes ?? null,
    uploaded_by: userId,
  }).select("*").single();
  if (insErr || !row) return json(req, { error: insErr?.message ?? "Insert failed" }, 500);

  await admin.from("facilitation_case_events").insert({
    case_id: parsed.data.case_id, actor_user_id: userId,
    action: "facilitation_case.evidence_uploaded",
    from_status: null, to_status: null,
    payload: {
      evidence_id: row.id,
      original_filename: parsed.data.original_filename,
      mime_type: parsed.data.mime_type ?? null,
      size_bytes: parsed.data.size_bytes ?? null,
    },
  });

  return json(req, { evidence: row }, 201);
});
