/**
 * seed-smoke-ai-review-fixtures — staging seeder for the AI Counterparty
 * Intelligence & Match Review final live smoke test (Batches 1–5).
 *
 * Idempotently provisions:
 *   - 1 platform_admin user            (drives all 7 edge fns + /hq/ai-suggestions)
 *   - 1 plain authenticated user       (negative — must get 403 everywhere)
 *   - 1 demo organisation              (is_demo=true, lifecycle cron skips)
 *   - 1 trade_request                  (target for ai-interpret-trade-request)
 *   - 1 ai_proposed_match (status=new) (target for decision / draft / intel)
 *
 * AUTH: Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
 * REQUEST: POST { confirm: "RUN_SEED_SMOKE_AI_REVIEW", password: "<≥12>" }
 *
 * SAFETY RAILS:
 *   - All emails on @test.izenzo.co.za (matches platform fixture allowlist)
 *   - org.is_demo = true (excluded from billing/lifecycle crons)
 *   - Idempotent re-runs upsert; no duplicate proposed matches.
 */
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders as buildCors, handleCors } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TEST_SUFFIX = "@test.izenzo.co.za";

const ACCOUNTS = {
  admin: {
    email: `smoke-ai-review-admin${TEST_SUFFIX}`,
    full_name: "Smoke AI-Review platform_admin (FIXTURE)",
  },
  nonadmin: {
    email: `smoke-ai-review-nonadmin${TEST_SUFFIX}`,
    full_name: "Smoke AI-Review non-admin (FIXTURE)",
  },
} as const;

const ORG_NAME = "SMOKE AI-REVIEW Fixture Org";
const TRADE_FIXTURE_TAG = "smoke-ai-review";

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
    await admin.auth.admin.updateUserById(existing, {
      email_confirm: true,
      password,
      user_metadata: { full_name: fullName, fixture: TRADE_FIXTURE_TAG },
    });
    return existing;
  }
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { full_name: fullName, fixture: TRADE_FIXTURE_TAG },
  });
  if (error || !data.user) throw new Error(`createUser ${email}: ${error?.message}`);
  return data.user.id;
}

async function ensureRole(admin: SupabaseClient, userId: string, role: string) {
  await admin.from("user_roles").upsert({ user_id: userId, role }, { onConflict: "user_id,role" });
}

async function clearRole(admin: SupabaseClient, userId: string, role: string) {
  await admin.from("user_roles").delete().eq("user_id", userId).eq("role", role);
}

async function ensureOrg(admin: SupabaseClient): Promise<string> {
  const { data: existing } = await admin
    .from("organizations").select("id").eq("name", ORG_NAME).maybeSingle();
  if (existing?.id) {
    await admin.from("organizations").update({ is_demo: true } as never).eq("id", existing.id);
    return existing.id;
  }
  const { data, error } = await admin.from("organizations")
    .insert({ name: ORG_NAME, is_demo: true } as never).select("id").single();
  if (error || !data) throw new Error(`org insert: ${error?.message}`);
  return data.id;
}

async function ensureProfile(admin: SupabaseClient, userId: string, orgId: string, email: string, fullName: string) {
  await admin.from("profiles").upsert(
    { id: userId, org_id: orgId, email, full_name: fullName, is_demo: true } as never,
    { onConflict: "id" },
  );
}

async function ensureTradeRequest(admin: SupabaseClient, orgId: string, userId: string): Promise<string> {
  const { data: existing } = await admin
    .from("trade_requests").select("id")
    .eq("org_id", orgId).contains("metadata", { fixture: TRADE_FIXTURE_TAG } as never).maybeSingle();
  if (existing?.id) return existing.id;
  const { data, error } = await admin.from("trade_requests").insert({
    org_id: orgId,
    created_by: userId,
    commodity: "Copper cathodes (LME Grade A)",
    quantity_amount: 500,
    quantity_unit: "MT",
    price_amount: 9200,
    price_currency: "USD",
    side: "seller",
    location: "Durban, ZA",
    match_type: "bilateral",
    status: "active",
    is_demo: true,
    metadata: { fixture: TRADE_FIXTURE_TAG },
  } as never).select("id").single();
  if (error || !data) throw new Error(`trade_request insert: ${error?.message}`);
  return data.id;
}

async function ensureProposedMatch(admin: SupabaseClient, tradeRequestId: string, userId: string): Promise<string> {
  const { data: existing } = await admin
    .from("ai_proposed_matches").select("id, status")
    .eq("trade_request_id", tradeRequestId)
    .eq("suggested_counterparty_name", "Fixture Counterparty Ltd (FIXTURE)")
    .maybeSingle();
  if (existing?.id) {
    // Reset to 'new' so the smoke runner can drive the full lifecycle.
    await admin.from("ai_proposed_matches").update({
      status: "new",
      reviewed_at: null, approved_at: null, rejected_at: null, archived_at: null,
      reviewed_by: null, reviewer_note: null, rejection_reason: null,
      confidence_override: null, confidence_override_reason: null,
      escalation_required: false, escalation_reason: null,
    } as never).eq("id", existing.id);
    return existing.id;
  }
  const { data, error } = await admin.from("ai_proposed_matches").insert({
    trade_request_id: tradeRequestId,
    suggested_counterparty_name: "Fixture Counterparty Ltd (FIXTURE)",
    counterparty_role: "buyer",
    jurisdiction: "AE",
    sector_or_product_fit: "Copper refining / trading desk",
    capacity_indicator: "20-50k MT / year",
    prior_activity_summary: "Fixture-seeded synthetic counterparty for smoke test.",
    source_summary: "FIXTURE — no real public sources consulted.",
    source_references: [] as never,
    confidence_level: "medium",
    fit_label: "strong_fit",
    rank_position: 1,
    match_rationale: "Seeded for smoke test of Batches 1–5.",
    risk_flags: [] as never,
    status: "new",
    created_by: userId,
  } as never).select("id").single();
  if (error || !data) throw new Error(`ai_proposed_match insert: ${error?.message}`);
  return data.id;
}

Deno.serve(async (req) => {
  const corsHeaders = buildCors(Deno.env.get("ALLOWED_ORIGINS") || "", req.headers.get("origin"));
  const pf = handleCors(req, Deno.env.get("ALLOWED_ORIGINS") || "");
  if (pf) return pf;
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: corsHeaders });

  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (req.headers.get("Authorization") !== `Bearer ${SERVICE_ROLE}`) {
    return json({ error: "unauthorized" }, 401);
  }

  let body: { confirm?: string; password?: string };
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }
  if (body.confirm !== "RUN_SEED_SMOKE_AI_REVIEW") {
    return json({ error: "confirm phrase required: RUN_SEED_SMOKE_AI_REVIEW" }, 400);
  }
  if (!body.password || body.password.length < 12) {
    return json({ error: "password (≥12 chars) required" }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const orgId = await ensureOrg(admin);

    const adminId = await upsertUser(admin, ACCOUNTS.admin.email, body.password, ACCOUNTS.admin.full_name);
    await ensureRole(admin, adminId, "platform_admin");
    await ensureProfile(admin, adminId, orgId, ACCOUNTS.admin.email, ACCOUNTS.admin.full_name);

    const nonAdminId = await upsertUser(admin, ACCOUNTS.nonadmin.email, body.password, ACCOUNTS.nonadmin.full_name);
    await clearRole(admin, nonAdminId, "platform_admin");
    // Ensure they have *some* role (org_admin is the most realistic non-elevated identity).
    await ensureRole(admin, nonAdminId, "org_admin");
    await ensureProfile(admin, nonAdminId, orgId, ACCOUNTS.nonadmin.email, ACCOUNTS.nonadmin.full_name);

    const tradeRequestId = await ensureTradeRequest(admin, orgId, adminId);
    const proposedMatchId = await ensureProposedMatch(admin, tradeRequestId, adminId);

    const env = [
      `# --- AI Counterparty Review smoke exports ---`,
      `export SMOKE_ADMIN_EMAIL="${ACCOUNTS.admin.email}"`,
      `export SMOKE_ADMIN_PASSWORD="${body.password}"`,
      `export SMOKE_NONADMIN_EMAIL="${ACCOUNTS.nonadmin.email}"`,
      `export SMOKE_NONADMIN_PASSWORD="${body.password}"`,
      `export SMOKE_TRADE_REQUEST_ID="${tradeRequestId}"`,
      `export SMOKE_PROPOSED_MATCH_ID="${proposedMatchId}"`,
      `export SMOKE_ORG_ID="${orgId}"`,
    ].join("\n");

    return json({
      ok: true,
      org_id: orgId,
      users: {
        admin: { id: adminId, email: ACCOUNTS.admin.email },
        non_admin: { id: nonAdminId, email: ACCOUNTS.nonadmin.email },
      },
      trade_request_id: tradeRequestId,
      proposed_match_id: proposedMatchId,
      shell_env: env,
    });
  } catch (e) {
    console.error("[seed-smoke-ai-review-fixtures]", e);
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});
