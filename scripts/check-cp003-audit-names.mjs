#!/usr/bin/env node
/**
 * CP-003 audit-name parity guard.
 *
 * Signed canonical CP-003 audit names (from
 * Izenzo_Client_Only_Decision_Form_SIGNED.pdf):
 *   - pending_engagement.identity_incomplete_email_only_detected
 *   - pending_engagement.outreach_blocked_missing_counterparty_name
 *
 * Legacy sibling preserved for backwards compatibility:
 *   - pending_engagement.outreach_blocked_missing_name
 *
 * Invariants enforced:
 *   1. Both signed canonical names are present in poi-engagements/index.ts.
 *   2. Every surface that emits the legacy `outreach_blocked_missing_name`
 *      MUST also emit the signed `outreach_blocked_missing_counterparty_name`
 *      (count parity — at least as many signed emits as legacy emits).
 *   3. seed-cp003-controlled-prod/index.ts emits ALL THREE names.
 *
 * Prebuild fails on drift so dashboards keyed on the signed names cannot
 * silently lose CP-003 coverage.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const SIGNED_DETECT = "pending_engagement.identity_incomplete_email_only_detected";
const SIGNED_BLOCK = "pending_engagement.outreach_blocked_missing_counterparty_name";
const LEGACY_BLOCK = "pending_engagement.outreach_blocked_missing_name";

const EDGE = "supabase/functions/poi-engagements/index.ts";
const SEED = "supabase/functions/seed-cp003-controlled-prod/index.ts";

function read(p) {
  return readFileSync(resolve(ROOT, p), "utf8");
}
function count(hay, needle) {
  return hay.split(needle).length - 1;
}

const errors = [];

const edge = read(EDGE);
if (count(edge, SIGNED_DETECT) < 1) {
  errors.push(`${EDGE} missing signed canonical '${SIGNED_DETECT}'`);
}
const edgeLegacy = count(edge, `"${LEGACY_BLOCK}"`);
const edgeSigned = count(edge, `"${SIGNED_BLOCK}"`);
if (edgeSigned < edgeLegacy) {
  errors.push(
    `${EDGE}: every '${LEGACY_BLOCK}' emit must be paired with '${SIGNED_BLOCK}' ` +
    `(legacy emits=${edgeLegacy}, signed emits=${edgeSigned})`,
  );
}
if (edgeSigned < 3) {
  errors.push(
    `${EDGE}: expected at least 3 emit sites of '${SIGNED_BLOCK}' ` +
    `(preview-outreach, send-outreach, contact-patch); found ${edgeSigned}`,
  );
}

const seed = read(SEED);
for (const name of [SIGNED_DETECT, LEGACY_BLOCK, SIGNED_BLOCK]) {
  if (!seed.includes(`"${name}"`)) {
    errors.push(`${SEED} does not emit '${name}'`);
  }
}

if (errors.length) {
  console.error("✗ CP-003 audit-name parity check failed:");
  for (const e of errors) console.error("  -", e);
  process.exit(1);
}
console.log(
  `✓ CP-003 audit-name parity OK: signed detect=1, signed block=${edgeSigned}, ` +
  `legacy block=${edgeLegacy}, seed emits all three.`,
);
