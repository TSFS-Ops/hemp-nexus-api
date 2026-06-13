#!/usr/bin/env node
/**
 * Final live smoke test — AI Counterparty Intelligence & Match Review (Batches 1–5).
 *
 * Drives the 12-point evidence pack against real platform_admin and non-admin
 * tokens. Writes structured evidence (per-step request/response traces, audit
 * row counts, side-effect counts) into evidence/ai-counterparty-review-final-smoke/.
 *
 * Required env (typically sourced from .env.smoke-ai-review + project URL):
 *   SUPABASE_URL                supabase.co project URL
 *   SUPABASE_ANON_KEY           project anon key (for password sign-in)
 *   SUPABASE_SERVICE_ROLE_KEY   service-role key (for audit row queries only)
 *   SMOKE_ADMIN_EMAIL / _PASSWORD
 *   SMOKE_NONADMIN_EMAIL / _PASSWORD
 *   SMOKE_TRADE_REQUEST_ID
 *   SMOKE_PROPOSED_MATCH_ID
 *
 * NOTE: This runner only reads — it never mutates POIs/WaDs/matches.
 * The mutations it makes are confined to the AI Counterparty Review surface
 * which by contract introduces no POI/WaD/verification/formal-match writes.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";

const SUPABASE_URL = req("SUPABASE_URL");
const ANON = req("SUPABASE_ANON_KEY");
const SERVICE = req("SUPABASE_SERVICE_ROLE_KEY");
const ADMIN_EMAIL = req("SMOKE_ADMIN_EMAIL");
const ADMIN_PW = req("SMOKE_ADMIN_PASSWORD");
const NA_EMAIL = req("SMOKE_NONADMIN_EMAIL");
const NA_PW = req("SMOKE_NONADMIN_PASSWORD");
const TR_ID = req("SMOKE_TRADE_REQUEST_ID");
const PM_ID = req("SMOKE_PROPOSED_MATCH_ID");

const EVIDENCE_DIR = resolve(process.cwd(), "evidence/ai-counterparty-review-final-smoke");
mkdirSync(EVIDENCE_DIR, { recursive: true });

const FUNCTIONS = [
  "ai-interpret-trade-request",
  "ai-source-counterparties",
  "ai-proposed-match-decision",
  "ai-do-not-contact-rules",
  "ai-outreach-draft-v2",
  "ai-outreach-draft-v2-decision",
  "ai-poi-intelligence-note",
];

const steps = [];

function req(name) {
  const v = process.env[name];
  if (!v) { console.error(`Missing env: ${name}`); process.exit(2); }
  return v;
}

async function signIn(email, password) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: ANON },
    body: JSON.stringify({ email, password }),
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) throw new Error(`signIn ${email}: ${JSON.stringify(j)}`);
  return j.access_token;
}

async function callFn(name, token, body, expectStatus) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      apikey: ANON,
    },
    body: JSON.stringify(body ?? {}),
  });
  const reqId = r.headers.get("x-request-id") ?? r.headers.get("sb-request-id") ?? null;
  let payload;
  try { payload = await r.json(); } catch { payload = { _raw: await r.text() }; }
  const ok = expectStatus == null ? r.ok : r.status === expectStatus;
  return { fn: name, status: r.status, ok, x_request_id: reqId, response: payload };
}

async function sb(query) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/__noop`, { method: "POST" }).catch(() => null);
  // Direct PostgREST count via service key:
  const url = new URL(`${SUPABASE_URL}/rest/v1/${query}`);
  const res = await fetch(url, {
    headers: {
      apikey: SERVICE, Authorization: `Bearer ${SERVICE}`,
      Prefer: "count=exact", "Range-Unit": "items", Range: "0-0",
    },
  });
  const total = parseInt((res.headers.get("content-range") ?? "0-0/0").split("/")[1] || "0", 10);
  return total;
}

function record(name, detail) {
  steps.push({ step: name, at: new Date().toISOString(), ...detail });
  const status = detail.ok ? "✅" : "❌";
  console.log(`${status} ${name}${detail.note ? " — " + detail.note : ""}`);
}

async function main() {
  console.log("→ Signing in as platform_admin and non-admin…");
  const adminTok = await signIn(ADMIN_EMAIL, ADMIN_PW);
  const naTok = await signIn(NA_EMAIL, NA_PW);

  // Snapshot side-effect counters BEFORE the run.
  const before = {
    pois: await sb("pois?select=id"),
    wads: await sb("wads?select=id"),
    notifications: await sb("notification_dispatches?select=id"),
    emails: await sb("email_send_log?select=id"),
    webhook_deliveries: await sb("webhook_deliveries?select=id"),
  };

  // === Step 1+2: non-admin 403 on all 7 edge functions ===
  for (const fn of FUNCTIONS) {
    const r = await callFn(fn, naTok, { op: "list", trade_request_id: TR_ID, proposed_match_id: PM_ID }, 403);
    record(`403_${fn}`, { ok: r.status === 403, status: r.status, x_request_id: r.x_request_id, response: r.response });
  }

  // === Step 3: platform_admin proposed-match lifecycle (review/approve via decision fn) ===
  const reviewR = await callFn("ai-proposed-match-decision", adminTok,
    { op: "review", proposed_match_id: PM_ID, reviewer_note: "smoke: reviewed" }, 200);
  record("admin_review", reviewR);

  const approveR = await callFn("ai-proposed-match-decision", adminTok,
    { op: "approve", proposed_match_id: PM_ID }, 200);
  record("admin_approve", approveR);

  // === Step 4: DNC rule blocks draft creation ===
  const dncCreate = await callFn("ai-do-not-contact-rules", adminTok, {
    op: "create",
    rule_type: "specific_counterparty",
    rule_value: "Fixture Counterparty Ltd (FIXTURE)",
    reason: "smoke: block this counterparty",
  }, 200);
  record("dnc_create", dncCreate);

  const blockedDraft = await callFn("ai-outreach-draft-v2", adminTok,
    { op: "create", proposed_match_id: PM_ID }, undefined);
  // Expectation: refusal — function should NOT return 200 with a new draft id when DNC matches.
  record("draft_blocked_by_dnc", {
    ok: blockedDraft.status !== 200 || !!blockedDraft.response?.blocked || blockedDraft.response?.error,
    status: blockedDraft.status, x_request_id: blockedDraft.x_request_id, response: blockedDraft.response,
    note: "must NOT create a draft while DNC rule active",
  });

  // Deactivate DNC for downstream tests.
  if (dncCreate.response?.rule?.id) {
    const dncDeact = await callFn("ai-do-not-contact-rules", adminTok,
      { op: "deactivate", rule_id: dncCreate.response.rule.id }, 200);
    record("dnc_deactivate", dncDeact);
  }

  // === Step 5: approved match generates a draft (now DNC inactive) ===
  const draftCreate = await callFn("ai-outreach-draft-v2", adminTok,
    { op: "create", proposed_match_id: PM_ID }, undefined);
  record("draft_create", { ...draftCreate, ok: draftCreate.status === 200 });
  const draftId = draftCreate.response?.draft?.id ?? draftCreate.response?.id ?? null;

  // === Step 6: mark_sent_by_human is metadata-only ===
  if (draftId) {
    const sentR = await callFn("ai-outreach-draft-v2-decision", adminTok,
      { op: "mark_sent_by_human", draft_id: draftId }, undefined);
    record("mark_sent_by_human", { ...sentR, ok: sentR.status === 200 });
  } else {
    record("mark_sent_by_human", { ok: false, note: "no draft id from create step" });
  }

  // === Step 7: POI intelligence note can be generated ===
  const intelR = await callFn("ai-poi-intelligence-note", adminTok,
    { op: "generate", proposed_match_id: PM_ID }, undefined);
  record("poi_intelligence_generate", { ...intelR, ok: intelR.status === 200 });
  const noteId = intelR.response?.note?.id ?? null;

  // === Step 8: escalation creates review state only ===
  if (noteId) {
    const escR = await callFn("ai-poi-intelligence-note", adminTok,
      { op: "escalate", note_id: noteId, reason: "smoke: escalate" }, undefined);
    record("poi_intel_escalate", { ...escR, ok: escR.status === 200 });
  } else {
    // Fallback: escalate the proposed match itself
    const escR = await callFn("ai-proposed-match-decision", adminTok,
      { op: "escalate", proposed_match_id: PM_ID, reason: "smoke: escalate" }, undefined);
    record("match_escalate", { ...escR, ok: escR.status === 200 });
  }

  // === Step 9: archive ===
  const archiveR = await callFn("ai-proposed-match-decision", adminTok,
    { op: "archive", proposed_match_id: PM_ID }, undefined);
  record("admin_archive", { ...archiveR, ok: archiveR.status === 200 });

  // === Step 10: audit rows under ai_review.* ===
  const auditCount = await sb(
    "admin_audit_logs?select=id&action=like.ai_review.%25&created_at=gte." +
    encodeURIComponent(new Date(Date.now() - 10 * 60_000).toISOString()),
  );
  record("audit_rows_ai_review_recent", { ok: auditCount > 0, count: auditCount });

  // === Step 11+12: no side-effects to POI/WaD/match/email/webhook ===
  const after = {
    pois: await sb("pois?select=id"),
    wads: await sb("wads?select=id"),
    notifications: await sb("notification_dispatches?select=id"),
    emails: await sb("email_send_log?select=id"),
    webhook_deliveries: await sb("webhook_deliveries?select=id"),
  };
  const delta = Object.fromEntries(Object.keys(before).map((k) => [k, after[k] - before[k]]));
  record("no_side_effects", {
    ok: Object.values(delta).every((d) => d === 0),
    before, after, delta,
    note: "POI/WaD/notification/email/webhook row counts must be unchanged",
  });

  const passed = steps.filter((s) => s.ok).length;
  const failed = steps.length - passed;
  const summary = {
    feature: "AI Counterparty Intelligence & Match Review (Batches 1–5)",
    completed_at: new Date().toISOString(),
    base_url: SUPABASE_URL,
    proposed_match_id: PM_ID,
    trade_request_id: TR_ID,
    totals: { steps: steps.length, passed, failed },
    status: failed === 0 ? "GREEN" : "RED",
    steps,
  };

  writeFileSync(join(EVIDENCE_DIR, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(`\nEvidence: ${join(EVIDENCE_DIR, "summary.json")}`);
  console.log(`Result: ${summary.status}  (${passed}/${steps.length} passed)`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
