// Batch 8 — Admin-only tool to load / refresh the controlled sample
// registry records. Calls the SECURITY DEFINER RPC
// admin_seed_batch8_sample_records which itself enforces platform_admin.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY    = Deno.env.get("SUPABASE_ANON_KEY")!;

Deno.serve(async (req) => {
  const pre = handleCorsPreflight(req);
  if (pre) return pre;
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return withCors(req, new Response(JSON.stringify({ error: "unauthorized" }),
      { status: 401, headers: { "Content-Type": "application/json" } }));
  }
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data, error } = await client.rpc("admin_seed_batch8_sample_records");
  if (error) {
    const code = (error as any).code === "42501" ? 403 : 500;
    return withCors(req, new Response(JSON.stringify({ error: error.message }),
      { status: code, headers: { "Content-Type": "application/json" } }));
  }
  return withCors(req, new Response(JSON.stringify({ ok: true, result: data }),
    { status: 200, headers: { "Content-Type": "application/json" } }));
});
