/**
 * facilitation-case-eligible-owners — Phase 2 Step 5
 *
 * Returns the list of users who may be assigned as case_owner_id for a
 * facilitation case. Driven by the same role check that
 * `facilitation-case-admin-action` action='assign' performs:
 *   platform_admin OR admin OR compliance_analyst
 *
 * Used by the case-drawer owner picker to replace the freehand UUID
 * field. The picker shows {name | email} and submits the UUID.
 *
 * Authorisation:
 *   - caller must hold one of: platform_admin / admin / compliance_analyst
 *   - everyone else → 403
 *
 * NO new privilege surface: this endpoint reads existing user_roles +
 * profiles and DOES NOT broaden who may be assigned.
 */
import { createClient } from "npm:@supabase/supabase-js@2.39.3";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";

const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
function j(req: Request, body: unknown, status = 200) {
  return withCors(req, new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  }));
}

Deno.serve(async (req) => {
  const pf = handleCorsPreflight(req);
  if (pf) return pf;
  if (req.method !== "GET" && req.method !== "POST") return j(req, { error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authz = req.headers.get("Authorization");
  if (!authz?.startsWith("Bearer ")) return j(req, { error: "Unauthorized" }, 401);
  const userClient = createClient(url, anon, { global: { headers: { Authorization: authz } } });
  const { data: claims } = await userClient.auth.getClaims(authz.replace("Bearer ", ""));
  const userId = claims?.claims?.sub as string | undefined;
  if (!userId) return j(req, { error: "Unauthorized" }, 401);

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const checks = await Promise.all([
    admin.rpc("has_role", { _user_id: userId, _role: "platform_admin" }),
    admin.rpc("has_role", { _user_id: userId, _role: "admin" }),
    admin.rpc("has_role", { _user_id: userId, _role: "compliance_analyst" }),
  ]);
  const isEligible = checks.some((c) => !!c.data);
  if (!isEligible) return j(req, { error: "Forbidden" }, 403);

  // Pull eligible owner user_ids: anyone holding one of the three roles.
  const { data: roleRows, error: rerr } = await admin
    .from("user_roles")
    .select("user_id,role")
    .in("role", ["platform_admin", "admin", "compliance_analyst"]);
  if (rerr) return j(req, { error: rerr.message }, 500);

  const idSet = new Set<string>();
  const rolesByUser = new Map<string, string[]>();
  for (const r of roleRows ?? []) {
    idSet.add(r.user_id);
    const arr = rolesByUser.get(r.user_id) ?? [];
    arr.push(r.role);
    rolesByUser.set(r.user_id, arr);
  }
  const ids = [...idSet];
  if (ids.length === 0) return j(req, { owners: [] });

  const { data: profiles } = await admin
    .from("profiles")
    .select("id,full_name,email")
    .in("id", ids);

  const owners = (profiles ?? []).map((p) => ({
    id: p.id as string,
    full_name: (p.full_name as string | null) ?? null,
    email: (p.email as string | null) ?? null,
    roles: rolesByUser.get(p.id as string) ?? [],
  })).sort((a, b) => {
    const an = (a.full_name || a.email || "").toLowerCase();
    const bn = (b.full_name || b.email || "").toLowerCase();
    return an.localeCompare(bn);
  });

  return j(req, { owners });
});
