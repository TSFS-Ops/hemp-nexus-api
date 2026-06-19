#!/usr/bin/env node
/**
 * Facilitation Batch 12 — Admin Notification Template Editor contract guard.
 *
 * Fails if:
 *   1. The editor edge function file is missing.
 *   2. The action allow-list expands beyond create_draft / update_draft /
 *      submit_for_approval.
 *   3. The editor contains any send / dispatch / email / Slack / SMS /
 *      WhatsApp / webhook / notification-dispatch reference.
 *   4. The editor function can approve templates (mutates status to
 *      'approved', or sets approved_by/approved_at, or invokes the
 *      template-status function).
 *   5. The editor function permits direct edits to approved or archived
 *      templates (must filter status='draft' when updating).
 *   6. The drafter-cannot-approve-self protection is missing from
 *      facilitation-outreach-template-status (existing approval path).
 *   7. The two Batch-12 audit names are not pinned in both SSOTs
 *      (server + browser).
 *   8. The editor imports or references the requester-safe notification
 *      trigger catalogue (REQUESTER_SAFE_NOTIFICATION_TRIGGERS).
 *   9. The shared SSOT pair has drifted (constants out of sync).
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const errors = [];

const FN = "supabase/functions/facilitation-template-editor/index.ts";
const APPROVAL_FN = "supabase/functions/facilitation-outreach-template-status/index.ts";
const SHARED_SERVER = "supabase/functions/_shared/facilitation-template-editor.ts";
const SHARED_BROWSER = "src/lib/facilitation-template-editor.ts";

const REQUIRED_ACTIONS = ["create_draft", "update_draft", "submit_for_approval"];
const REQUIRED_AUDITS = [
  "facilitation_template.draft_created",
  "facilitation_template.draft_updated",
];

// ── 1. files exist ─────────────────────────────────────────────────────────
for (const f of [FN, APPROVAL_FN, SHARED_SERVER, SHARED_BROWSER]) {
  if (!existsSync(resolve(ROOT, f))) errors.push(`Missing required file: ${f}`);
}
const fnSrc = existsSync(resolve(ROOT, FN)) ? readFileSync(resolve(ROOT, FN), "utf8") : "";
const apprSrc = existsSync(resolve(ROOT, APPROVAL_FN)) ? readFileSync(resolve(ROOT, APPROVAL_FN), "utf8") : "";
const serverSrc = existsSync(resolve(ROOT, SHARED_SERVER)) ? readFileSync(resolve(ROOT, SHARED_SERVER), "utf8") : "";
const browserSrc = existsSync(resolve(ROOT, SHARED_BROWSER)) ? readFileSync(resolve(ROOT, SHARED_BROWSER), "utf8") : "";

// Strip comments before scanning fn body for forbidden tokens.
const stripped = fnSrc
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/.*$/gm, "$1");

// ── 2. action allow-list ───────────────────────────────────────────────────
for (const a of REQUIRED_ACTIONS) {
  if (!fnSrc.includes(`"${a}"`)) errors.push(`${FN}: missing action literal "${a}".`);
}
const allActionLiterals = [...fnSrc.matchAll(/z\.literal\(\s*"([a-z_]+)"\s*\)/g)].map((m) => m[1]);
for (const lit of allActionLiterals) {
  if (!REQUIRED_ACTIONS.includes(lit)) {
    errors.push(`${FN}: action allow-list widened — unexpected action "${lit}".`);
  }
}

// ── 3. forbidden send / dispatch paths ─────────────────────────────────────
const FORBIDDEN = [
  /send-transactional-email/i,
  /notification-dispatch/i,
  /resend\.emails\.send/i,
  /api\.resend\.com/i,
  /smtp\.|sendgrid|twilio/i,
  /slack\.com\/api/i,
  /whatsapp/i,
  /\bsms\b/i,
  /webhook[-_ ]?dispatch/i,
  /facilitation-outreach-send/i,
  /atomic_generate_poi/i,
  /atomic_token_burn/i,
  /atomic_token_credit/i,
  /atomic_accept_bind/i,
  /atomic_engagement_transition/i,
  /\bwads\b[\s\S]{0,40}\.insert\(/i,
  /\bmatches\b[\s\S]{0,40}\.insert\(/i,
  /\bpois\b[\s\S]{0,40}\.insert\(/i,
  /\btoken_ledger\b[\s\S]{0,40}\.insert\(/i,
  /\btoken_purchases\b[\s\S]{0,40}\.insert\(/i,
  /\bpayments?\b[\s\S]{0,40}\.insert\(/i,
  /\brefunds?\b[\s\S]{0,40}\.insert\(/i,
];
for (const re of FORBIDDEN) {
  if (re.test(stripped)) errors.push(`${FN}: forbidden side-effect pattern ${re}.`);
}

// ── 4. editor cannot approve ───────────────────────────────────────────────
if (/status\s*:\s*['"]approved['"]/.test(stripped)) {
  errors.push(`${FN}: editor must not set status='approved'.`);
}
if (/approved_by\s*[:=]/.test(stripped) || /approved_at\s*[:=]/.test(stripped)) {
  errors.push(`${FN}: editor must not set approved_by / approved_at.`);
}
if (/facilitation-outreach-template-status/.test(stripped)) {
  errors.push(`${FN}: editor must not invoke the approval function.`);
}

// ── 5. approved/archived templates cannot be edited directly ───────────────
//      update_draft path must filter on .eq("status", "draft").
const hasDraftFilter =
  /\.update\(\s*patch\s*\)[\s\S]{0,400}\.eq\(\s*['"]status['"]\s*,\s*['"]draft['"]\s*\)/.test(stripped) ||
  /\.eq\(\s*['"]status['"]\s*,\s*['"]draft['"]\s*\)[\s\S]{0,400}\.update\(/.test(stripped);
if (!hasDraftFilter) {
  errors.push(`${FN}: update path must include .eq("status", "draft") race-guard.`);
}
if (!/isEditableStatus\(/.test(stripped)) {
  errors.push(`${FN}: must call isEditableStatus() to reject approved/archived edits.`);
}

// ── 6. drafter-cannot-approve-self in the approval function ────────────────
if (!/DRAFTER_CANNOT_APPROVE_SELF/.test(apprSrc)) {
  errors.push(`${APPROVAL_FN}: missing DRAFTER_CANNOT_APPROVE_SELF protection.`);
}
if (!/tpl\.created_by\s*===\s*userId|created_by\s*===\s*userId/.test(apprSrc)) {
  errors.push(`${APPROVAL_FN}: missing tpl.created_by === userId equality check.`);
}

// ── 7. audit names pinned in both SSOTs ────────────────────────────────────
for (const a of REQUIRED_AUDITS) {
  if (!serverSrc.includes(`"${a}"`)) errors.push(`${SHARED_SERVER}: missing audit name "${a}".`);
  if (!browserSrc.includes(`"${a}"`)) errors.push(`${SHARED_BROWSER}: missing audit name "${a}".`);
  if (!fnSrc.includes(`"${a}"`)) errors.push(`${FN}: editor must reference audit name "${a}".`);
}
// And the editor must NOT introduce any other facilitation_template.* literals.
const tplAuditLiterals = new Set(
  [...fnSrc.matchAll(/"facilitation_template\.[a-z_]+"/g)].map((m) => m[0]),
);
for (const lit of tplAuditLiterals) {
  const bare = lit.slice(1, -1);
  if (!REQUIRED_AUDITS.includes(bare)) {
    errors.push(`${FN}: unexpected facilitation_template.* audit literal ${lit}.`);
  }
}

// ── 8. editor must not import requester-safe notification triggers ─────────
if (/REQUESTER_SAFE_NOTIFICATION_TRIGGERS/.test(fnSrc)) {
  errors.push(`${FN}: must not reference REQUESTER_SAFE_NOTIFICATION_TRIGGERS — triggers stay code-controlled.`);
}
if (/facilitation-case-state/.test(fnSrc)) {
  errors.push(`${FN}: must not import facilitation-case-state (requester-safe triggers live there).`);
}

// ── 9. shared SSOT drift ───────────────────────────────────────────────────
for (const k of ["FACILITATION_TEMPLATE_EDITOR_ACTIONS", "FACILITATION_TEMPLATE_AUDIT_NAMES", "renderPreview", "findForbiddenBodyMatches", "isEditableStatus"]) {
  if (!serverSrc.includes(k)) errors.push(`${SHARED_SERVER}: missing export ${k}.`);
  if (!browserSrc.includes(k)) errors.push(`${SHARED_BROWSER}: missing export ${k}.`);
}

if (errors.length) {
  console.error("[check-facilitation-template-editor-contract] FAILED:");
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}
console.log("[check-facilitation-template-editor-contract] OK");
