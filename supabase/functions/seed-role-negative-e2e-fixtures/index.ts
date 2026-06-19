/**
 * seed-role-negative-e2e-fixtures — Role-Negative & E2E seeder.
 *
 * Phase 1: organisations, users, user_roles (idempotent).
 * Phase 2: per-org record fixtures used by the runtime suite.
 *
 * What Phase 2 creates (per org, idempotent, all flagged is_demo where
 * the column exists; deterministic names prefixed RN-TEST-):
 *   - 1 verified entity (COMPANY) per org              -> entities
 *   - 1 trade_request                                  -> trade_requests
 *   - 1 match (cross-org A-buyer/B-seller for Org A)   -> matches
 *   - 1 bilateral POI in DRAFT                         -> pois
 *   - 1 match_document (uploaded, sha256 deterministic)-> match_documents
 *   - 1 api_client (sandbox approved) + 1 sandbox api_key -> api_clients, api_keys
 *   - 1 governance export_request (status=pending)     -> export_requests
 *
 * Deferred to Phase 2b (require preconditions that violate invariants
 * if synthesised by a seeder):
 *   - wads          — requires sealed canonical payload + attestations +
 *                     ledger chain; must be created via issue_wad RPC
 *                     against a real POI lifecycle. Seeding a raw row
 *                     would corrupt the ledger hash chain.
 *   - refund_requests — requires a paid token_purchase row; synthesising
 *                     one bypasses Paystack/Payfast reconciliation and
 *                     would surface in revenue reports.
 *
 * The runtime specs that target wad/refund use `test.skip` with a clear
 * reason. All other Phase-2 specs are unblocked by this seeder.
 *
 * AUTH:
 *   - Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>, or
 *   - x-internal-key: INTERNAL_CRON_KEY
 *
 * SAFETY:
 *   - Emails forced to @test.izenzo.co.za
 *   - Names prefixed "RN-TEST-" / "TEST/UAT"
 *   - is_demo=true on every row that supports it (lifecycle/billing crons skip)
 *   - api_keys live in environment='sandbox' with key_hash prefix `rn_test_`
 *   - No notifications, emails, webhooks, provider calls, payments
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
  await admin.from("user_roles").upsert({ user_id: userId, role }, { onConflict: "user_id,role" }).select();
}

/* ───────────────────────── Phase 2 ───────────────────────── */

/**
 * Idempotent find-or-insert keyed on a deterministic marker stored in the
 * metadata jsonb (or filename / name / legal_entity_name as appropriate).
 * Avoids unique-violation noise on re-run.
 */
async function upsertEntity(admin: SupabaseClient, orgId: string, marker: string): Promise<string> {
  const { data: hit } = await admin.from("entities").select("id")
    .eq("org_id", orgId).eq("legal_name", marker).maybeSingle();
  if (hit) return hit.id as string;
  const { data, error } = await admin.from("entities").insert({
    org_id: orgId,
    entity_type: "COMPANY",
    legal_name: marker,
    jurisdiction_code: "ZA",
    status: "VERIFIED",
    metadata: { source: "rn_seeder", is_demo: true },
  }).select("id").single();
  if (error || !data) throw new Error(`upsertEntity(${marker}): ${error?.message}`);
  return data.id as string;
}

async function upsertTradeRequest(admin: SupabaseClient, orgId: string, createdBy: string, marker: string): Promise<string> {
  const { data: hit } = await admin.from("trade_requests").select("id")
    .eq("org_id", orgId).contains("metadata", { rn_marker: marker }).maybeSingle();
  if (hit) return hit.id as string;
  const { data, error } = await admin.from("trade_requests").insert({
    org_id: orgId, created_by: createdBy,
    commodity: "RN-TEST-Copper", quantity_amount: 100, quantity_unit: "MT",
    price_amount: 1000, price_currency: "USD", side: "buyer",
    match_type: "bilateral", status: "active",
    is_demo: true,
    metadata: { rn_marker: marker, source: "rn_seeder" },
  }).select("id").single();
  if (error || !data) throw new Error(`upsertTradeRequest(${marker}): ${error?.message}`);
  return data.id as string;
}

async function upsertMatch(
  admin: SupabaseClient,
  orgId: string,
  buyerOrgId: string,
  sellerOrgId: string,
  tradeRequestId: string,
  marker: string,
): Promise<string> {
  const { data: hit } = await admin.from("matches").select("id")
    .eq("org_id", orgId).contains("metadata", { rn_marker: marker }).maybeSingle();
  if (hit) return hit.id as string;
  const hash = `rn-test-${marker}`;
  const { data, error } = await admin.from("matches").insert({
    org_id: orgId, hash, commodity: "RN-TEST-Copper",
    quantity_amount: 100, quantity_unit: "MT", price_amount: 1000, price_currency: "USD",
    buyer_org_id: buyerOrgId, seller_org_id: sellerOrgId,
    status: "matched", state: "discovery", poi_state: "DRAFT",
    match_type: "search", trade_request_id: tradeRequestId,
    is_demo: true,
    metadata: { rn_marker: marker, source: "rn_seeder" },
  }).select("id").single();
  if (error || !data) throw new Error(`upsertMatch(${marker}): ${error?.message}`);
  return data.id as string;
}

async function upsertPoi(
  admin: SupabaseClient,
  orgId: string,
  buyerEntityId: string,
  sellerEntityId: string,
  marker: string,
): Promise<string> {
  const { data: hit } = await admin.from("pois").select("id")
    .eq("org_id", orgId).eq("industry_code", marker).maybeSingle();
  if (hit) return hit.id as string;
  const { data, error } = await admin.from("pois").insert({
    org_id: orgId,
    buyer_entity_id: buyerEntityId,
    seller_entity_id: sellerEntityId,
    industry_code: marker,
    jurisdiction_code: "ZA",
    poi_type: "bilateral",
    state: "DRAFT",
    terms: { rn_marker: marker, source: "rn_seeder" },
    is_demo: true,
  }).select("id").single();
  if (error || !data) throw new Error(`upsertPoi(${marker}): ${error?.message}`);
  return data.id as string;
}

async function upsertMatchDocument(
  admin: SupabaseClient,
  matchId: string,
  orgId: string,
  uploaderUserId: string,
  marker: string,
): Promise<string> {
  const sha = `rn-test-${marker}-sha`;
  const { data: hit } = await admin.from("match_documents").select("id")
    .eq("match_id", matchId).eq("sha256_hash", sha).maybeSingle();
  if (hit) return hit.id as string;
  const { data, error } = await admin.from("match_documents").insert({
    match_id: matchId, org_id: orgId, uploader_user_id: uploaderUserId,
    uploader_org_id: orgId,
    doc_type: "other", filename: `RN-TEST-${marker}.txt`,
    storage_path: `rn-test/${marker}.txt`,
    sha256_hash: sha, status: "uploaded", visibility: "private",
    title: `RN-TEST ${marker}`, notes: "rn_seeder",
  }).select("id").single();
  if (error || !data) throw new Error(`upsertMatchDocument(${marker}): ${error?.message}`);
  return data.id as string;
}

async function upsertApiClient(admin: SupabaseClient, orgId: string, marker: string): Promise<string> {
  const { data: hit } = await admin.from("api_clients").select("id")
    .eq("org_id", orgId).eq("legal_entity_name", marker).maybeSingle();
  if (hit) return hit.id as string;
  const { data, error } = await admin.from("api_clients").insert({
    org_id: orgId, legal_entity_name: marker, country: "ZA",
    requested_scopes: [], sandbox_terms_accepted: true,
    sandbox_approved: true, status: "sandbox_active",
  }).select("id").single();
  if (error || !data) throw new Error(`upsertApiClient(${marker}): ${error?.message}`);
  return data.id as string;
}

async function upsertApiKey(
  admin: SupabaseClient,
  orgId: string,
  apiClientId: string,
  createdBy: string,
  marker: string,
): Promise<string> {
  const keyHash = `rn_test_${marker}_hash`;
  const { data: hit } = await admin.from("api_keys").select("id")
    .eq("key_hash", keyHash).maybeSingle();
  if (hit) return hit.id as string;
  const { data, error } = await admin.from("api_keys").insert({
    org_id: orgId, api_client_id: apiClientId, created_by: createdBy,
    name: `RN-TEST ${marker}`, key_hash: keyHash, scopes: ["read:usage"],
    status: "active", environment: "sandbox",
  }).select("id").single();
  if (error || !data) throw new Error(`upsertApiKey(${marker}): ${error?.message}`);
  return data.id as string;
}

async function upsertExportRequest(
  admin: SupabaseClient,
  orgId: string,
  requesterUserId: string,
  marker: string,
): Promise<string> {
  const { data: hit } = await admin.from("export_requests").select("id")
    .eq("target_org_id", orgId).eq("reason", marker).maybeSingle();
  if (hit) return hit.id as string;
  const { data, error } = await admin.from("export_requests").insert({
    kind: "self_export",
    requester_user_id: requesterUserId,
    target_org_id: orgId,
    status: "pending",
    requested_categories: ["profile"],
    purpose: "rn_seeder",
    reason: marker,
  }).select("id").single();
  if (error) {
    // self_export may not be a valid kind in all builds; fall back to a
    // minimal admin_export shell (still pending, never approved/run).
    const fallback = await admin.from("export_requests").insert({
      kind: "admin_export",
      requester_user_id: requesterUserId,
      target_org_id: orgId,
      status: "pending",
      requested_categories: ["profile"],
      purpose: "rn_seeder",
      reason: marker,
    }).select("id").single();
    if (fallback.error || !fallback.data) {
      throw new Error(`upsertExportRequest(${marker}): ${error.message} / fallback: ${fallback.error?.message}`);
    }
    return fallback.data.id as string;
  }
  return data!.id as string;
}

/* ───────────────────────── Handler ───────────────────────── */

Deno.serve(async (req) => {
  const pre = handleCors(req);
  if (pre) return pre;
  if (!authorised(req)) {
    return new Response(JSON.stringify({ ok: false, error: "unauthorised" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  let body: { confirm?: string; password?: string; phase?: 1 | 2 };
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
  const phase = body.phase === 1 ? 1 : 2; // default to full Phase 2

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
    env.push(`export E2E_RN_ENV="live-demo"`);
    env.push(`export E2E_RN_PASSWORD='${body.password}'`);
    env.push(`export E2E_RN_ORG_A_ID="${orgAId}"`);
    env.push(`export E2E_RN_ORG_B_ID="${orgBId}"`);
    for (const a of ACCOUNTS) env.push(`export E2E_RN_${a.envKey}_EMAIL="${a.email}"`);

    let phase2Summary: Record<string, unknown> = { skipped: true };

    if (phase === 2) {
      const orgARequester = userIds["ORG_A_REQUESTER_TRADER"];
      const orgBRequester = userIds["ORG_B_REQUESTER_TRADER"];

      // Entities (one per org, used as buyer/seller pair in the bilateral POI).
      const orgAEntityId = await upsertEntity(admin, orgAId, "RN-TEST Org A Entity");
      const orgBEntityId = await upsertEntity(admin, orgBId, "RN-TEST Org B Entity");

      // Trade requests
      const trAId = await upsertTradeRequest(admin, orgAId, orgARequester, "org-a-tr");
      const trBId = await upsertTradeRequest(admin, orgBId, orgBRequester, "org-b-tr");

      // Matches (Org A owns the A↔B match; Org B owns its own demo match)
      const matchAId = await upsertMatch(admin, orgAId, orgAId, orgBId, trAId, "org-a-match");
      const matchBId = await upsertMatch(admin, orgBId, orgBId, orgAId, trBId, "org-b-match");

      // POIs (bilateral DRAFT)
      const poiAId = await upsertPoi(admin, orgAId, orgAEntityId, orgBEntityId, "RN-TEST-A");
      const poiBId = await upsertPoi(admin, orgBId, orgBEntityId, orgAEntityId, "RN-TEST-B");

      // Match documents
      const docAId = await upsertMatchDocument(admin, matchAId, orgAId, orgARequester, "org-a-doc");
      const docBId = await upsertMatchDocument(admin, matchBId, orgBId, orgBRequester, "org-b-doc");

      // API clients + sandbox keys
      const apiClientAId = await upsertApiClient(admin, orgAId, "RN-TEST Org A API Client");
      const apiClientBId = await upsertApiClient(admin, orgBId, "RN-TEST Org B API Client");
      const apiKeyAId = await upsertApiKey(admin, orgAId, apiClientAId, userIds["ORG_A_API_CLIENT_ADMIN"], "org-a-key");
      const apiKeyBId = await upsertApiKey(admin, orgBId, apiClientBId, userIds["ORG_B_API_CLIENT_ADMIN"], "org-b-key");

      // Governance export candidates (pending, never approved)
      const exportAId = await upsertExportRequest(admin, orgAId, orgARequester, "RN-TEST-A-export");
      const exportBId = await upsertExportRequest(admin, orgBId, orgBRequester, "RN-TEST-B-export");

      env.push(`export E2E_RN_ORG_A_TRADE_REQUEST_ID="${trAId}"`);
      env.push(`export E2E_RN_ORG_B_TRADE_REQUEST_ID="${trBId}"`);
      env.push(`export E2E_RN_ORG_A_MATCH_ID="${matchAId}"`);
      env.push(`export E2E_RN_ORG_B_MATCH_ID="${matchBId}"`);
      env.push(`export E2E_RN_ORG_A_POI_ID="${poiAId}"`);
      env.push(`export E2E_RN_ORG_B_POI_ID="${poiBId}"`);
      env.push(`export E2E_RN_ORG_A_DOCUMENT_ID="${docAId}"`);
      env.push(`export E2E_RN_ORG_B_DOCUMENT_ID="${docBId}"`);
      env.push(`export E2E_RN_ORG_A_API_KEY_ID="${apiKeyAId}"`);
      env.push(`export E2E_RN_ORG_B_API_KEY_ID="${apiKeyBId}"`);
      env.push(`export E2E_RN_ORG_A_GOVERNANCE_EXPORT_ID="${exportAId}"`);
      env.push(`export E2E_RN_ORG_B_GOVERNANCE_EXPORT_ID="${exportBId}"`);

      phase2Summary = {
        seeded: {
          entities: 2, trade_requests: 2, matches: 2, pois: 2,
          match_documents: 2, api_clients: 2, api_keys: 2, export_requests: 2,
        },
        not_seeded: {
          wads:           "requires sealed canonical payload + ledger chain; create via issue_wad RPC",
          refund_requests:"requires a paid token_purchase; do not synthesise — bypasses reconciliation",
        },
      };
    }

    return new Response(JSON.stringify({
      ok: true,
      phase,
      org_a_id: orgAId,
      org_b_id: orgBId,
      users: Object.keys(userIds).length,
      phase2: phase2Summary,
      shell_env: env.join("\n"),
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String((e as Error)?.message ?? e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
