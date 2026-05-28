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
 *   - TOTP is enrolled through the supported auth API; the generated base32
 *     secret is returned only in the seeder response for staging smoke use
 */

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
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

function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: corsHeaders });
}

function base32ToBytes(input: string): Uint8Array {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of input.toUpperCase().replace(/=+$/g, "").replace(/\s+/g, "")) {
    const value = alphabet.indexOf(ch);
    if (value < 0) throw new Error("invalid totp secret");
    bits += value.toString(2).padStart(5, "0");
  }
  const out = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  return out;
}

async function totpCode(secret: string, at = Date.now()): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    base32ToBytes(secret),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const counter = Math.floor(at / 30_000);
  const msg = new ArrayBuffer(8);
  const view = new DataView(msg);
  view.setUint32(4, counter, false);
  const hmac = new Uint8Array(await crypto.subtle.sign("HMAC", key, msg));
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin = ((hmac[offset] & 0x7f) << 24)
    | (hmac[offset + 1] << 16)
    | (hmac[offset + 2] << 8)
    | hmac[offset + 3];
  return String(bin % 1_000_000).padStart(6, "0");
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
  email: string,
  password: string,
) {
  const { data: factors, error: listError } = await admin.auth.admin.mfa.listFactors({ userId });
  if (listError) throw new Error(`mfa list factors: ${listError.message}`);
  for (const factor of factors?.factors ?? []) {
    const { error } = await admin.auth.admin.mfa.deleteFactor({ userId, id: factor.id });
    if (error) throw new Error(`mfa delete factor: ${error.message}`);
  }

  const userClient = createClient(SUPABASE_URL, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: signInError } = await userClient.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`mfa fixture signin: ${signInError.message}`);
  const { data: enrolled, error: enrollError } = await userClient.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: "smoke-a-d-fixture",
    issuer: "Izenzo Smoke",
  });
  if (enrollError || !enrolled) throw new Error(`mfa enroll: ${enrollError?.message}`);
  const secret = enrolled.totp.secret;
  const { data: challenge, error: challengeError } = await userClient.auth.mfa.challenge({ factorId: enrolled.id });
  if (challengeError || !challenge) throw new Error(`mfa challenge: ${challengeError?.message}`);
  const { error: verifyError } = await userClient.auth.mfa.verify({
    factorId: enrolled.id,
    challengeId: challenge.id,
    code: await totpCode(secret),
  });
  if (verifyError) throw new Error(`mfa verify: ${verifyError.message}`);
  await userClient.auth.signOut({ scope: "global" });
  return { factorId: enrolled.id, secret };
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

  let body: { confirm?: string; password?: string };
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }
  if (body.confirm !== "RUN_SEED_SMOKE_A_D") {
    return json({ error: "confirm phrase required: RUN_SEED_SMOKE_A_D" }, 400);
  }
  if (!body.password || body.password.length < 12) {
    return json({ error: "password (≥12 chars) required" }, 400);
  }
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
    const mfa = await ensureVerifiedTotp(admin, adminMfaId, ACCOUNTS.admin_mfa.email, body.password);

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
      `export SMOKE_ADMIN_AAL2_TOTP_SECRET="${mfa.secret}"`,
      `export SMOKE_ORG_EMAIL="${ACCOUNTS.org_admin.email}"`,
      `export SMOKE_ORG_PASSWORD="${body.password}"`,
      `export SMOKE_LEGAL_HOLD_SCOPE_ID="${orgId}"`,
    ].join("\n");

    return json({
      ok: true,
      org_id: orgId,
      users: {
        admin_no_mfa: { id: adminNoMfaId, email: ACCOUNTS.admin_no_mfa.email },
        admin_mfa: { id: adminMfaId, email: ACCOUNTS.admin_mfa.email, totp_factor_id: mfa.factorId, totp_secret: mfa.secret },
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
