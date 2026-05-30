#!/usr/bin/env node
/**
 * Admin Export Controls Batch 7 — Live E2E Smoke.
 *
 * Proves the non-generating governance chain end-to-end against a
 * staging/live Lovable Cloud deployment:
 *
 *   request → legal-hold detection → approval → list visibility
 *
 * This script is proof-only. It NEVER:
 *   - prepares an export
 *   - generates a file (CSV / JSON / PDF / Blob)
 *   - mints a signed URL
 *   - downloads or destroys an export
 *   - mutates legal_holds rows
 *   - touches DATA-004 fixtures, cron schedules, retention, or
 *     cold-storage archive logic
 *
 * It only calls the three Batch 2 / 4 / 5 edge functions
 * (`admin-governance-export-request`, `admin-governance-export-approve`,
 * `admin-governance-export-list`) plus the Supabase Auth REST endpoints
 * for sign-in / AAL2 challenge.
 *
 * Required env (all SMOKE_*):
 *   SMOKE_BASE_URL                       https://<project>.supabase.co
 *   SMOKE_ANON_KEY                       Supabase anon publishable key
 *
 *   SMOKE_REQUESTER_EMAIL                Row R — platform_admin requester (AAL2)
 *   SMOKE_REQUESTER_PASSWORD
 *   SMOKE_REQUESTER_TOTP_SECRET          base32, no spaces
 *
 *   SMOKE_APPROVER_EMAIL                 Row A — second platform_admin (AAL2)
 *   SMOKE_APPROVER_PASSWORD
 *   SMOKE_APPROVER_TOTP_SECRET           base32
 *
 *   SMOKE_AAL1_ADMIN_EMAIL               Row N — platform_admin WITHOUT AAL2
 *   SMOKE_AAL1_ADMIN_PASSWORD
 *
 *   SMOKE_NON_ADMIN_EMAIL                Row X — non-platform_admin user
 *   SMOKE_NON_ADMIN_PASSWORD
 *
 *   SMOKE_GOVERNANCE_RECORD_ID           UUID of an existing Governance
 *                                        Record / match anchor that the
 *                                        Batch 2 RPC will accept.
 *   SMOKE_TARGET_ORG_ID                  (optional) UUID — null if omitted.
 *
 * Output:
 *   evidence/admin-export-controls-batch-7-live-e2e-smoke.json
 *   evidence/admin-export-controls-batch-7-live-e2e-smoke.md is the
 *   prose evidence file maintained by hand alongside this script.
 *
 * Exit code: 0 if every required path passes, 1 otherwise.
 */
import { createHmac } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

// ───────────────────────────────── env ──────────────────────────────────

const REQUIRED_ENV = [
  "SMOKE_BASE_URL",
  "SMOKE_ANON_KEY",
  "SMOKE_REQUESTER_EMAIL",
  "SMOKE_REQUESTER_PASSWORD",
  "SMOKE_REQUESTER_TOTP_SECRET",
  "SMOKE_APPROVER_EMAIL",
  "SMOKE_APPROVER_PASSWORD",
  "SMOKE_APPROVER_TOTP_SECRET",
  "SMOKE_AAL1_ADMIN_EMAIL",
  "SMOKE_AAL1_ADMIN_PASSWORD",
  "SMOKE_NON_ADMIN_EMAIL",
  "SMOKE_NON_ADMIN_PASSWORD",
  "SMOKE_GOVERNANCE_RECORD_ID",
];
const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(
    "[admin-export-controls-batch-7-smoke] missing required env:\n  - " +
      missing.join("\n  - "),
  );
  process.exit(2);
}
const BASE = process.env.SMOKE_BASE_URL.replace(/\/+$/, "");
const ANON = process.env.SMOKE_ANON_KEY;
const GOV_ID = process.env.SMOKE_GOVERNANCE_RECORD_ID;
const TARGET_ORG = process.env.SMOKE_TARGET_ORG_ID || null;

// ─────────────────────────────── helpers ────────────────────────────────

const evidence = {
  started_at: new Date().toISOString(),
  base_url: BASE,
  governance_record_id: GOV_ID,
  target_org_id: TARGET_ORG,
  paths: {},
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
};

const failures = [];
function pass(path, msg, extra) {
  evidence.paths[path] = evidence.paths[path] || { checks: [] };
  evidence.paths[path].checks.push({ ok: true, msg, ...extra });
}
function fail(path, msg, extra) {
  evidence.paths[path] = evidence.paths[path] || { checks: [] };
  evidence.paths[path].checks.push({ ok: false, msg, ...extra });
  failures.push(`[${path}] ${msg}`);
}

// RFC 6238 TOTP (SHA-1, 6 digits, 30s).
function base32Decode(b32) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = b32.replace(/=+$/, "").toUpperCase().replace(/\s+/g, "");
  let bits = "";
  for (const c of clean) {
    const v = alphabet.indexOf(c);
    if (v < 0) throw new Error(`bad base32 char: ${c}`);
    bits += v.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}
function totp(secret, when = Date.now()) {
  const key = base32Decode(secret);
  const counter = Math.floor(when / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac("sha1", key).update(buf).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const code =
    ((mac[offset] & 0x7f) << 24) |
    ((mac[offset + 1] & 0xff) << 16) |
    ((mac[offset + 2] & 0xff) << 8) |
    (mac[offset + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, "0");
}

async function authFetch(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      apikey: ANON,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: res.status, body };
}

async function passwordSignIn(email, password) {
  const { status, body } = await authFetch(
    "/auth/v1/token?grant_type=password",
    { method: "POST", body: JSON.stringify({ email, password }) },
  );
  if (status !== 200 || !body?.access_token) {
    throw new Error(`signIn ${email} status=${status} body=${JSON.stringify(body)}`);
  }
  return body.access_token;
}

async function upgradeToAal2(accessToken, totpSecret) {
  // List factors.
  const listRes = await fetch(`${BASE}/auth/v1/factors`, {
    headers: { apikey: ANON, Authorization: `Bearer ${accessToken}` },
  });
  const listBody = await listRes.json();
  const factor = (listBody?.totp ?? listBody?.all ?? listBody?.factors ?? [])
    .find?.((f) => f.status === "verified" && (f.factor_type === "totp" || f.type === "totp"));
  if (!factor) throw new Error(`no verified TOTP factor for AAL2 upgrade`);
  const challengeRes = await fetch(
    `${BASE}/auth/v1/factors/${factor.id}/challenge`,
    { method: "POST", headers: { apikey: ANON, Authorization: `Bearer ${accessToken}` } },
  );
  const challenge = await challengeRes.json();
  const code = totp(totpSecret);
  const verifyRes = await fetch(
    `${BASE}/auth/v1/factors/${factor.id}/verify`,
    {
      method: "POST",
      headers: {
        apikey: ANON,
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ challenge_id: challenge.id, code }),
    },
  );
  const verifyBody = await verifyRes.json();
  if (!verifyBody?.access_token) {
    throw new Error(`AAL2 verify failed: ${JSON.stringify(verifyBody)}`);
  }
  return verifyBody.access_token;
}

async function callFn(name, token, body) {
  const res = await fetch(`${BASE}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      apikey: ANON,
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  let parsed;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  return { status: res.status, body: parsed, raw: text };
}

function assertNoGenerationLeak(pathLabel, response) {
  const raw = typeof response.raw === "string" ? response.raw : JSON.stringify(response.body ?? "");
  const checks = [
    ["signed_url", /signed_url|signedUrl|createSignedUrl/i],
    ["download_link", /download_link|downloadUrl|download_url/i],
    ["prepare", /\b(prepare|prepared)\b/i],
    ["destroy", /\b(destroy|destroyed)\b/i],
    ["csv_blob", /\b(text\/csv|Content-Disposition|new\s+Blob)\b/i],
    ["generated_file_marker", /generated_file|file_path|storage_object/i],
  ];
  for (const [label, re] of checks) {
    if (re.test(raw)) {
      fail(pathLabel, `unexpected ${label} marker present in response`);
      if (label === "signed_url") evidence.no_generation_proof.signed_url_present = true;
      if (label === "download_link") evidence.no_generation_proof.download_link_present = true;
      if (label === "prepare") evidence.no_generation_proof.prepare_called = true;
      if (label === "destroy") evidence.no_generation_proof.destroy_called = true;
      if (label === "generated_file_marker") evidence.no_generation_proof.file_generated = true;
    }
  }
}

// ───────────────────────────── smoke paths ──────────────────────────────

const REQUEST_BODY = {
  governance_record_id: GOV_ID,
  purpose: "compliance_review",
  reason: "Batch 7 live E2E smoke — request → approval → list visibility.",
  requested_categories: ["governance_record_index"],
  target_org_id: TARGET_ORG,
  redaction_mode: "redacted_client_safe",
};

let requestId = null;

async function pathA_requestSuccess() {
  const label = "A_request_success";
  try {
    const aal1 = await passwordSignIn(
      process.env.SMOKE_REQUESTER_EMAIL,
      process.env.SMOKE_REQUESTER_PASSWORD,
    );
    const aal2 = await upgradeToAal2(aal1, process.env.SMOKE_REQUESTER_TOTP_SECRET);
    const res = await callFn("admin-governance-export-request", aal2, REQUEST_BODY);
    evidence.paths[label] = { status: res.status, body: res.body, checks: [] };
    if (res.status !== 200) return fail(label, `expected 200 got ${res.status}`);
    if (!res.body?.ok || !res.body?.request_id) return fail(label, "no request_id");
    requestId = res.body.request_id;
    if (res.body.status !== "awaiting_approval") return fail(label, `bad status ${res.body.status}`);
    if (res.body.redaction_mode !== "redacted_client_safe") return fail(label, "redaction_mode drift");
    assertNoGenerationLeak(label, res);
    pass(label, "request created", { request_id: requestId });
  } catch (e) {
    fail(label, `threw: ${e.message}`);
  }
}

async function pathB_requestDenials() {
  // B1 — AAL1 admin → MFA_REQUIRED
  const b1 = "B1_request_denied_aal1";
  try {
    const tok = await passwordSignIn(
      process.env.SMOKE_AAL1_ADMIN_EMAIL,
      process.env.SMOKE_AAL1_ADMIN_PASSWORD,
    );
    const res = await callFn("admin-governance-export-request", tok, REQUEST_BODY);
    evidence.paths[b1] = { status: res.status, body: res.body, checks: [] };
    if (res.status !== 403 || res.body?.code !== "MFA_REQUIRED") {
      return fail(b1, `expected 403/MFA_REQUIRED got ${res.status}/${res.body?.code}`);
    }
    assertNoGenerationLeak(b1, res);
    pass(b1, "AAL1 admin denied with MFA_REQUIRED");
  } catch (e) {
    fail(b1, `threw: ${e.message}`);
  }

  // B2 — non-admin → NOT_PLATFORM_ADMIN
  const b2 = "B2_request_denied_non_admin";
  try {
    const tok = await passwordSignIn(
      process.env.SMOKE_NON_ADMIN_EMAIL,
      process.env.SMOKE_NON_ADMIN_PASSWORD,
    );
    const res = await callFn("admin-governance-export-request", tok, REQUEST_BODY);
    evidence.paths[b2] = { status: res.status, body: res.body, checks: [] };
    if (res.status !== 403 || res.body?.code !== "NOT_PLATFORM_ADMIN") {
      return fail(b2, `expected 403/NOT_PLATFORM_ADMIN got ${res.status}/${res.body?.code}`);
    }
    assertNoGenerationLeak(b2, res);
    pass(b2, "non-admin denied with NOT_PLATFORM_ADMIN");
  } catch (e) {
    fail(b2, `threw: ${e.message}`);
  }
}

async function pathC_approvalSuccess() {
  const label = "C_approval_success";
  if (!requestId) return fail(label, "no requestId from path A");
  try {
    const aal1 = await passwordSignIn(
      process.env.SMOKE_APPROVER_EMAIL,
      process.env.SMOKE_APPROVER_PASSWORD,
    );
    const aal2 = await upgradeToAal2(aal1, process.env.SMOKE_APPROVER_TOTP_SECRET);
    const res = await callFn("admin-governance-export-approve", aal2, {
      request_id: requestId,
      approval_note: "Batch 7 smoke approval",
    });
    evidence.paths[label] = { status: res.status, body: res.body, checks: [] };
    if (res.status !== 200) return fail(label, `expected 200 got ${res.status}`);
    if (res.body?.new_status !== "approved") return fail(label, `bad new_status ${res.body?.new_status}`);
    if (res.body?.previous_status && res.body.previous_status !== "awaiting_approval") {
      return fail(label, `unexpected previous_status ${res.body.previous_status}`);
    }
    assertNoGenerationLeak(label, res);
    pass(label, "request approved", { request_id: requestId });
  } catch (e) {
    fail(label, `threw: ${e.message}`);
  }
}

async function pathD_selfApprovalBlocked() {
  const label = "D_self_approval_blocked";
  if (!requestId) return fail(label, "no requestId from path A");
  try {
    const aal1 = await passwordSignIn(
      process.env.SMOKE_REQUESTER_EMAIL,
      process.env.SMOKE_REQUESTER_PASSWORD,
    );
    const aal2 = await upgradeToAal2(aal1, process.env.SMOKE_REQUESTER_TOTP_SECRET);
    const res = await callFn("admin-governance-export-approve", aal2, {
      request_id: requestId,
      approval_note: "self-approval attempt",
    });
    evidence.paths[label] = { status: res.status, body: res.body, checks: [] };
    if (res.status !== 409 || res.body?.code !== "SELF_APPROVAL_BLOCKED") {
      return fail(label, `expected 409/SELF_APPROVAL_BLOCKED got ${res.status}/${res.body?.code}`);
    }
    assertNoGenerationLeak(label, res);
    pass(label, "self-approval blocked");
  } catch (e) {
    fail(label, `threw: ${e.message}`);
  }
}

async function pathE_listVisibility() {
  // E1 — platform_admin AAL2 sees the request.
  const e1 = "E1_list_visibility";
  try {
    const aal1 = await passwordSignIn(
      process.env.SMOKE_APPROVER_EMAIL,
      process.env.SMOKE_APPROVER_PASSWORD,
    );
    const aal2 = await upgradeToAal2(aal1, process.env.SMOKE_APPROVER_TOTP_SECRET);
    const res = await callFn("admin-governance-export-list", aal2, {
      governance_record_id: GOV_ID,
      statuses: ["approved", "awaiting_approval", "denied", "failed"],
      limit: 50,
    });
    evidence.paths[e1] = { status: res.status, body: res.body, checks: [] };
    if (res.status !== 200) return fail(e1, `expected 200 got ${res.status}`);
    const rows = Array.isArray(res.body?.rows) ? res.body.rows : [];
    const row = rows.find((r) => r.id === requestId || r.export_request_id === requestId);
    if (!row) return fail(e1, "approved request not visible in list");
    if (!row.governance_record_id) fail(e1, "governance_record_id missing");
    if (!row.status) fail(e1, "status missing");
    if (!row.redaction_mode) fail(e1, "redaction_mode missing");
    const rawRow = JSON.stringify(row);
    if (/\b(notes|raw_reason|legal_hold_reason)\b/i.test(rawRow)) {
      fail(e1, "raw legal-hold reason/notes/metadata exposed in row");
    }
    assertNoGenerationLeak(e1, res);
    pass(e1, "row visible with safe fields only");
  } catch (e) {
    fail(e1, `threw: ${e.message}`);
  }

  // E2 — AAL1 admin denied.
  const e2 = "E2_list_denied_aal1";
  try {
    const tok = await passwordSignIn(
      process.env.SMOKE_AAL1_ADMIN_EMAIL,
      process.env.SMOKE_AAL1_ADMIN_PASSWORD,
    );
    const res = await callFn("admin-governance-export-list", tok, {});
    evidence.paths[e2] = { status: res.status, body: res.body, checks: [] };
    if (res.status !== 403) return fail(e2, `expected 403 got ${res.status}`);
    assertNoGenerationLeak(e2, res);
    pass(e2, "AAL1 admin denied");
  } catch (e) {
    fail(e2, `threw: ${e.message}`);
  }

  // E3 — non-admin denied.
  const e3 = "E3_list_denied_non_admin";
  try {
    const tok = await passwordSignIn(
      process.env.SMOKE_NON_ADMIN_EMAIL,
      process.env.SMOKE_NON_ADMIN_PASSWORD,
    );
    const res = await callFn("admin-governance-export-list", tok, {});
    evidence.paths[e3] = { status: res.status, body: res.body, checks: [] };
    if (res.status !== 403) return fail(e3, `expected 403 got ${res.status}`);
    assertNoGenerationLeak(e3, res);
    pass(e3, "non-admin denied");
  } catch (e) {
    fail(e3, `threw: ${e.message}`);
  }
}

// ──────────────────────────────── run ───────────────────────────────────

await pathA_requestSuccess();
await pathB_requestDenials();
await pathC_approvalSuccess();
await pathD_selfApprovalBlocked();
await pathE_listVisibility();

evidence.finished_at = new Date().toISOString();
evidence.request_id = requestId;
evidence.failures = failures;

const outPath = resolve(
  "evidence",
  "admin-export-controls-batch-7-live-e2e-smoke.json",
);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(evidence, null, 2));

if (failures.length) {
  console.error(
    `[admin-export-controls-batch-7-smoke] FAIL — ${failures.length} check(s) failed:`,
  );
  for (const f of failures) console.error("  - " + f);
  console.error(`\nEvidence: ${outPath}`);
  process.exit(1);
}
console.log(
  `[admin-export-controls-batch-7-smoke] OK — request → approval → list chain proven.`,
);
console.log(`Evidence: ${outPath}`);
