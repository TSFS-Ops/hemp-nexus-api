/**
 * unseed-daniel-fixtures — Idempotent removal of Phase 2 demo fixtures.
 *
 * Refuses to delete anything not flagged is_demo=true.
 * Same auth contract as seed-daniel-fixtures.
 *
 * REQUEST:
 *   POST /functions/v1/unseed-daniel-fixtures
 *   { "confirm": "RUN_UNSEED_DANIEL_FIXTURES" }
 *
 * Removes (in order):
 *   1. engagement_outreach_logs for demo engagements
 *   2. poi_engagements where is_demo=true AND match in our demo matches
 *   3. matches where is_demo=true AND hash IN (demo hashes)
 *   4. profiles for the three demo accounts
 *   5. user_roles for the three demo accounts
 *   6. auth.users for the three demo accounts
 *   7. organizations where is_demo=true AND name IN (demo names)
 *
 * Each step is hard-gated on is_demo=true / known-name / known-hash.
 */

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INTERNAL_CRON_KEY = Deno.env.get("INTERNAL_CRON_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, content-type, apikey, x-internal-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const DEMO_EMAILS = [
  "daniel-platformadmin@test.izenzo.co.za",
  "daniel-initiator@test.izenzo.co.za",
  "daniel-counterparty@test.izenzo.co.za",
];

const DEMO_ORG_NAMES = [
  "DEMO Daniel Initiator Org",
  "DEMO Daniel Counterparty Org",
];

const DEMO_MATCH_HASHES = [
  "DEMO-BINDING-001",
  "DEMO-DISPUTED-002",
  "DEMO-EMAILCHG-003",
  "DEMO-LATE-ACCEPT-004",
  "DEMO-LATE-RECONFIRM-005",
  "DEMO-CLEAN-006",
  "DEMO-RECONFIRM-DUPLICATE-007",
];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: corsHeaders,
  });
}

async function authorise(
  req: Request,
  admin: SupabaseClient,
): Promise<{ ok: true } | { ok: false; resp: Response }> {
  const internal = req.headers.get("x-internal-key");
  if (INTERNAL_CRON_KEY && internal && internal === INTERNAL_CRON_KEY) {
    return { ok: true };
  }
  const auth = req.headers.get("authorization") ?? "";
  if (auth === `Bearer ${SERVICE_ROLE}`) return { ok: true };
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
      if (roleRow) return { ok: true };
    }
  }
  return { ok: false, resp: json({ error: "unauthorised" }, 401) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  });

  const authResult = await authorise(req, admin);
  if (!authResult.ok) return authResult.resp;

  let body: { confirm?: string } = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json_body" }, 400);
  }
  if (body.confirm !== "RUN_UNSEED_DANIEL_FIXTURES") {
    return json({ error: "confirm token missing or wrong" }, 400);
  }

  const deleted: Record<string, number> = {
    engagement_outreach_logs: 0,
    poi_engagements: 0,
    matches: 0,
    profiles: 0,
    user_roles: 0,
    auth_users: 0,
    organizations: 0,
  };

  try {
    // Find demo orgs (by name AND is_demo=true).
    const { data: demoOrgs } = await admin
      .from("organizations")
      .select("id, name")
      .in("name", DEMO_ORG_NAMES)
      .eq("is_demo", true);
    const demoOrgIds = (demoOrgs ?? []).map((o) => o.id);

    // Find demo matches (by hash AND is_demo=true).
    const { data: demoMatches } = await admin
      .from("matches")
      .select("id, hash")
      .in("hash", DEMO_MATCH_HASHES)
      .eq("is_demo", true);
    const demoMatchIds = (demoMatches ?? []).map((m) => m.id);

    // Find demo engagements (must be is_demo=true AND tied to demo matches).
    let demoEngagementIds: string[] = [];
    if (demoMatchIds.length) {
      const { data: engs } = await admin
        .from("poi_engagements")
        .select("id")
        .in("match_id", demoMatchIds)
        .eq("is_demo", true);
      demoEngagementIds = (engs ?? []).map((e) => e.id);
    }

    // 1. outreach logs
    if (demoEngagementIds.length) {
      const { count } = await admin
        .from("engagement_outreach_logs")
        .delete({ count: "exact" })
        .in("engagement_id", demoEngagementIds);
      deleted.engagement_outreach_logs = count ?? 0;
    }

    // 2. engagements (re-assert is_demo=true)
    if (demoMatchIds.length) {
      const { count } = await admin
        .from("poi_engagements")
        .delete({ count: "exact" })
        .in("match_id", demoMatchIds)
        .eq("is_demo", true);
      deleted.poi_engagements = count ?? 0;
    }

    // 3. matches (re-assert is_demo=true)
    if (DEMO_MATCH_HASHES.length) {
      const { count } = await admin
        .from("matches")
        .delete({ count: "exact" })
        .in("hash", DEMO_MATCH_HASHES)
        .eq("is_demo", true);
      deleted.matches = count ?? 0;
    }

    // Find demo users by email (only @test.izenzo.co.za).
    const demoUserIds: string[] = [];
    for (let page = 1; page <= 5; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) break;
      for (const u of data.users) {
        const e = u.email?.toLowerCase() ?? "";
        if (
          DEMO_EMAILS.includes(e) &&
          e.endsWith("@test.izenzo.co.za")
        ) {
          demoUserIds.push(u.id);
        }
      }
      if (data.users.length < 1000) break;
    }

    // 4. profiles
    if (demoUserIds.length) {
      const { count } = await admin
        .from("profiles")
        .delete({ count: "exact" })
        .in("id", demoUserIds);
      deleted.profiles = count ?? 0;
    }

    // 5. user_roles
    if (demoUserIds.length) {
      const { count } = await admin
        .from("user_roles")
        .delete({ count: "exact" })
        .in("user_id", demoUserIds);
      deleted.user_roles = count ?? 0;
    }

    // 6. auth.users
    for (const uid of demoUserIds) {
      const { error } = await admin.auth.admin.deleteUser(uid);
      if (!error) deleted.auth_users += 1;
    }

    // 7. orgs (re-assert is_demo=true AND name in known list)
    if (demoOrgIds.length) {
      const { count } = await admin
        .from("organizations")
        .delete({ count: "exact" })
        .in("id", demoOrgIds)
        .eq("is_demo", true)
        .in("name", DEMO_ORG_NAMES);
      deleted.organizations = count ?? 0;
    }

    return json({
      ok: true,
      deleted,
      notes: [
        "All deletes were hard-gated by is_demo=true and the explicit demo name/hash/email allowlist.",
        "Idempotent: re-running returns zero deletions.",
      ],
    });
  } catch (err) {
    return json(
      { ok: false, error: (err as Error).message, partial_deleted: deleted },
      500,
    );
  }
});
