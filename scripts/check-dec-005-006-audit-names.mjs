#!/usr/bin/env node
/**
 * DEC-005 / DEC-006 Phase 1 — Canonical audit-name SSOT guard.
 *
 * Asserts that the six signed canonical audit action names are declared
 * verbatim in `src/lib/legal/dec-005-006-audit.ts` and that the signed
 * wording SSOTs continue to expose the verbatim approved copy.
 *
 * Phase 1 does NOT require runtime emission of these names because the
 * underlying wording helpers are static / side-effect free and have no
 * runtime callers. The guard intentionally does not search for emission
 * sites; it pins the constants so a Phase 2 dual-write can be added
 * without drift.
 */
import { readFileSync, existsSync } from "node:fs";

const failures = [];

const SSOT_PATH = "src/lib/legal/dec-005-006-audit.ts";
if (!existsSync(SSOT_PATH)) {
  console.error(`❌ DEC-005/006 SSOT missing: ${SSOT_PATH}`);
  process.exit(1);
}
const ssot = readFileSync(SSOT_PATH, "utf8");

const CANONICAL = [
  "legal.pre_acceptance_wording_applied",
  "legal.unsafe_pre_acceptance_wording_blocked",
  "counterparty.acceptance_recorded_wording_state_updated",
  "legal.poi_binding_wording_applied",
  "legal.unsafe_poi_binding_claim_blocked",
  "legal.poi_wording_updated_after_counterparty_acceptance",
];
for (const name of CANONICAL) {
  if (!ssot.includes(`"${name}"`)) {
    failures.push(`Canonical audit name missing from SSOT: ${name}`);
  }
}

// Pin signed wording remains verbatim in the existing wording SSOTs.
const PRE_ACCEPT = readFileSync("src/lib/legal/pre-acceptance-wording.ts", "utf8");
const POI = readFileSync("src/lib/legal/poi-wording.ts", "utf8");

const SIGNED = [
  ["pre-acceptance-wording.ts", PRE_ACCEPT, "Pending Engagement — counterparty invited, awaiting confirmation."],
  ["pre-acceptance-wording.ts", PRE_ACCEPT, "Counterparty invitation sent. This trade remains pending until the counterparty confirms participation."],
  ["pre-acceptance-wording.ts", PRE_ACCEPT, "You have been invited to review a proposed trade on Izenzo."],
  ["pre-acceptance-wording.ts", PRE_ACCEPT, "This invitation does not confirm your acceptance."],
  ["poi-wording.ts", POI, "Draft POI — initiator-generated intent record, awaiting counterparty confirmation."],
  ["poi-wording.ts", POI, "Accepted POI — mutual intent recorded."],
  ["poi-wording.ts", POI, "Proof of mutual intention recorded."],
  ["poi-wording.ts", POI, "WaD, execution, and finality remain subject"],
];
for (const [file, src, phrase] of SIGNED) {
  if (!src.includes(phrase)) {
    failures.push(`Signed wording drift in ${file}: missing "${phrase}"`);
  }
}

if (failures.length) {
  console.error("\n❌ DEC-005/006 audit-name guard FAILED:\n");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}

console.log(
  `✓ DEC-005/006: ${CANONICAL.length} canonical audit name(s) and ${SIGNED.length} signed wording phrase(s) intact.`,
);
