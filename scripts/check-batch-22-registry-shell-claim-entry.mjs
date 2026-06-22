#!/usr/bin/env node
/**
 * Batch 22 — Guard: every Trade Desk registry surface must remain inside
 * the DeskLayout shell, profile-level claim CTA must be present with
 * limited wording, and the company-specific claim route must be used.
 *
 * This script is pinned in `npm run prebuild`. It fails the build if
 * any of the following drifts:
 *   1. Registry sub-routes leak out of the <DeskLayout> block.
 *   2. Any registry surface is mounted under <DeskFullBleed>.
 *   3. CompanyProfile.tsx loses the "Is this your company?" panel,
 *      the limited claim wording, the sample-only warning hook,
 *      or the company-specific claim route.
 *   4. CompanyProfile.tsx ever references raw bank or personal
 *      contact fields.
 */
import { readFileSync } from "node:fs";

const FAILS = [];
function fail(msg) { FAILS.push(msg); }

const desk = readFileSync("src/pages/Desk.tsx", "utf8");
const profile = readFileSync("src/pages/registry/CompanyProfile.tsx", "utf8");
const claim = readFileSync("src/pages/registry/Claim.tsx", "utf8");

// 1. Registry routes inside DeskLayout block
const open = desk.indexOf("<DeskLayout>");
const close = desk.indexOf("</DeskLayout>");
if (open < 0 || close < open) fail("DeskLayout block not found in Desk.tsx");
const inside = desk.slice(open, close);
const required = [
  'path="registry"',
  'path="registry/search"',
  'path="registry/new-company-request"',
  'path="registry/company/:id"',
  'path="registry/company/:id/claim"',
  'path="registry/my-companies"',
  'path="registry/my-companies/:companyId"',
  'path="registry/my-companies/:companyId/claim"',
  'path="registry/my-companies/:companyId/authority"',
  'path="registry/my-companies/:companyId/bank-details"',
  'path="registry/my-companies/:companyId/verification"',
  'path="registry/my-companies/:companyId/evidence"',
  'path="registry/my-companies/:companyId/corrections"',
  'path="registry/my-companies/:companyId/disputes"',
  'path="registry/my-companies/:companyId/revocations"',
];
for (const r of required) {
  if (!inside.includes(r)) fail(`Missing registry sub-route inside DeskLayout: ${r}`);
}

// 2. No registry surface under DeskFullBleed
const fullBleedBlocks = desk.match(/<DeskFullBleed>[\s\S]*?<\/DeskFullBleed>/g) ?? [];
for (const block of fullBleedBlocks) {
  if (/registry/i.test(block)) {
    fail("A registry surface is mounted inside <DeskFullBleed> — sidebar would disappear.");
  }
}

// 3. CompanyProfile panel + wording
if (!profile.includes('data-testid="profile-claim-panel"')) {
  fail('CompanyProfile.tsx is missing the profile-claim-panel testid');
}
if (!profile.includes("Is this your company?")) {
  fail('CompanyProfile.tsx is missing the "Is this your company?" heading');
}
if (!profile.includes("does not verify the company profile") &&
    !profile.includes("does not verify the\n            company profile")) {
  fail('CompanyProfile.tsx is missing the required limited claim wording');
}
if (!profile.includes("Claim this company")) {
  fail('CompanyProfile.tsx is missing the "Claim this company" CTA label');
}
if (!profile.includes('data-testid="profile-claim-sample-warning"')) {
  fail('CompanyProfile.tsx is missing the sample-only warning hook');
}
if (!/`\$\{base\}\/company\/\$\{r\.id\}\/claim`/.test(profile)) {
  fail('CompanyProfile.tsx claim CTA must use the company-specific shell-aware route');
}

// 4. CompanyProfile never references raw bank or personal contact fields
const forbidden = [
  /bank_account_number/i,
  /raw_bank_details/i,
  /personal_email/i,
  /personal_phone/i,
  /residential_address/i,
];
for (const re of forbidden) {
  if (re.test(profile)) fail(`CompanyProfile.tsx references forbidden field: ${re}`);
}

// 5. Claim.tsx must explain evidence and surface the selected-company card
if (!claim.includes('data-testid="claim-selected-company-card"')) {
  fail('Claim.tsx is missing the selected-company card');
}
if (!claim.includes('data-testid="claim-evidence-explanation"')) {
  fail('Claim.tsx is missing the evidence explanation panel');
}

if (FAILS.length > 0) {
  console.error("Batch 22 guard failed:");
  for (const f of FAILS) console.error(" - " + f);
  process.exit(1);
}
console.log("Batch 22 guard passed.");
