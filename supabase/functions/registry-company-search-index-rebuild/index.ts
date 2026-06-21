// Batch 8 — Admin tool: rebuild the registry_company_search_index for one
// record or for every Batch 8 seed record. Authenticated platform_admin
// only.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY    = Deno.env.get("SUPABASE_ANON_KEY")!;

const BodySchema = z.object({
  record_id: z.string().uuid().optional(),
  all_seed: z.boolean().optional(),
});

Deno.serve(async (req) => {
  const pre = handleCorsPreflight(req);
  if (pre) return pre;
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return withCors(req, new Response(JSON.stringify({ error: "unauthorized" }),
      { status: 401, headers: { "Content-Type": "application/json" } }));
  }
  const user = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: who } = await user.auth.getUser();
  if (!who.user) {
    return withCors(req, new Response(JSON.stringify({ error: "unauthorized" }),
      { status: 401, headers: { "Content-Type": "application/json" } }));
  }
  const { data: roleCheck } = await user.rpc("has_role", { _user_id: who.user.id, _role: "platform_admin" });
  if (!roleCheck) {
    return withCors(req, new Response(JSON.stringify({ error: "forbidden" }),
      { status: 403, headers: { "Content-Type": "application/json" } }));
  }

  const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return withCors(req, new Response(JSON.stringify({ error: "invalid_body" }),
      { status: 400, headers: { "Content-Type": "application/json" } }));
  }

  const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  let recordIds: string[] = [];
  if (parsed.data.record_id) {
    recordIds = [parsed.data.record_id];
  } else if (parsed.data.all_seed) {
    const { data } = await svc.from("registry_company_records")
      .select("id").eq("provenance_reference", "batch8_seed_v1");
    recordIds = (data ?? []).map(r => r.id);
  } else {
    return withCors(req, new Response(JSON.stringify({ error: "missing_target" }),
      { status: 400, headers: { "Content-Type": "application/json" } }));
  }

  let totalRows = 0;
  for (const id of recordIds) {
    const { data } = await svc.rpc("rebuild_registry_company_search_index", { p_record_id: id });
    if (typeof data === "number") totalRows += data;
  }

  await svc.from("event_store").insert({
    event_name: "registry_company_search_index_rebuilt",
    aggregate_id: parsed.data.record_id ?? "batch8_seed_v1",
    aggregate_type: "registry_company_search_index",
    actor_id: who.user.id,
    payload: { records: recordIds.length, rows: totalRows },
  }).catch(() => {});

  return withCors(req, new Response(JSON.stringify({
    ok: true, records: recordIds.length, indexed_rows: totalRows,
  }), { status: 200, headers: { "Content-Type": "application/json" } }));
});
