/**
 * seed-smoke-a-d-fixtures — staging seeder for the Daniel retest pack.
 *
 * Creates an idempotent, isolated fixture matching the Smoke A–D gate:
 *
 *   - one platform_admin WITHOUT TOTP   (Row A)
 *   - one platform_admin WITH a verified TOTP factor (Row B)
 *   - one org_admin in a demo organisation (Rows C + D)
 *   - two completed token_purchases on that org:
 *       • purchase_clean    — no refund_request (used by Row C)
 *       • purchase_pending  — pre-seeded pending refund_request (used by Row D)
 *
 * Returns plain-text shell exports the caller can paste straight into
 * the Playwright env block (see e2e/README.md).
 *
 * AUTH (one of):
 *   - x-internal-key: INTERNAL_CRON_KEY
 *   - Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
 *
 * REQUEST:
 *   POST /functions/v1/seed-smoke-a-d-fixtures
 *   { "confirm": "RUN_SEED_SMOKE_A_D", "password": "<min-12-chars>" }
 *
 * SAFETY RAILS:
 *   - All seeded emails match @test.izenzo.co.za (gate matches provision-test-user)
 *   - Organisation flagged is_demo=true (skipped by lifecycle / billing crons)
 *   - Idempotent: re-running upserts and never duplicates
 *   - TOTP secret is a fixed, well-known base32 string scoped to *test fixtures only*
 *     and rotated by re-seeding with a different `totp_secret` in the request body
 */

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INTERNAL_CRON_KEY = Deno.env.get("INTERNAL_CRON_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-internal-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const TEST_SUFFIX = "@test.izenzo.co.za";
const ORG_NAME = "SMOKE A-D Fixture Org";

const ACCOUNTS = {
  admin_no_mfa: {
    email: `smoke-admin-nomfa${TEST_SUFFIX}`,
    full_name: "Smoke Admin (no MFA · FIXTURE)",
  },
  admin_mfa: {
    email: `smoke-admin-mfa${TEST_SUFFIX}`,
    full_name: "Smoke Admin (TOTP · FIXTURE)",
  },
  org_admin: {
    email: `smoke-org-admin${TEST_SUFFIX}`,
    full_name: "Smoke Org Admin (FIXTURE)",
  },
} as const;

const PURCHASE_CLEAN_REF = "smoke-ad-clean-001";
const PURCHASE_PENDING_REF = "smoke-ad-pending-001";

// Default TOTP secret — overridable in request body. Base32, 16 chars.
const DEFAULT_TOTP_SECRET = "JBSWY3DPEHPK3PXP";

function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: corsHeaders });
}

function authorised(req: Request): boolean {
  const internal = req.headers.get("x-internal-key");
  if (internal && INTERNAL_CRON_KEY && internal === INTERNAL_CRON_KEY) return true;
  const auth = req.headers.get("Authorization") ?? "";
  if (auth === `Bearer ${SERVICE_ROLE}`) return true;
  return false;
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

async function upsertUser(
  admin: SupabaseClient,
  email: string,
  password: string,
  fullName: string,
): Promise<string> {
  const existing = await findUserByEmail(admin, email);
  if (existing) {
    await admin.auth.admin.updateUserById(existing, {
      email_confirm: true,
      password,
      user_metadata: { full_name: fullName, fixture: "smoke-a-d" },
    });
    return existing;
  }
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, fixture: "smoke-a-d" },
  });
  if (error || !data.user) throw new Error(`createUser ${email}: ${error?.message}`);
  return data.user.id;
}

async function ensureRole(admin: SupabaseClient, userId: string, role: string) {
  await admin.from("user_roles").upsert({ user_id: userId, role }, { onConflict: "user_id,role" });
}

async function ensureVerifiedTotp(
  admin: SupabaseClient,
  userId: string,
  secret: string,
) {
  // Direct insert into auth.mfa_factors — only possible via service_role.
  // GoTrue treats a status='verified' totp factor as fully enrolled, so
  // subsequent password sign-ins step up to aal2 via a TOTP challenge.
  const { data: existing } = await admin
    .schema("auth" as never)
    .from("mfa_factors" as never)
    .select("id, status, secret")
    .eq("user_id", userId)
    .eq("factor_type", "totp" as never);
  const rows = (existing as Array<{ id: string; status: string; secret: string }> | null) ?? [];
  const verified = rows.find((r) => r.status === "verified");
  if (verified && verified.secret === secret) return verified.id;
  // Remove any stale factors so we converge on a single known-good one.
  for (const r of rows) {
    await admin.schema("auth" as never).from("mfa_factors" as never).delete().eq("id", r.id);
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const { error } = await admin
    .schema("auth" as never)
    .from("mfa_factors" as never)
    .insert({
      id,
      user_id: userId,
      friendly_name: "smoke-a-d-fixture",
      factor_type: "totp",
      status: "verified",
      secret,
      created_at: now,
      updated_at: now,
    } as never);
  if (error) throw new Error(`mfa_factors insert: ${error.message}`);
  return id;
}

async function ensureOrg(admin: SupabaseClient): Promise<string> {
  const { data: existing } = await admin
    .from("organizations").select("id").eq("name", ORG_NAME).maybeSingle();
  if (existing?.id) {
    await admin.from("organizations").update({ is_demo: true } as never).eq("id", existing.id);
    return existing.id;
  }
  const { data, error } = await admin
    .from("organizations")
    .insert({ name: ORG_NAME, is_demo: true } as never)
    .select("id").single();
  if (error || !data) throw new Error(`org insert: ${error?.message}`);
  return data.id;
}

async function ensureProfile(admin: SupabaseClient, userId: string, orgId: string, email: string, fullName: string) {
  await admin.from("profiles").upsert(
    { id: userId, org_id: orgId, email, full_name: fullName, is_demo: true } as never,
    { onConflict: "id" },
  );
}

async function ensureCompletedPurchase(
  admin: SupabaseClient,
  orgId: string,
  userId: string,
  reference: string,
): Promise<string> {
  const { data: existing } = await admin
    .from("token_purchases").select("id").eq("paystack_reference", reference).maybeSingle();
  if (existing?.id) {
    await admin.from("token_purchases").update({ status: "completed" } as never).eq("id", existing.id);
    return existing.id;
  }
  const { data, error } = await admin.from("token_purchases").insert({
    org_id: orgId,
    user_id: userId,
    paystack_reference: reference,
    package_id: "pack_10",
    token_amount: 10,
    amount_usd: 10,
    currency: "USD",
    status: "completed",
    metadata: { fixture: "smoke-a-d", fx_basis: "native_usd" },
  } as never).select("id").single();
  if (error || !data) throw new Error(`purchase insert ${reference}: ${error?.message}`);
  return data.id;
}

async function ensurePendingRefund(
  admin: SupabaseClient,
  orgId: string,
  userId: string,
  purchaseId: string,
) {
  const { data: existing } = await admin
    .from("refund_requests").select("id, status")
    .eq("token_purchase_id", purchaseId).maybeSingle();
  if (existing?.id) {
    if (existing.status !== "pending") {
      await admin.from("refund_requests").update({ status: "pending" } as never).eq("id", existing.id);
    }
    return existing.id;
  }
  const { data, error } = await admin.from("refund_requests").insert({
    org_id: orgId,
    requested_by: userId,
    token_purchase_id: purchaseId,
    reason_code: "duplicate_purchase",
    reason_detail: "Smoke A-D fixture seeded pending refund (Row D precondition).",
    credits_at_request: 10,
    credits_used_at_request: 0,
    status: "pending",
    metadata: { fixture: "smoke-a-d" },
  } as never).select("id").single();
  if (error || !data) throw new Error(`refund insert: ${error?.message}`);
  return data.id;
}

async function ensureCleanRefund(admin: SupabaseClient, purchaseId: string) {
  // Smoke C requires NO pending refund on this purchase — drop any.
  await admin.from("refund_requests").delete().eq("token_purchase_id", purchaseId);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!authorised(req)) return json({ error: "unauthorized" }, 401);

  let body: { confirm?: string; password?: string; totp_secret?: string };
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }
  if (body.confirm !== "RUN_SEED_SMOKE_A_D") {
    return json({ error: "confirm phrase required: RUN_SEED_SMOKE_A_D" }, 400);
  }
  if (!body.password || body.password.length < 12) {
    return json({ error: "password (≥12 chars) required" }, 400);
  }
  const totpSecret = body.totp_secret ?? DEFAULT_TOTP_SECRET;

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const orgId = await ensureOrg(admin);

    const adminNoMfaId = await upsertUser(admin, ACCOUNTS.admin_no_mfa.email, body.password, ACCOUNTS.admin_no_mfa.full_name);
    await ensureRole(admin, adminNoMfaId, "platform_admin");
    await ensureProfile(admin, adminNoMfaId, orgId, ACCOUNTS.admin_no_mfa.email, ACCOUNTS.admin_no_mfa.full_name);
    // Remove any TOTP factors so this account stays aal1.
    await admin.schema("auth" as never).from("mfa_factors" as never).delete().eq("user_id", adminNoMfaId);

    const adminMfaId = await upsertUser(admin, ACCOUNTS.admin_mfa.email, body.password, ACCOUNTS.admin_mfa.full_name);
    await ensureRole(admin, adminMfaId, "platform_admin");
    await ensureProfile(admin, adminMfaId, orgId, ACCOUNTS.admin_mfa.email, ACCOUNTS.admin_mfa.full_name);
    await ensureVerifiedTotp(admin, adminMfaId, totpSecret);

    const orgAdminId = await upsertUser(admin, ACCOUNTS.org_admin.email, body.password, ACCOUNTS.org_admin.full_name);
    await ensureRole(admin, orgAdminId, "org_admin");
    await ensureProfile(admin, orgAdminId, orgId, ACCOUNTS.org_admin.email, ACCOUNTS.org_admin.full_name);

    const cleanPurchaseId = await ensureCompletedPurchase(admin, orgId, orgAdminId, PURCHASE_CLEAN_REF);
    await ensureCleanRefund(admin, cleanPurchaseId);

    const pendingPurchaseId = await ensureCompletedPurchase(admin, orgId, orgAdminId, PURCHASE_PENDING_REF);
    const pendingRefundId = await ensurePendingRefund(admin, orgId, orgAdminId, pendingPurchaseId);

    const env = [
      `# --- Smoke A–D fixture exports ---`,
      `export SMOKE_ADMIN_EMAIL="${ACCOUNTS.admin_no_mfa.email}"`,
      `export SMOKE_ADMIN_PASSWORD="${body.password}"`,
      `export SMOKE_ADMIN_AAL2_EMAIL="${ACCOUNTS.admin_mfa.email}"`,
      `export SMOKE_ADMIN_AAL2_PASSWORD="${body.password}"`,
      `export SMOKE_ADMIN_AAL2_TOTP_SECRET="${totpSecret}"`,
      `export SMOKE_ORG_EMAIL="${ACCOUNTS.org_admin.email}"`,
      `export SMOKE_ORG_PASSWORD="${body.password}"`,
      `export SMOKE_LEGAL_HOLD_SCOPE_ID="${orgId}"`,
    ].join("\n");

    return json({
      ok: true,
      org_id: orgId,
      users: {
        admin_no_mfa: { id: adminNoMfaId, email: ACCOUNTS.admin_no_mfa.email },
        admin_mfa: { id: adminMfaId, email: ACCOUNTS.admin_mfa.email, totp_secret: totpSecret },
        org_admin: { id: orgAdminId, email: ACCOUNTS.org_admin.email },
      },
      purchases: {
        clean: { id: cleanPurchaseId, reference: PURCHASE_CLEAN_REF },
        with_pending_refund: {
          id: pendingPurchaseId,
          reference: PURCHASE_PENDING_REF,
          refund_request_id: pendingRefundId,
        },
      },
      legal_hold_scope_id: orgId,
      shell_env: env,
    });
  } catch (e) {
    console.error("[seed-smoke-a-d-fixtures]", e);
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});
