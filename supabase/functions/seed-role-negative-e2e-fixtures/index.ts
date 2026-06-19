/**
 * seed-role-negative-e2e-fixtures — staging seeder for the Role-Negative
 * & E2E test pack. Idempotent. Mirrors seed-smoke-a-d-fixtures.
 *
 * Phase 1 (this version):
 *   - Two organisations flagged is_demo=true
 *   - Eight TEST/UAT users (no logged_out_user — that's a runtime state)
 *   - user_roles entries matching the approved role labels
 *
 * Phase 2 (deferred; tracked in docs/role-negative-e2e-coverage.md):
 *   - Seeded trade requests, matches, POIs, WaDs, documents, refunds,
 *     governance export candidates, API key + usage fixtures.
 *   - Specs that need these IDs `test.skip` cleanly until Phase 2 lands.
 *
 * AUTH:
 *   - Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>, or
 *   - x-internal-key: INTERNAL_CRON_KEY
 *
 * SAFETY:
 *   - All emails forced to @test.izenzo.co.za (matches provision-test-user gate)
 *   - All names prefixed "TEST/UAT" or "TEST-"
 *   - Both organisations is_demo=true (lifecycle/billing crons skip)
 *   - No notifications/emails/webhooks/provider calls
 */
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders, handleCors } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INTERNAL_CRON_KEY = Deno.env.get("INTERNAL_CRON_KEY") ?? "";

const TEST_SUFFIX = "@test.izenzo.co.za";

type RoleLabel =
  | "platform_admin"
  | "compliance_analyst"
  | "requester_trader"
  | "counterparty_user"
  | "api_client_admin"
  | "normal_non_admin_user";

type AccountSpec = {
  envKey: string;
  email: string;
  fullName: string;
  org: "A" | "B" | "global";
  role: RoleLabel;
};

const ACCOUNTS: AccountSpec[] = [
  { envKey: "PLATFORM_ADMIN",              email: `rn-platform-admin${TEST_SUFFIX}`,        fullName: "RN Platform Admin (TEST/UAT)",       org: "global", role: "platform_admin" },
  { envKey: "COMPLIANCE_ANALYST",          email: `rn-compliance-analyst${TEST_SUFFIX}`,    fullName: "RN Compliance Analyst (TEST/UAT)",   org: "global", role: "compliance_analyst" },
  { envKey: "ORG_A_REQUESTER_TRADER",      email: `rn-org-a-requester${TEST_SUFFIX}`,       fullName: "RN Org A Requester Trader (TEST)",   org: "A",      role: "requester_trader" },
  { envKey: "ORG_A_COUNTERPARTY_USER",     email: `rn-org-a-counterparty${TEST_SUFFIX}`,    fullName: "RN Org A Counterparty (TEST)",       org: "A",      role: "counterparty_user" },
  { envKey: "ORG_A_API_CLIENT_ADMIN",      email: `rn-org-a-api-admin${TEST_SUFFIX}`,       fullName: "RN Org A API Client Admin (TEST)",   org: "A",      role: "api_client_admin" },
  { envKey: "ORG_A_NORMAL_USER",           email: `rn-org-a-normal${TEST_SUFFIX}`,          fullName: "RN Org A Normal User (TEST)",        org: "A",      role: "normal_non_admin_user" },
  { envKey: "ORG_B_REQUESTER_TRADER",      email: `rn-org-b-requester${TEST_SUFFIX}`,       fullName: "RN Org B Requester Trader (TEST)",   org: "B",      role: "requester_trader" },
  { envKey: "ORG_B_COUNTERPARTY_USER",     email: `rn-org-b-counterparty${TEST_SUFFIX}`,    fullName: "RN Org B Counterparty (TEST)",       org: "B",      role: "counterparty_user" },
  { envKey: "ORG_B_API_CLIENT_ADMIN",      email: `rn-org-b-api-admin${TEST_SUFFIX}`,       fullName: "RN Org B API Client Admin (TEST)",   org: "B",      role: "api_client_admin" },
  { envKey: "ORG_B_NORMAL_USER",           email: `rn-org-b-normal${TEST_SUFFIX}`,          fullName: "RN Org B Normal User (TEST)",        org: "B",      role: "normal_non_admin_user" },
];

function authorised(req: Request): boolean {
  const internal = req.headers.get("x-internal-key");
  if (internal && INTERNAL_CRON_KEY && internal === INTERNAL_CRON_KEY) return true;
  const auth = req.headers.get("Authorization") ?? "";
  return auth === `Bearer ${SERVICE_ROLE}`;
}

async function findUserByEmail(admin: SupabaseClient, email: string): Promise<string | null> {
  for (let page = 1; page <= 5; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) return null;
    const hit = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (hit) return hit.id;
    if (data.users.length < 1000) break;
  }
  return null;
}

async function upsertUser(admin: SupabaseClient, email: string, password: string, fullName: string): Promise<string> {
  const existing = await findUserByEmail(admin, email);
  if (existing) {
    await admin.auth.admin.updateUserById(existing, { password, user_metadata: { full_name: fullName } });
    return existing;
  }
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { full_name: fullName },
  });
  if (error || !data.user) throw new Error(`createUser(${email}): ${error?.message ?? "no user"}`);
  return data.user.id;
}

async function upsertOrg(admin: SupabaseClient, name: string): Promise<string> {
  const { data: existing } = await admin.from("organizations").select("id").eq("name", name).maybeSingle();
  if (existing) {
    await admin.from("organizations").update({ is_demo: true }).eq("id", existing.id);
    return existing.id as string;
  }
  const { data, error } = await admin.from("organizations").insert({ name, is_demo: true }).select("id").single();
  if (error || !data) throw new Error(`upsertOrg(${name}): ${error?.message}`);
  return data.id as string;
}

async function ensureProfileAndRole(admin: SupabaseClient, userId: string, orgId: string | null, role: RoleLabel) {
  await admin.from("profiles").upsert({ id: userId, org_id: orgId }, { onConflict: "id" });
  // user_roles is the canonical role table (see mem/security)
  await admin.from("user_roles").upsert({ user_id: userId, role }, { onConflict: "user_id,role" }).select();
}

Deno.serve(async (req) => {
  const pre = handleCors(req);
  if (pre) return pre;
  if (!authorised(req)) {
    return new Response(JSON.stringify({ ok: false, error: "unauthorised" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  let body: { confirm?: string; password?: string };
  try { body = await req.json(); } catch { body = {}; }
  if (body.confirm !== "RUN_SEED_ROLE_NEGATIVE_E2E") {
    return new Response(JSON.stringify({ ok: false, error: "missing confirm token" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!body.password || body.password.length < 12) {
    return new Response(JSON.stringify({ ok: false, error: "password must be ≥12 chars" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  try {
    const orgAId = await upsertOrg(admin, "Organisation A TEST/UAT");
    const orgBId = await upsertOrg(admin, "Organisation B TEST/UAT");
    const orgIdFor = (k: "A" | "B" | "global") => k === "A" ? orgAId : k === "B" ? orgBId : null;

    const userIds: Record<string, string> = {};
    for (const a of ACCOUNTS) {
      const uid = await upsertUser(admin, a.email, body.password!, a.fullName);
      userIds[a.envKey] = uid;
      await ensureProfileAndRole(admin, uid, orgIdFor(a.org), a.role);
    }

    const env: string[] = [];
    env.push(`export E2E_RN_ENV="staging"`);
    env.push(`export E2E_RN_PASSWORD='${body.password}'`);
    env.push(`export E2E_RN_ORG_A_ID="${orgAId}"`);
    env.push(`export E2E_RN_ORG_B_ID="${orgBId}"`);
    for (const a of ACCOUNTS) env.push(`export E2E_RN_${a.envKey}_EMAIL="${a.email}"`);

    return new Response(JSON.stringify({
      ok: true,
      phase: 1,
      org_a_id: orgAId,
      org_b_id: orgBId,
      users: Object.keys(userIds).length,
      shell_env: env.join("\n"),
      phase_2_pending: [
        "trade_requests", "matches", "pois", "wads",
        "match_documents", "refund_requests", "export_requests", "api_keys",
      ],
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e?.message ?? e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
