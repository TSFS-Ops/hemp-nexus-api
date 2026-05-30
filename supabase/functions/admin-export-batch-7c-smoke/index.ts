/**
 * admin-export-batch-7c-smoke — Admin Export Controls · Batch 7C.
 *
 * STAGING-ONLY internal smoke runner. Performs the same end-to-end proof
 * as `scripts/admin-export-controls-batch-7-smoke.mjs` but server-side,
 * removing the need for a human operator to handle service-role
 * credentials, TOTP secrets, or local shell.
 *
 * The function:
 *   1. Refuses to run in production (`is_production_environment()`).
 *   2. Requires service_role OR INTERNAL_CRON_KEY.
 *   3. Requires confirm phrase RUN_ADMIN_EXPORT_BATCH_7C_SMOKE.
 *   4. Seeds the four `@test.izenzo.co.za` fixture users + TOTP factors
 *      (idempotent; same shape as seed-smoke-batch-7-fixtures).
 *   5. Signs in as each fixture, upgrades to AAL2 where needed, and
 *      exercises the three governance-export edge functions over HTTP:
 *        - admin-governance-export-request
 *        - admin-governance-export-approve
 *        - admin-governance-export-list
 *   6. Reads back audit_logs to confirm:
 *        data.admin_export_requested
 *        data.admin_export_approved
 *        data.admin_export_blocked_or_declined
 *   7. Generation-leak regex scan on every response payload.
 *   8. Returns evidence JSON inline. Passwords/TOTP secrets are NEVER
 *      included in evidence — only user ids, emails, and check results.
 *
 * Does NOT call: prepare / download / destroy / file generation /
 * signed-URL creation. Does NOT mutate: legal_holds, export_requests
 * directly, per-org retention tables, cron, retention, cold-storage,
 * archive, or any DATA-004 surface.
 *
 * AUTH (one of):
 *   - x-internal-key: INTERNAL_CRON_KEY
 *   - Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
 *
 * REQUEST:
 *   POST /functions/v1/admin-export-batch-7c-smoke
 *   { "confirm": "RUN_ADMIN_EXPORT_BATCH_7C_SMOKE" }
 *
 * RESPONSE: machine-readable evidence equivalent to
 *   evidence/admin-export-controls-batch-7-live-e2e-smoke.json
 */

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders as __buildCorsHeaders, handleCors as __handleCors } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INTERNAL_CRON_KEY = Deno.env.get("INTERNAL_CRON_KEY") ?? "";

const TEST_SUFFIX = "@test.izenzo.co.za";
const CONFIRM_PHRASE = "RUN_ADMIN_EXPORT_BATCH_7C_SMOKE";

const ACCOUNTS = {
  requester:  { email: `smoke-b7c-requester${TEST_SUFFIX}`,  full_name: "Smoke B7C Requester (TOTP · FIXTURE)" },
  approver:   { email: `smoke-b7c-approver${TEST_SUFFIX}`,   full_name: "Smoke B7C Approver (TOTP · FIXTURE)" },
  aal1_admin: { email: `smoke-b7c-aal1-admin${TEST_SUFFIX}`, full_name: "Smoke B7C Admin (no MFA · FIXTURE)" },
  non_admin:  { email: `smoke-b7c-non-admin${TEST_SUFFIX}`,  full_name: "Smoke B7C Non-Admin (FIXTURE)" },
} as const;

const FIXTURE_PASSWORD = `Smoke-B7C-${new Date().toISOString().slice(0,10)}-Fixture!`;

// ─── auth + TOTP helpers (parity with seed-smoke-batch-7-fixtures) ───

function base32ToBytes(input: string): Uint8Array {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of input.toUpperCase().replace(/=+$/g, "").replace(/\s+/g, "")) {
    const v = alphabet.indexOf(ch);
    if (v < 0) throw new Error("invalid totp secret");
    bits += v.toString(2).padStart(5, "0");
  }
  const out = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  return out;
}

async function totpCode(secret: string, at = Date.now()): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", base32ToBytes(secret),
    { name: "HMAC", hash: "SHA-1" }, false, ["sign"],
  );
  const counter = Math.floor(at / 30_000);
  const msg = new ArrayBuffer(8);
  new DataView(msg).setUint32(4, counter, false);
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
  return req.headers.get("Authorization") === `Bearer ${SERVICE_ROLE}`;
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
    await admin.auth.admin.updateUserById(existing, {
      email_confirm: true, password,
      user_metadata: { full_name: fullName, fixture: "smoke-b7c" },
    });
    return existing;
  }
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { full_name: fullName, fixture: "smoke-b7c" },
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
  for (const f of factors?.factors ?? []) {
    await admin.auth.admin.mfa.deleteFactor({ userId, id: f.id });
  }
}

async function ensureVerifiedTotp(
  userId: string, email: string, password: string, admin: SupabaseClient,
): Promise<{ factorId: string; secret: string }> {
  await clearAllTotpFactors(admin, userId);
  const userClient = createClient(SUPABASE_URL, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: signInError } = await userClient.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`mfa fixture signin ${email}: ${signInError.message}`);
  const { data: enrolled, error: enrollError } = await userClient.auth.mfa.enroll({
    factorType: "totp", friendlyName: "smoke-b7c-fixture", issuer: "Izenzo Smoke B7C",
  });
  if (enrollError || !enrolled) throw new Error(`mfa enroll: ${enrollError?.message}`);
  const secret = enrolled.totp.secret;
  const { data: challenge, error: chErr } = await userClient.auth.mfa.challenge({ factorId: enrolled.id });
  if (chErr || !challenge) throw new Error(`mfa challenge: ${chErr?.message}`);
  const { error: vErr } = await userClient.auth.mfa.verify({
    factorId: enrolled.id, challengeId: challenge.id, code: await totpCode(secret),
  });
  if (vErr) throw new Error(`mfa verify: ${vErr.message}`);
  await userClient.auth.signOut({ scope: "global" });
  return { factorId: enrolled.id, secret };
}

// ─── sign-in / AAL2 upgrade against staging Auth REST ───

async function passwordSignIn(email: string, password: string): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json();
  if (res.status !== 200 || !body?.access_token) {
    throw new Error(`signIn ${email} status=${res.status} body=${JSON.stringify(body)}`);
  }
  return body.access_token;
}

async function upgradeToAal2(accessToken: string, totpSecret: string): Promise<string> {
  const listRes = await fetch(`${SUPABASE_URL}/auth/v1/factors`, {
    headers: { apikey: ANON, Authorization: `Bearer ${accessToken}` },
  });
  const listBody = await listRes.json();
  // deno-lint-ignore no-explicit-any
  const all: any[] = listBody?.totp ?? listBody?.all ?? listBody?.factors ?? [];
  const factor = all.find((f) => f.status === "verified" && (f.factor_type === "totp" || f.type === "totp"));
  if (!factor) throw new Error("no verified TOTP factor for AAL2 upgrade");
  const chRes = await fetch(`${SUPABASE_URL}/auth/v1/factors/${factor.id}/challenge`, {
    method: "POST", headers: { apikey: ANON, Authorization: `Bearer ${accessToken}` },
  });
  const challenge = await chRes.json();
  const vRes = await fetch(`${SUPABASE_URL}/auth/v1/factors/${factor.id}/verify`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ challenge_id: challenge.id, code: await totpCode(totpSecret) }),
  });
  const vBody = await vRes.json();
  if (!vBody?.access_token) throw new Error(`AAL2 verify failed: ${JSON.stringify(vBody)}`);
  return vBody.access_token;
}

async function callFn(name: string, token: string, body: unknown) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body ?? {}),
  });
  const raw = await res.text();
  let parsed: unknown;
  try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = raw; }
  return { status: res.status, body: parsed, raw };
}

// ─── evidence shape ───

type Paths = Record<string, { status?: number; body?: unknown; checks: Array<{ ok: boolean; msg: string; [k: string]: unknown }> }>;
const evidence = {
  batch: "7C",
  runner: "admin-export-batch-7c-smoke",
  staging_only: true,
  trigger: {
    confirm_phrase_required: CONFIRM_PHRASE,
    auth: "service_role OR INTERNAL_CRON_KEY",
    production_refused: true,
  },
  started_at: new Date().toISOString(),
  finished_at: "",
  base_url: SUPABASE_URL,
  fixture_users: {} as Record<string, { id: string; email: string; role: "platform_admin" | "none"; aal2: boolean }>,
  governance_record_id: "",
  request_id: null as string | null,
  paths: {} as Paths,
  no_generation_proof: {
    file_generated: false,
    download_link_present: false,
    signed_url_present: false,
    prepare_called: false,
    destroy_called: false,
    legal_holds_mutated: false,
  },
  data_004_touched: false,
  cron_touched: false,
  audit_events_present: {
    "data.admin_export_requested": false,
    "data.admin_export_approved": false,
    "data.admin_export_blocked_or_declined": false,
  },
  cleanup_needed: false,
  runner_disposition: "remains_guarded_staging_only",
  failures: [] as string[],
};

function pass(p: string, msg: string, extra?: Record<string, unknown>) {
  evidence.paths[p] = evidence.paths[p] || { checks: [] };
  evidence.paths[p].checks.push({ ok: true, msg, ...(extra ?? {}) });
}
function fail(p: string, msg: string, extra?: Record<string, unknown>) {
  evidence.paths[p] = evidence.paths[p] || { checks: [] };
  evidence.paths[p].checks.push({ ok: false, msg, ...(extra ?? {}) });
  evidence.failures.push(`[${p}] ${msg}`);
}

function assertNoGenerationLeak(p: string, raw: string) {
  const checks: Array<[string, RegExp, keyof typeof evidence.no_generation_proof | null]> = [
    ["signed_url",            /signed_url|signedUrl|createSignedUrl/i, "signed_url_present"],
    ["download_link",         /download_link|downloadUrl|download_url/i, "download_link_present"],
    ["prepare",               /\b(prepare|prepared)\b/i, "prepare_called"],
    ["destroy",               /\b(destroy|destroyed)\b/i, "destroy_called"],
    ["csv_blob",              /\b(text\/csv|Content-Disposition|new\s+Blob)\b/i, null],
    ["generated_file_marker", /generated_file|file_path|storage_object/i, "file_generated"],
  ];
  for (const [label, re, flagKey] of checks) {
    if (re.test(raw)) {
      fail(p, `unexpected ${label} marker present in response`);
      if (flagKey) (evidence.no_generation_proof as Record<string, boolean>)[flagKey] = true;
    }
  }
}

// ─── handler ───

Deno.serve(async (req) => {
  const corsHeaders = __buildCorsHeaders(Deno.env.get("ALLOWED_ORIGINS") || "", req.headers.get("origin"));
  const __pf = __handleCors(req, Deno.env.get("ALLOWED_ORIGINS") || "");
  if (__pf) return __pf;
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!authorised(req)) return json({ error: "unauthorized" }, 401);

  let body: { confirm?: string };
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }
  if (body.confirm !== CONFIRM_PHRASE) {
    return json({ error: `confirm phrase required: ${CONFIRM_PHRASE}` }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // PRODUCTION GUARD — refuse if is_production_environment() returns true.
  try {
    const { data: isProd, error: prodErr } = await admin.rpc("is_production_environment");
    if (prodErr) return json({ error: `production_check_failed: ${prodErr.message}` }, 500);
    if (isProd === true) {
      return json({
        error: "production_refused",
        message: "admin-export-batch-7c-smoke refuses to run when is_production_environment() returns true.",
      }, 403);
    }
  } catch (e) {
    return json({ error: `production_check_threw: ${(e as Error).message}` }, 500);
  }

  try {
    // ── seed fixtures ──
    const requesterId = await upsertUser(admin, ACCOUNTS.requester.email,  FIXTURE_PASSWORD, ACCOUNTS.requester.full_name);
    await ensureRole(admin, requesterId, "platform_admin");
    const requesterTotp = await ensureVerifiedTotp(requesterId, ACCOUNTS.requester.email, FIXTURE_PASSWORD, admin);

    const approverId = await upsertUser(admin, ACCOUNTS.approver.email,   FIXTURE_PASSWORD, ACCOUNTS.approver.full_name);
    await ensureRole(admin, approverId, "platform_admin");
    const approverTotp = await ensureVerifiedTotp(approverId, ACCOUNTS.approver.email, FIXTURE_PASSWORD, admin);

    const aal1Id = await upsertUser(admin, ACCOUNTS.aal1_admin.email, FIXTURE_PASSWORD, ACCOUNTS.aal1_admin.full_name);
    await ensureRole(admin, aal1Id, "platform_admin");
    await clearAllTotpFactors(admin, aal1Id);

    const nonAdminId = await upsertUser(admin, ACCOUNTS.non_admin.email, FIXTURE_PASSWORD, ACCOUNTS.non_admin.full_name);
    await clearRole(admin, nonAdminId, "platform_admin");
    await clearAllTotpFactors(admin, nonAdminId);

    evidence.fixture_users = {
      requester:  { id: requesterId, email: ACCOUNTS.requester.email,  role: "platform_admin", aal2: true  },
      approver:   { id: approverId,  email: ACCOUNTS.approver.email,   role: "platform_admin", aal2: true  },
      aal1_admin: { id: aal1Id,      email: ACCOUNTS.aal1_admin.email, role: "platform_admin", aal2: false },
      non_admin:  { id: nonAdminId,  email: ACCOUNTS.non_admin.email,  role: "none",           aal2: false },
    };

    const GOV_ID = crypto.randomUUID();
    evidence.governance_record_id = GOV_ID;

    const REQUEST_BODY = {
      governance_record_id: GOV_ID,
      purpose: "compliance_review",
      reason: "Batch 7C internal smoke — request → approval → list visibility.",
      requested_categories: ["governance_record_index"],
      target_org_id: null,
      redaction_mode: "redacted_client_safe",
    };

    let requestId: string | null = null;

    // ── A: requester (AAL2) creates request ──
    {
      const lbl = "A_request_success";
      try {
        const t1 = await passwordSignIn(ACCOUNTS.requester.email, FIXTURE_PASSWORD);
        const t2 = await upgradeToAal2(t1, requesterTotp.secret);
        const res = await callFn("admin-governance-export-request", t2, REQUEST_BODY);
        evidence.paths[lbl] = { status: res.status, body: res.body, checks: [] };
        if (res.status !== 200) fail(lbl, `expected 200 got ${res.status}`);
        // deno-lint-ignore no-explicit-any
        const b = res.body as any;
        if (!b?.ok || !b?.request_id) fail(lbl, "no request_id");
        else {
          requestId = b.request_id;
          evidence.request_id = requestId;
          if (b.status !== "awaiting_approval") fail(lbl, `bad status ${b.status}`);
          if (b.redaction_mode !== "redacted_client_safe") fail(lbl, "redaction_mode drift");
          assertNoGenerationLeak(lbl, res.raw);
          pass(lbl, "request created", { request_id: requestId });
        }
      } catch (e) { fail(lbl, `threw: ${(e as Error).message}`); }
    }

    // ── B1: AAL1 admin → MFA_REQUIRED ──
    {
      const lbl = "B1_request_denied_aal1";
      try {
        const t = await passwordSignIn(ACCOUNTS.aal1_admin.email, FIXTURE_PASSWORD);
        const res = await callFn("admin-governance-export-request", t, REQUEST_BODY);
        evidence.paths[lbl] = { status: res.status, body: res.body, checks: [] };
        // deno-lint-ignore no-explicit-any
        const code = (res.body as any)?.code;
        if (res.status !== 403 || code !== "MFA_REQUIRED")
          fail(lbl, `expected 403/MFA_REQUIRED got ${res.status}/${code}`);
        else { assertNoGenerationLeak(lbl, res.raw); pass(lbl, "AAL1 admin denied"); }
      } catch (e) { fail(lbl, `threw: ${(e as Error).message}`); }
    }

    // ── B2: non-admin → NOT_PLATFORM_ADMIN ──
    {
      const lbl = "B2_request_denied_non_admin";
      try {
        const t = await passwordSignIn(ACCOUNTS.non_admin.email, FIXTURE_PASSWORD);
        const res = await callFn("admin-governance-export-request", t, REQUEST_BODY);
        evidence.paths[lbl] = { status: res.status, body: res.body, checks: [] };
        // deno-lint-ignore no-explicit-any
        const code = (res.body as any)?.code;
        if (res.status !== 403 || code !== "NOT_PLATFORM_ADMIN")
          fail(lbl, `expected 403/NOT_PLATFORM_ADMIN got ${res.status}/${code}`);
        else { assertNoGenerationLeak(lbl, res.raw); pass(lbl, "non-admin denied"); }
      } catch (e) { fail(lbl, `threw: ${(e as Error).message}`); }
    }

    // ── C: approver (different AAL2 admin) approves ──
    {
      const lbl = "C_approval_success";
      if (!requestId) fail(lbl, "no requestId from path A");
      else try {
        const t1 = await passwordSignIn(ACCOUNTS.approver.email, FIXTURE_PASSWORD);
        const t2 = await upgradeToAal2(t1, approverTotp.secret);
        const res = await callFn("admin-governance-export-approve", t2, {
          request_id: requestId, approval_note: "Batch 7C smoke approval",
        });
        evidence.paths[lbl] = { status: res.status, body: res.body, checks: [] };
        // deno-lint-ignore no-explicit-any
        const b = res.body as any;
        if (res.status !== 200) fail(lbl, `expected 200 got ${res.status}`);
        else if (b?.new_status !== "approved") fail(lbl, `bad new_status ${b?.new_status}`);
        else { assertNoGenerationLeak(lbl, res.raw); pass(lbl, "request approved"); }
      } catch (e) { fail(lbl, `threw: ${(e as Error).message}`); }
    }

    // ── D: requester attempts self-approval → SELF_APPROVAL_BLOCKED ──
    {
      const lbl = "D_self_approval_blocked";
      if (!requestId) fail(lbl, "no requestId from path A");
      else try {
        const t1 = await passwordSignIn(ACCOUNTS.requester.email, FIXTURE_PASSWORD);
        const t2 = await upgradeToAal2(t1, requesterTotp.secret);
        const res = await callFn("admin-governance-export-approve", t2, {
          request_id: requestId, approval_note: "self-approval attempt",
        });
        evidence.paths[lbl] = { status: res.status, body: res.body, checks: [] };
        // deno-lint-ignore no-explicit-any
        const code = (res.body as any)?.code;
        if (res.status !== 409 || code !== "SELF_APPROVAL_BLOCKED")
          fail(lbl, `expected 409/SELF_APPROVAL_BLOCKED got ${res.status}/${code}`);
        else { assertNoGenerationLeak(lbl, res.raw); pass(lbl, "self-approval blocked"); }
      } catch (e) { fail(lbl, `threw: ${(e as Error).message}`); }
    }

    // ── E1: approver lists, sees the row, safe fields only ──
    {
      const lbl = "E1_list_visibility";
      try {
        const t1 = await passwordSignIn(ACCOUNTS.approver.email, FIXTURE_PASSWORD);
        const t2 = await upgradeToAal2(t1, approverTotp.secret);
        const res = await callFn("admin-governance-export-list", t2, {
          governance_record_id: GOV_ID,
          statuses: ["approved", "awaiting_approval", "denied", "failed"],
          limit: 50,
        });
        evidence.paths[lbl] = { status: res.status, body: res.body, checks: [] };
        if (res.status !== 200) fail(lbl, `expected 200 got ${res.status}`);
        // deno-lint-ignore no-explicit-any
        const rows: any[] = Array.isArray((res.body as any)?.rows) ? (res.body as any).rows : [];
        const row = rows.find((r) => r.id === requestId || r.export_request_id === requestId);
        if (!row) fail(lbl, "approved request not visible in list");
        else {
          if (/\b(notes|raw_reason|legal_hold_reason)\b/i.test(JSON.stringify(row)))
            fail(lbl, "raw legal-hold reason/notes/metadata exposed in row");
          assertNoGenerationLeak(lbl, res.raw);
          pass(lbl, "row visible with safe fields only");
        }
      } catch (e) { fail(lbl, `threw: ${(e as Error).message}`); }
    }

    // ── E2: AAL1 admin list → 403 ──
    {
      const lbl = "E2_list_denied_aal1";
      try {
        const t = await passwordSignIn(ACCOUNTS.aal1_admin.email, FIXTURE_PASSWORD);
        const res = await callFn("admin-governance-export-list", t, {});
        evidence.paths[lbl] = { status: res.status, body: res.body, checks: [] };
        if (res.status !== 403) fail(lbl, `expected 403 got ${res.status}`);
        else { assertNoGenerationLeak(lbl, res.raw); pass(lbl, "AAL1 admin denied"); }
      } catch (e) { fail(lbl, `threw: ${(e as Error).message}`); }
    }

    // ── E3: non-admin list → 403 ──
    {
      const lbl = "E3_list_denied_non_admin";
      try {
        const t = await passwordSignIn(ACCOUNTS.non_admin.email, FIXTURE_PASSWORD);
        const res = await callFn("admin-governance-export-list", t, {});
        evidence.paths[lbl] = { status: res.status, body: res.body, checks: [] };
        if (res.status !== 403) fail(lbl, `expected 403 got ${res.status}`);
        else { assertNoGenerationLeak(lbl, res.raw); pass(lbl, "non-admin denied"); }
      } catch (e) { fail(lbl, `threw: ${(e as Error).message}`); }
    }

    // ── Audit confirmation via audit_logs ──
    try {
      const { data: auditRows } = await admin
        .from("audit_logs")
        .select("action, metadata, created_at")
        .in("action", [
          "data.admin_export_requested",
          "data.admin_export_approved",
          "data.admin_export_blocked_or_declined",
        ])
        .order("created_at", { ascending: false })
        .limit(200);
      for (const r of auditRows ?? []) {
        // deno-lint-ignore no-explicit-any
        const meta = (r as any).metadata ?? {};
        const matchesRun =
          meta?.request_id === requestId ||
          meta?.governance_record_id === GOV_ID;
        if (matchesRun) {
          (evidence.audit_events_present as Record<string, boolean>)[(r as { action: string }).action] = true;
        }
      }
      const missing = Object.entries(evidence.audit_events_present)
        .filter(([, v]) => !v).map(([k]) => k);
      if (missing.length) fail("audit_events", `missing: ${missing.join(", ")}`);
      else pass("audit_events", "all three audit actions present for this run");
    } catch (e) { fail("audit_events", `audit lookup threw: ${(e as Error).message}`); }

    evidence.finished_at = new Date().toISOString();
    const ok = evidence.failures.length === 0;
    return json({ ok, evidence }, ok ? 200 : 500);
  } catch (e) {
    evidence.finished_at = new Date().toISOString();
    evidence.failures.push(`runner threw: ${(e as Error).message}`);
    return json({ ok: false, evidence }, 500);
  }
});
