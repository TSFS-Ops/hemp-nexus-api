#!/usr/bin/env node
/**
 * Facilitation Batch 11 — Invite Unopened Auto-Detector contract guard.
 *
 * Fails if:
 *   1. The detector edge function file is missing.
 *   2. INTERNAL_CRON_KEY gate is missing in the function.
 *   3. Dry-run default (`const live = body.live === true`) is missing.
 *   4. The `invite_unopened_3bd` kind constant is missing from the shared
 *      module, the function, or either SSOT.
 *   5. The canonical audit name `facilitation_case.invite_unopened_flagged`
 *      is not pinned in both facilitation SSOTs.
 *   6. The detector imports / references any forbidden side-effect path
 *      (email, Slack, SMS, WhatsApp, webhook, notification-dispatch,
 *      atomic_generate_poi / atomic_token_* / matches.insert / wads.insert
 *      / pois.insert / token_ledger.insert / token_purchases.insert /
 *      payment / refund mutations).
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const errors = [];

const FN = "supabase/functions/facilitation-invite-unopened-detector/index.ts";
const SHARED = "supabase/functions/_shared/facilitation-invite-unopened.ts";
const SSOTS = [
  "supabase/functions/_shared/facilitation-case-state.ts",
  "src/lib/facilitation-case-state.ts",
];

// ── 1. detector + shared module exist ──────────────────────────────────────
const fnPath = resolve(ROOT, FN);
const sharedPath = resolve(ROOT, SHARED);
if (!existsSync(fnPath)) errors.push(`Missing detector edge function: ${FN}`);
if (!existsSync(sharedPath)) errors.push(`Missing shared helper: ${SHARED}`);

let fnSrc = "";
let sharedSrc = "";
if (existsSync(fnPath)) fnSrc = readFileSync(fnPath, "utf8");
if (existsSync(sharedPath)) sharedSrc = readFileSync(sharedPath, "utf8");

// ── 2. INTERNAL_CRON_KEY gate ──────────────────────────────────────────────
if (fnSrc && !/INTERNAL_CRON_KEY/.test(fnSrc)) {
  errors.push(`${FN}: missing INTERNAL_CRON_KEY gate.`);
}
if (fnSrc && !/gateInternalCronKey\(/.test(fnSrc)) {
  errors.push(`${FN}: missing gateInternalCronKey() call.`);
}

// ── 3. dry-run default ─────────────────────────────────────────────────────
if (fnSrc && !/const\s+live\s*=\s*body\.live\s*===\s*true/.test(fnSrc)) {
  errors.push(`${FN}: dry-run default missing — must read \`const live = body.live === true\`.`);
}

// ── 4. invite_unopened_3bd kind constant pinned ────────────────────────────
if (sharedSrc && !sharedSrc.includes('"invite_unopened_3bd"')) {
  errors.push(`${SHARED}: missing kind literal "invite_unopened_3bd".`);
}
if (fnSrc && !fnSrc.includes("INVITE_UNOPENED_NEXT_STEP_KIND")) {
  errors.push(`${FN}: missing import/use of INVITE_UNOPENED_NEXT_STEP_KIND.`);
}
for (const f of SSOTS) {
  const p = resolve(ROOT, f);
  if (!existsSync(p)) { errors.push(`Missing SSOT file: ${f}`); continue; }
  const src = readFileSync(p, "utf8");
  if (!src.includes('"invite_unopened_3bd"')) {
    errors.push(`${f}: missing pinned next-step kind "invite_unopened_3bd".`);
  }
  if (!src.includes('"facilitation_case.invite_unopened_flagged"')) {
    errors.push(`${f}: missing canonical audit name "facilitation_case.invite_unopened_flagged".`);
  }
}

// ── 5. audit emission gated to live path ───────────────────────────────────
if (fnSrc && !fnSrc.includes("INVITE_UNOPENED_AUDIT_NAME")) {
  errors.push(`${FN}: must reference INVITE_UNOPENED_AUDIT_NAME for audit emission.`);
}

// ── 6. forbidden side-effect paths ─────────────────────────────────────────
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
if (fnSrc) {
  const stripped = fnSrc
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
  for (const re of FORBIDDEN) {
    if (re.test(stripped)) errors.push(`${FN}: forbidden side-effect pattern ${re}`);
  }
  // Detector must NOT mutate facilitation_cases status.
  if (/from\(["']facilitation_cases["']\)[\s\S]{0,200}\.update\(/.test(stripped)) {
    errors.push(`${FN}: forbidden update of facilitation_cases (status mutation prohibited).`);
  }
}

if (errors.length) {
  console.error("[check-invite-unopened-detector-contract] FAILED:");
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}
console.log("[check-invite-unopened-detector-contract] OK");
