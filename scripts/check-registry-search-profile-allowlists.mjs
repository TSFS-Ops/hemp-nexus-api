#!/usr/bin/env node
/**
 * Batch 26 — Guard: the SSOT enforces every client-decision invariant.
 *
 *   - public officer-name search disabled
 *   - public email/phone search disabled
 *   - partial-match minimum >= 3 characters
 *   - typo-match minimum confidence >= 0.85
 *   - public minimum confidence >= 0.75
 *   - excluded fields stay excluded
 *   - admin-only match reasons never appear in the public allow-list
 *   - corrections never auto-publish, are versioned, old values are
 *     admin-only by default
 *   - no-result wording is exact and queue-only side effects
 *
 * Pure source inspection — no imports. Keeps the guard cheap and
 * robust during prebuild.
 */
import { readFileSync } from "node:fs";

const FAILS = [];
const fail = (m) => FAILS.push(m);
const src = readFileSync("src/lib/registry-search-profile-rules.ts", "utf8");

const want = [
  ["OFFICER_PUBLIC_SEARCH_ENABLED = false", "public officer search must be disabled"],
  ["EMAIL_PUBLIC_SEARCH_ENABLED = false", "public email search must be disabled"],
  ["PHONE_PUBLIC_SEARCH_ENABLED = false", "public phone search must be disabled"],
  ["PARTIAL_MATCH_MIN_CHARS = 3", "partial-match minimum must be 3 characters"],
  ["TYPO_MIN_CONFIDENCE = 0.85", "typo-match floor must be 0.85"],
  ["PUBLIC_MIN_CONFIDENCE = 0.75", "public-result floor must be 0.75"],
  ["CORRECTION_NEVER_AUTO_PUBLISHES = true", "corrections must never auto-publish"],
  ["CORRECTION_USES_VERSIONED_HISTORY = true", "corrections must be versioned"],
  ["CORRECTION_OLD_VALUES_ADMIN_ONLY_BY_DEFAULT = true", "old correction values must be admin-only by default"],
  ['NO_RESULT_WORDING =\n  "No matching company found in the currently searchable registry."', "no-result wording is exact"],
  ['NO_RESULT_QUEUE_EVENT = "company_addition_requested"', "no-result emits company_addition_requested only"],
];
for (const [needle, why] of want) {
  if (!src.includes(needle)) fail(`${why} — missing literal: ${needle.split("\n")[0]}`);
}

const excluded = ["raw_bank_details", "identity_documents", "passwords_secrets", "private_notes", "restricted_personal_data"];
for (const f of excluded) {
  const re = new RegExp(`${f}:\\s*"excluded"`);
  if (!re.test(src)) fail(`excluded field ${f} must keep classification "excluded"`);
}

const publicReasonsBlock = src.match(/PUBLIC_SAFE_MATCH_REASONS:[^[]*\[([\s\S]*?)\];/);
const adminReasonsBlock = src.match(/ADMIN_ONLY_MATCH_REASONS:[^[]*\[([\s\S]*?)\];/);
if (!publicReasonsBlock) fail("PUBLIC_SAFE_MATCH_REASONS array not found");
if (!adminReasonsBlock) fail("ADMIN_ONLY_MATCH_REASONS array not found");
if (publicReasonsBlock && adminReasonsBlock) {
  const pubLabels = [...publicReasonsBlock[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  const adminLabels = [...adminReasonsBlock[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  for (const a of adminLabels) {
    if (pubLabels.includes(a)) fail(`admin-only match reason "${a}" leaked into the public allow-list`);
  }
  const requiredAdmin = ["Officer / person match", "Phone match", "Email match", "Import batch"];
  for (const r of requiredAdmin) {
    if (!adminLabels.includes(r)) fail(`admin-only match reasons must include "${r}"`);
  }
  const requiredPublic = [
    "Matched company name",
    "Matched trading name",
    "Matched registration number",
    "Matched jurisdiction",
    "Matched approved alias",
    "Similar name - check details",
    "Matched approved public identifier",
  ];
  for (const r of requiredPublic) {
    if (!pubLabels.includes(r)) fail(`public safe match reasons must include "${r}"`);
  }
}

if (FAILS.length) {
  console.error("❌ Batch 26 search/profile allow-list guard FAILED:\n - " + FAILS.join("\n - "));
  process.exit(1);
}
console.log("✓ Batch 26 search/profile allow-list guard OK");
