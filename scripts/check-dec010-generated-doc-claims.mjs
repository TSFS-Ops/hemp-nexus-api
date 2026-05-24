#!/usr/bin/env node
/**
 * DEC-010 Phase 1 prebuild guard — generated-document / investor-adjacent
 * claim scanner.
 *
 * Source of truth: signed Client-Only Decision Form, DEC-010.
 *
 * The existing `scripts/check-legal-claims.mjs` scans static public
 * marketing/docs pages. This guard extends static lint coverage to
 * surfaces that produce generated documents (PDFs, certificates,
 * developer guides) and any investor-adjacent template that exists in
 * the repo. It mirrors `FORBIDDEN_PUBLIC_CLAIM_PHRASES` from
 * `src/lib/legal/forbidden-terms.ts` so the two surfaces stay in
 * lockstep. Lines marked `LEGAL_ALLOW` are exempt (mirrors the
 * existing public-page guard convention).
 *
 * Additionally asserts that the four DEC-010 classification tiers and
 * the three canonical audit action constants are declared in
 * `src/lib/legal/claims-register.ts`. This is a static SSOT pin — no
 * runtime emission is required or wired by Phase 1 for the
 * `claims.claim_approved_by_admin` action (Phase 2 / not implemented).
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();

const SCAN_FILES = [
  // Generated documents / templates
  "supabase/functions/deal-certificate/index.ts",
  "src/components/developer/IntegrationGuidePdf.ts",
];

// Mirrors FORBIDDEN_PUBLIC_CLAIM_PHRASES (kept inline so the script
// stays free of TS imports).
const FORBIDDEN_PHRASES = [
  "binding POI",
  "sealed POI",
  "POI sealed",
  "tamper-proof Proof of Intent",
  "completed transaction",
  "final trade",
  "terms are now immutable",
  "automated compliance",
  "continuous sanctions screening",
  "real-time compliance",
  "fully automated end-to-end",
  "guarantees compliance",
  "prevents all fraud",
  "Izenzo replaces legal review",
  "Izenzo replaces financial review",
  "Izenzo replaces regulatory review",
  "Izenzo replaces human review",
  "replaces legal review",
  "replaces financial review",
  "replaces regulatory review",
  "replaces human review",
  "production-grade audit",
  "regulator-ready audit",
  "demo data is live traction",
  "test data is live traction",
  "controlled demo records are live commercial traction",
  "live production traction from demo records",
];

const REGISTER_FILE = "src/lib/legal/claims-register.ts";
const REQUIRED_CLASSIFICATIONS = [
  '"approved_now"',
  '"approved_after_hardening"',
  '"prohibited"',
  '"manual_review_required"',
];
const REQUIRED_AUDIT_NAMES = [
  '"claims.claim_evaluated"',
  '"claims.unapproved_claim_blocked"',
  '"claims.claim_approved_by_admin"',
];

const errors = [];

// 1. Claims-register SSOT must declare all four tiers and all three
//    canonical DEC-010 audit action constants.
try {
  const src = readFileSync(resolve(ROOT, REGISTER_FILE), "utf8");
  for (const t of REQUIRED_CLASSIFICATIONS) {
    if (!src.includes(t)) {
      errors.push(`${REGISTER_FILE} is missing classification literal ${t}.`);
    }
  }
  for (const a of REQUIRED_AUDIT_NAMES) {
    if (!src.includes(a)) {
      errors.push(
        `${REGISTER_FILE} is missing canonical DEC-010 audit action literal ${a}.`,
      );
    }
  }
} catch (err) {
  errors.push(`Could not read ${REGISTER_FILE}: ${err.message}`);
}

// 2. Scan generated-document / investor-adjacent surfaces for
//    forbidden DEC-010 prose. Lines marked LEGAL_ALLOW are exempt.
for (const rel of SCAN_FILES) {
  const abs = resolve(ROOT, rel);
  if (!existsSync(abs)) continue;
  const src = readFileSync(abs, "utf8");
  const lines = src.split("\n");
  lines.forEach((line, idx) => {
    if (line.includes("LEGAL_ALLOW")) return;
    const lower = line.toLowerCase();
    for (const phrase of FORBIDDEN_PHRASES) {
      if (lower.includes(phrase.toLowerCase())) {
        errors.push(
          `${rel}:${idx + 1}  forbidden DEC-010 phrase  "${phrase}"  →  ${line
            .trim()
            .slice(0, 140)}`,
        );
      }
    }
  });
}

if (errors.length > 0) {
  console.error(
    "\n❌ DEC-010 Phase 1 generated-document claim guard FAILED:\n",
  );
  for (const e of errors) console.error("  - " + e);
  console.error(
    "\nReplace with approved claims (see src/lib/legal/claims-register.ts) " +
      "or qualify with an explicit LEGAL_ALLOW marker if the surface " +
      "must quote a forbidden phrase as an example.\n",
  );
  process.exit(1);
}

console.log(
  "✅ DEC-010 Phase 1 generated-document claim guard passed (classification tiers + audit constants pinned, no forbidden generated-doc claims).",
);
