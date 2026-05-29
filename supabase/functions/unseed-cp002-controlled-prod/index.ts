/**
 * unseed-cp002-controlled-prod — Controlled production cleanup for the
 * single CP-002 / DEC-002 Daniel acceptance fixture.
 *
 * Hard-gates every delete on:
 *   - hash IN ALLOWED_FIXTURE_HASHES, AND
 *   - is_demo = true, AND
 *   - metadata.fixture_scope = "CP-002 / DEC-002 Daniel UAT".
 *
 * Does NOT touch auth users, profiles, orgs (reused across the Daniel
 * fixture system). poi_engagements rows cascade via existing FK.
 */

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders as __buildCorsHeaders, handleCors as __handleCors } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INTERNAL_CRON_KEY = Deno.env.get("INTERNAL_CRON_KEY") ?? "";

const ALLOWED_FIXTURE_SCOPE = "CP-002 / DEC-002 Daniel UAT";
const ALLOWED_FIXTURE_HASHES = ["DEMO-CP002-NAME-NO-EMAIL-001"] as const;
const ADMIN_FLAG_KEY = "allow_controlled_production_demo_fixtures_cp002";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), { status, headers: corsHeaders });
}

function isProductionTier(): boolean {
  const tier = (Deno.env.get("ENVIRONMENT_TIER") ?? "").toLowerCase();
  return tier === "production" || tier === "live" || tier === "prod";
}

async function authorise(
  req: Request,
  admin: SupabaseClient,
): Promise<{ ok: true; actor: string | null } | { ok: false; resp: Response }> {
  const internal = req.headers.get("x-internal-key");
  if (INTERNAL_CRON_KEY && internal && internal === INTERNAL_CRON_KEY) {
    return { ok: true, actor: "internal_cron" };
  }
  const auth = req.headers.get("authorization") ?? "";
  if (auth === `Bearer ${SERVICE_ROLE}`) return { ok: true, actor: "service_role" };
  if (auth.startsWith("Bearer ")) {
    const token = auth.slice("Bearer ".length);
    const { data, error } = await admin.auth.getUser(token);
    if (!error && data.user) {
      const { data: roleRow } = await admin
        .from("user_roles")
        .select("role")
        .eq("user_id", data.user.id)
        .eq("role", "platform_admin")
        .maybeSingle();
      if (roleRow) return { ok: true, actor: data.user.email ?? data.user.id };
    }
  }
  return { ok: false, resp: json({ error: "unauthorised" }, 401) };
}

async function isControlledFlagEnabled(admin: SupabaseClient): Promise<boolean> {
  const { data } = await admin
    .from("admin_settings")
    .select("value")
    .eq("key", ADMIN_FLAG_KEY)
    .maybeSingle();
  const v = (data?.value ?? {}) as { enabled?: boolean };
  return v.enabled === true;
}

Deno.serve(async (req) => {
  const corsHeaders = __buildCorsHeaders(Deno.env.get("ALLOWED_ORIGINS") || "", req.headers.get("origin"));
  const __pf = __handleCors(req, Deno.env.get("ALLOWED_ORIGINS") || "");
  if (__pf) return __pf;
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  });

  const authResult = await authorise(req, admin);
  if (!authResult.ok) return authResult.resp;
  const actor = authResult.actor;

  let body: { confirm?: string; scope?: string; hashes?: string[] } = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json_body" }, 400);
  }
  if (body.confirm !== "RUN_UNSEED_CP002_CONTROLLED_PROD") {
    return json({ error: "confirm token missing or wrong" }, 400);
  }
  if (body.scope !== ALLOWED_FIXTURE_SCOPE) {
    return json({ error: "SCOPE_NOT_ALLOWED", expected: ALLOWED_FIXTURE_SCOPE }, 400);
  }
  const requested = Array.isArray(body.hashes) && body.hashes.length > 0
    ? body.hashes
    : [...ALLOWED_FIXTURE_HASHES];
  for (const h of requested) {
    if (!ALLOWED_FIXTURE_HASHES.includes(h as typeof ALLOWED_FIXTURE_HASHES[number])) {
      return json({ error: "HASH_NOT_ALLOWED", hash: h, allowed: ALLOWED_FIXTURE_HASHES }, 400);
    }
  }

  if (isProductionTier()) {
    if (!(await isControlledFlagEnabled(admin))) {
      return json(
        {
          error: "CONTROLLED_PRODUCTION_FLAG_DISABLED",
          message:
            `admin_settings.${ADMIN_FLAG_KEY}.enabled must be true to clean CP-002 fixtures in production.`,
        },
        403,
      );
    }
  }

  const deleted: Record<string, number> = { matches: 0 };
  const details: Array<Record<string, unknown>> = [];

  try {
    const { data: rows } = await admin
      .from("matches")
      .select("id, hash, is_demo, metadata")
      .in("hash", requested)
      .eq("is_demo", true);
    const eligible = (rows ?? []).filter((r) => {
      const m = (r.metadata ?? {}) as Record<string, unknown>;
      return m.fixture_scope === ALLOWED_FIXTURE_SCOPE;
    });
    const eligibleIds = eligible.map((r) => r.id);
    for (const r of eligible) details.push({ hash: r.hash, match_id: r.id });

    if (eligibleIds.length) {
      const { count } = await admin
        .from("matches")
        .delete({ count: "exact" })
        .in("id", eligibleIds)
        .eq("is_demo", true);
      deleted.matches = count ?? 0;
    }

    try {
      await admin.from("admin_audit_logs").insert({
        admin_user_id: null,
        action: "demo.fixture_unseeded_controlled_production",
        target_type: "system",
        target_id: null,
        details: {
          function: "unseed-cp002-controlled-prod",
          fixture_scope: ALLOWED_FIXTURE_SCOPE,
          fixture_hashes: requested,
          actor,
          deleted,
          environment_tier: Deno.env.get("ENVIRONMENT_TIER") ?? null,
          production_demo_mode: true,
        },
      });
    } catch (e) {
      console.error("[unseed-cp002-controlled-prod] audit insert failed:", e);
    }

    return json({
      ok: true,
      scope: ALLOWED_FIXTURE_SCOPE,
      requested,
      deleted,
      details,
      notes: [
        "Hard-gated by hash allowlist + is_demo=true + metadata.fixture_scope match.",
        "poi_engagements cascades via FK; no auth users / orgs / profiles removed.",
      ],
    });
  } catch (err) {
    return json(
      { ok: false, error: (err as Error).message, partial_deleted: deleted },
      500,
    );
  }
});
