/**
 * seed-smoke-batch-7-fixtures — staging seeder for Admin Export Controls
 * Batch 7 (Live E2E Smoke).
 *
 * Provisions, idempotently, the exact fixture set the smoke harness
 * (`scripts/admin-export-controls-batch-7-smoke.mjs`) needs:
 *
 *   Row R — platform_admin requester  (AAL2, verified TOTP factor)
 *   Row A — platform_admin approver   (AAL2, verified TOTP factor; ≠ Row R)
 *   Row N — platform_admin            (no AAL2 factor)
 *   Row X — non-admin                 (no platform_admin role)
 *
 * Plus a stable random Governance Record UUID for `p_governance_record_id`
 * (the Batch 2 RPC does not require it to FK; it only requires non-null
 * and triggers Batch 6 detection which safely returns "no hold").
 *
 * Returns plain-text shell exports the caller pastes into the smoke env.
 *
 * AUTH (one of):
 *   - x-internal-key: INTERNAL_CRON_KEY
 *   - Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
 *
 * REQUEST:
 *   POST /functions/v1/seed-smoke-batch-7-fixtures
 *   { "confirm": "RUN_SEED_SMOKE_BATCH_7", "password": "<min-12-chars>" }
 *
 * SAFETY RAILS:
 *   - All seeded emails match @test.izenzo.co.za (auto-verified domain)
 *   - Idempotent: re-running upserts and never duplicates
 *   - TOTP secrets are returned ONLY in the seeder response for the
 *     immediately-following smoke run; do not log or commit them.
 *   - Does NOT touch DATA-004, cron, retention, or storage.
 *   - Does NOT create export_requests, approvals, or any audit rows of
 *     its own — the smoke run does that against the real edge fns.
 */

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders as __buildCorsHeaders, handleCors as __handleCors } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INTERNAL_CRON_KEY = Deno.env.get("INTERNAL_CRON_KEY") ?? "";

const TEST_SUFFIX = "@test.izenzo.co.za";

const ACCOUNTS = {
  requester: {
    email: `smoke-b7-requester${TEST_SUFFIX}`,
    full_name: "Smoke B7 Requester (TOTP · FIXTURE)",
  },
  approver: {
    email: `smoke-b7-approver${TEST_SUFFIX}`,
    full_name: "Smoke B7 Approver (TOTP · FIXTURE)",
  },
  aal1_admin: {
    email: `smoke-b7-aal1-admin${TEST_SUFFIX}`,
    full_name: "Smoke B7 Admin (no MFA · FIXTURE)",
  },
  non_admin: {
    email: `smoke-b7-non-admin${TEST_SUFFIX}`,
    full_name: "Smoke B7 Non-Admin (FIXTURE)",
  },
} as const;

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
      user_metadata: { full_name: fullName, fixture: "smoke-b7" },
    });
    return existing;
  }
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, fixture: "smoke-b7" },
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

async function clearAllTotpFactors(admin: SupabaseClient, userId: string) {
  const { data: factors } = await admin.auth.admin.mfa.listFactors({ userId });
  for (const factor of factors?.factors ?? []) {
    await admin.auth.admin.mfa.deleteFactor({ userId, id: factor.id });
  }
}

async function ensureVerifiedTotp(
  admin: SupabaseClient,
  userId: string,
  email: string,
  password: string,
): Promise<{ factorId: string; secret: string }> {
  await clearAllTotpFactors(admin, userId);

  const userClient = createClient(SUPABASE_URL, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: signInError } = await userClient.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`mfa fixture signin ${email}: ${signInError.message}`);
  const { data: enrolled, error: enrollError } = await userClient.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: "smoke-b7-fixture",
    issuer: "Izenzo Smoke B7",
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

function randomUuid(): string {
  return crypto.randomUUID();
}

Deno.serve(async (req) => {
  const corsHeaders = __buildCorsHeaders(Deno.env.get("ALLOWED_ORIGINS") || "", req.headers.get("origin"));
  const __pf = __handleCors(req, Deno.env.get("ALLOWED_ORIGINS") || "");
  if (__pf) return __pf;
  function json(b: unknown, s = 200) {
    return new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!authorised(req)) return json({ error: "unauthorized" }, 401);

  let body: { confirm?: string; password?: string };
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }
  if (body.confirm !== "RUN_SEED_SMOKE_BATCH_7") {
    return json({ error: "confirm phrase required: RUN_SEED_SMOKE_BATCH_7" }, 400);
  }
  if (!body.password || body.password.length < 12) {
    return json({ error: "password (≥12 chars) required" }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    // Row R — requester (platform_admin + TOTP)
    const requesterId = await upsertUser(admin, ACCOUNTS.requester.email, body.password, ACCOUNTS.requester.full_name);
    await ensureRole(admin, requesterId, "platform_admin");
    const requesterTotp = await ensureVerifiedTotp(admin, requesterId, ACCOUNTS.requester.email, body.password);

    // Row A — approver (platform_admin + TOTP, distinct user)
    const approverId = await upsertUser(admin, ACCOUNTS.approver.email, body.password, ACCOUNTS.approver.full_name);
    await ensureRole(admin, approverId, "platform_admin");
    const approverTotp = await ensureVerifiedTotp(admin, approverId, ACCOUNTS.approver.email, body.password);

    // Row N — AAL1 platform_admin (no TOTP)
    const aal1Id = await upsertUser(admin, ACCOUNTS.aal1_admin.email, body.password, ACCOUNTS.aal1_admin.full_name);
    await ensureRole(admin, aal1Id, "platform_admin");
    await clearAllTotpFactors(admin, aal1Id);

    // Row X — non-admin (no platform_admin role; clear any prior)
    const nonAdminId = await upsertUser(admin, ACCOUNTS.non_admin.email, body.password, ACCOUNTS.non_admin.full_name);
    await clearRole(admin, nonAdminId, "platform_admin");
    await clearAllTotpFactors(admin, nonAdminId);

    // Stable-random Governance Record UUID. Batch 2 RPC accepts any uuid;
    // Batch 6 detection returns no_hold for unknown anchors (safe).
    const governanceRecordId = randomUuid();

    const env = [
      `# --- Admin Export Controls Batch 7 smoke env (do not commit) ---`,
      `export SMOKE_BASE_URL="${SUPABASE_URL}"`,
      `export SMOKE_ANON_KEY="${ANON}"`,
      `export SMOKE_REQUESTER_EMAIL="${ACCOUNTS.requester.email}"`,
      `export SMOKE_REQUESTER_PASSWORD="${body.password}"`,
      `export SMOKE_REQUESTER_TOTP_SECRET="${requesterTotp.secret}"`,
      `export SMOKE_APPROVER_EMAIL="${ACCOUNTS.approver.email}"`,
      `export SMOKE_APPROVER_PASSWORD="${body.password}"`,
      `export SMOKE_APPROVER_TOTP_SECRET="${approverTotp.secret}"`,
      `export SMOKE_AAL1_ADMIN_EMAIL="${ACCOUNTS.aal1_admin.email}"`,
      `export SMOKE_AAL1_ADMIN_PASSWORD="${body.password}"`,
      `export SMOKE_NON_ADMIN_EMAIL="${ACCOUNTS.non_admin.email}"`,
      `export SMOKE_NON_ADMIN_PASSWORD="${body.password}"`,
      `export SMOKE_GOVERNANCE_RECORD_ID="${governanceRecordId}"`,
    ].join("\n");

    return json({
      ok: true,
      users: {
        requester: { id: requesterId, email: ACCOUNTS.requester.email, totp_factor_id: requesterTotp.factorId },
        approver:  { id: approverId,  email: ACCOUNTS.approver.email,  totp_factor_id: approverTotp.factorId  },
        aal1_admin:{ id: aal1Id,      email: ACCOUNTS.aal1_admin.email },
        non_admin: { id: nonAdminId,  email: ACCOUNTS.non_admin.email  },
      },
      governance_record_id: governanceRecordId,
      shell_env: env,
    });
  } catch (e) {
    console.error("[seed-smoke-batch-7-fixtures]", e);
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});
