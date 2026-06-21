// Batch 17 — Shared admin role-gate for the operations centre.
// Requires platform_admin or compliance_owner. Returns the supabase client +
// user on success, or a Response on failure (caller should return it).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { withCors } from "./cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

export interface OpsAuthOk {
  ok: true;
  svc: ReturnType<typeof createClient>;
  user: { id: string };
  roles: Set<string>;
}
export interface OpsAuthFail {
  ok: false;
  response: Response;
}

export async function requireOpsAdmin(req: Request): Promise<OpsAuthOk | OpsAuthFail> {
  const json = (status: number, body: unknown) =>
    withCors(req, new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: userRes } = await userClient.auth.getUser();
  const user = userRes?.user;
  if (!user) return { ok: false, response: json(401, { error: "unauthorized" }) };

  const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { data: roles } = await svc.from("user_roles").select("role").eq("user_id", user.id);
  const set = new Set((roles ?? []).map((r: { role: string }) => r.role));
  if (!(set.has("platform_admin") || set.has("compliance_owner"))) {
    return { ok: false, response: json(403, { error: "forbidden" }) };
  }
  return { ok: true, svc, user: { id: user.id }, roles: set };
}
