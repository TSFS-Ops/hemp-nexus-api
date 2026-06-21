// Batch 9 — Duplicate review writer.
// Admin/compliance updates a duplicate candidate review_status and the
// staging row's duplicate_status accordingly.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const BodySchema = z.object({
  candidate_id: z.string().uuid(),
  decision: z.enum(["reviewed_unique", "reviewed_duplicate", "reviewed_keep_both"]),
  notes: z.string().max(2000).optional(),
});

Deno.serve(async (req) => {
  const pre = handleCorsPreflight(req);
  if (pre) return pre;
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: userRes } = await userClient.auth.getUser();
    const user = userRes?.user;
    if (!user) return withCors(req, new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } }));

    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) return withCors(req, new Response(JSON.stringify({ error: "invalid_body" }), { status: 400, headers: { "Content-Type": "application/json" } }));

    const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { data: roles } = await svc.from("user_roles").select("role").eq("user_id", user.id);
    const roleSet = new Set((roles ?? []).map((r: { role: string }) => r.role));
    if (!roleSet.has("platform_admin") && !roleSet.has("compliance_owner")) {
      return withCors(req, new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { "Content-Type": "application/json" } }));
    }

    const { data: cand } = await svc.from("registry_import_duplicate_candidates")
      .select("id, staging_id, confidence").eq("id", parsed.data.candidate_id).maybeSingle();
    if (!cand) return withCors(req, new Response(JSON.stringify({ error: "candidate_not_found" }), { status: 404, headers: { "Content-Type": "application/json" } }));

    await svc.from("registry_import_duplicate_candidates").update({
      review_status: parsed.data.decision,
      reviewer_id: user.id,
      reviewed_at: new Date().toISOString(),
      notes: parsed.data.notes ?? null,
    }).eq("id", parsed.data.candidate_id);

    let newStagingDup: string;
    if (parsed.data.decision === "reviewed_unique") newStagingDup = "reviewed_unique";
    else if (parsed.data.decision === "reviewed_duplicate") newStagingDup = "reviewed_duplicate";
    else newStagingDup = cand.confidence; // keep_both: leave at confidence level (will not block publish if not high)

    await svc.from("registry_import_records_staging").update({ duplicate_status: newStagingDup }).eq("id", cand.staging_id);

    await svc.from("event_store").insert({
      event_name: "registry_import_duplicate_reviewed",
      aggregate_id: cand.staging_id, aggregate_type: "registry_import_records_staging", actor_id: user.id,
      payload: { decision: parsed.data.decision },
    }).catch(() => {});

    return withCors(req, new Response(JSON.stringify({ ok: true, duplicate_status: newStagingDup }), { status: 200, headers: { "Content-Type": "application/json" } }));
  } catch (err) {
    console.error("registry-import-duplicate-check error", err);
    return withCors(req, new Response(JSON.stringify({ error: "internal_error", message: String(err) }), { status: 500, headers: { "Content-Type": "application/json" } }));
  }
});
