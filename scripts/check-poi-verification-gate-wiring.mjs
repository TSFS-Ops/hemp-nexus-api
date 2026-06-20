#!/usr/bin/env node
/**
 * POI Verification Guardrails / Draft-Only Mode — wiring guard.
 *
 * Asserts every formal POI / counterparty-facing entrypoint imports both:
 *   - checkOrgLegitimacy   (org gate from _shared/legitimacy.ts)
 *   - checkUserPoiAuthority (user gate from _shared/poi-authority.ts)
 *
 * Also asserts the canonical reason code POI_ORG_VERIFICATION_REQUIRED is
 * exported by `_shared/legitimacy.ts` and referenced by every gated function.
 *
 * Exceptions:
 *   - facilitation-poi-conversion + export-prepare + export-download are
 *     service-role / admin paths. They run the *org* legitimacy gate against
 *     the requester org but do not run the user-authority gate (the calling
 *     user is the admin / cron worker, not the requester user). The guard
 *     therefore requires only `checkOrgLegitimacy` + the canonical code on
 *     those three files.
 */

import { readFileSync } from "node:fs";

const REQUIRED_CODE = "POI_ORG_VERIFICATION_REQUIRED";
const LEGIT_FILE = "supabase/functions/_shared/legitimacy.ts";

const FULL_GATE = [
  "supabase/functions/pois/index.ts",
  "supabase/functions/poi-transition/index.ts",
  "supabase/functions/poi-engagements/index.ts",
  "supabase/functions/match/index.ts",
  "supabase/functions/wad/index.ts",
  "supabase/functions/p3-wad/index.ts",
];

const ORG_GATE_ONLY = [
  "supabase/functions/facilitation-poi-conversion/index.ts",
  "supabase/functions/export-prepare/index.ts",
  "supabase/functions/export-download/index.ts",
];

const errors = [];

const legitimacySrc = readFileSync(LEGIT_FILE, "utf8");
if (!legitimacySrc.includes(`POI_ORG_VERIFICATION_REQUIRED_CODE = "${REQUIRED_CODE}"`)) {
  errors.push(`${LEGIT_FILE}: missing canonical export POI_ORG_VERIFICATION_REQUIRED_CODE = "${REQUIRED_CODE}"`);
}
if (!legitimacySrc.includes("poiGateBlockedAuditMetadata")) {
  errors.push(`${LEGIT_FILE}: missing poiGateBlockedAuditMetadata helper`);
}

function assertContains(path, needles) {
  let src;
  try { src = readFileSync(path, "utf8"); }
  catch { errors.push(`${path}: file missing`); return; }
  for (const n of needles) {
    if (!src.includes(n)) errors.push(`${path}: missing required token \`${n}\``);
  }
}

for (const f of FULL_GATE) {
  assertContains(f, ["checkOrgLegitimacy", "checkUserPoiAuthority", REQUIRED_CODE]);
}
for (const f of ORG_GATE_ONLY) {
  assertContains(f, ["checkOrgLegitimacy", REQUIRED_CODE]);
}

if (errors.length > 0) {
  console.error("❌ POI verification gate wiring check FAILED:\n");
  for (const e of errors) console.error("  - " + e);
  console.error("\nEvery gated entrypoint must import the legitimacy + authority helpers");
  console.error("and emit POI_ORG_VERIFICATION_REQUIRED. See evidence/poi-verification-gate-guardrails/README.md.");
  process.exit(1);
}

console.log("✅ POI verification gate wiring intact (" + (FULL_GATE.length + ORG_GATE_ONLY.length) + " entrypoints).");
