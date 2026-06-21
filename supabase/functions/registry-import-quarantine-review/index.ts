// Batch 9 — Quarantine queue review writer.
// Admin/compliance releases (status='released'), permanently excludes,
// or keeps a quarantine entry open. Releasing requires the underlying
// validation issues to have already been resolved by an admin-supplied
// rationale — we don't auto-rerun validation here.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const BodySchema = z.object({
  quarantine_id: z.string().uuid(),
  decision: z.enum(["released", "permanently_excluded"]),
  rationale: z.string().min(20).max(2000),
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

    const { data: q } = await svc.from("registry_import_quarantine")
      .select("id, staging_id, status").eq("id", parsed.data.quarantine_id).maybeSingle();
    if (!q) return withCors(req, new Response(JSON.stringify({ error: "quarantine_not_found" }), { status: 404, headers: { "Content-Type": "application/json" } }));

    await svc.from("registry_import_quarantine").update({
      status: parsed.data.decision,
      reviewer_id: user.id,
      reviewed_at: new Date().toISOString(),
      notes: parsed.data.rationale,
    }).eq("id", parsed.data.quarantine_id);

    if (parsed.data.decision === "released") {
      // Released rows are eligible for publish only if validation_outcome
      // is later re-set by /registry-import-validate. We move it back to
      // 'valid_with_warnings' as a conservative starting state.
      await svc.from("registry_import_records_staging").update({
        validation_outcome: "valid_with_warnings",
        quarantine_reason: null,
      }).eq("id", q.staging_id);
    } else {
      await svc.from("registry_import_records_staging").update({ publish_status: "blocked" }).eq("id", q.staging_id);
    }

    await svc.from("event_store").insert({
      event_name: "registry_import_record_quarantined",
      aggregate_id: q.staging_id, aggregate_type: "registry_import_records_staging", actor_id: user.id,
      payload: { decision: parsed.data.decision, rationale_length: parsed.data.rationale.length },
    }).catch(() => {});

    return withCors(req, new Response(JSON.stringify({ ok: true, decision: parsed.data.decision }), { status: 200, headers: { "Content-Type": "application/json" } }));
  } catch (err) {
    console.error("registry-import-quarantine-review error", err);
    return withCors(req, new Response(JSON.stringify({ error: "internal_error", message: String(err) }), { status: 500, headers: { "Content-Type": "application/json" } }));
  }
});
