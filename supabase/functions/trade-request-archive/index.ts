// MT-012 — Owner-org trade request archive.
//
// JWT auth, org-scoped. Calls the SECDEF service-role RPC
// `public.archive_trade_request` which blocks the archive if any active
// child match exists and emits the canonical
// `trade_request.archive_blocked_active_child_matches` audit.
//
// Touches no payment / credit / POI / WaD / outreach / finality surface.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BodySchema = z.object({
  trade_request_id: z.string().uuid(),
  reason: z.string().trim().max(2000).optional(),
}).strict();

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

  const userClient = createClient(SUPABASE_URL, ANON, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);
  const actor = userData.user;

  const admin = createClient(SUPABASE_URL, SERVICE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let raw: unknown;
  try { raw = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return json({ error: "invalid_body", details: parsed.error.flatten().fieldErrors }, 400);
  }
  const { trade_request_id, reason } = parsed.data;

  // Resolve actor's org via profile.
  const { data: prof } = await admin
    .from("profiles")
    .select("org_id")
    .eq("id", actor.id)
    .maybeSingle();
  const actorOrgId: string | null = prof?.org_id ?? null;
  if (!actorOrgId) return json({ error: "no_org", code: "NOT_OWNER" }, 403);

  const { data, error } = await admin.rpc("archive_trade_request", {
    p_trade_request_id: trade_request_id,
    p_actor_user_id: actor.id,
    p_actor_org_id: actorOrgId,
    p_reason: reason ?? null,
  });

  if (error) {
    const msg = (error.message ?? "").toString();
    if (msg.includes("ACTIVE_CHILDREN_BLOCK")) {
      let details: unknown = null;
      try { details = JSON.parse((error as { details?: string }).details ?? "null"); } catch { /* ignore */ }
      return json(
        { error: "active_children_block", code: "ACTIVE_CHILDREN_BLOCK", blocking_children: details },
        409,
      );
    }
    if (msg.includes("ALREADY_ARCHIVED")) {
      return json({ error: "already_archived", code: "ALREADY_ARCHIVED" }, 409);
    }
    if (msg.includes("NOT_OWNER")) {
      return json({ error: "forbidden", code: "NOT_OWNER" }, 403);
    }
    if (msg.includes("NOT_FOUND")) {
      return json({ error: "not_found" }, 404);
    }
    console.error("[trade-request-archive] rpc error:", error);
    return json({ error: "archive_failed" }, 500);
  }

  return json({ ok: true, result: data }, 200);
});
