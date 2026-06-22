#!/usr/bin/env node
/**
 * Batch 31 — Cross-surface consistency guard.
 *
 * Pre-client embarrassment audit: re-asserts the invariants from
 * Batches 22–30 in a single sweep so a regression in any single SSOT,
 * UI surface, evidence README or release-gate row is caught before any
 * client-facing pack is generated.
 *
 * Pure textual checks against the repo. No network, no DB.
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const FAILS = [];
const fail = (m) => FAILS.push(m);
const must = (cond, m) => { if (!cond) fail(m); };
const read = (p) => existsSync(p) ? readFileSync(p, "utf8") : "";

// ─── 1. Each Batch 24–30 SSOT pair exists and the parity guards exist ──
const SSOT_PAIRS = [
  ["src/lib/registry-operating-rules.ts",            "supabase/functions/_shared/registry-operating-rules.ts",            "scripts/check-registry-operating-rules-parity.mjs"],
  ["src/lib/registry-provenance-import-rules.ts",    "supabase/functions/_shared/registry-provenance-import-rules.ts",    "scripts/check-registry-provenance-import-rules-parity.mjs"],
  ["src/lib/registry-search-profile-rules.ts",       "supabase/functions/_shared/registry-search-profile-rules.ts",       "scripts/check-registry-search-profile-rules-parity.mjs"],
  ["src/lib/registry-claim-authority-rules.ts",      "supabase/functions/_shared/registry-claim-authority-rules.ts",      "scripts/check-registry-claim-authority-rules-parity.mjs"],
  ["src/lib/registry-bank-operating-rules.ts",       "supabase/functions/_shared/registry-bank-operating-rules.ts",       "scripts/check-registry-bank-operating-rules-parity.mjs"],
  ["src/lib/registry-api-operating-rules.ts",        "supabase/functions/_shared/registry-api-operating-rules.ts",        "scripts/check-registry-api-operating-rules-parity.mjs"],
  ["src/lib/registry-operations-outreach-rules.ts",  "supabase/functions/_shared/registry-operations-outreach-rules.ts",  "scripts/check-registry-operations-outreach-rules-parity.mjs"],
];
for (const [browser, deno, guard] of SSOT_PAIRS) {
  must(existsSync(browser), `Missing browser SSOT: ${browser}`);
  must(existsSync(deno), `Missing Deno SSOT: ${deno}`);
  must(existsSync(guard), `Missing parity guard: ${guard}`);
}

// ─── 2. Evidence README + central index reference Batches 24–31 ────────
const evIndex = read("evidence/registry-evidence-index/README.md");
for (const n of [24, 25, 26, 27, 28, 29, 30, 31]) {
  must(
    evIndex.includes(`batch-${n}-`) || new RegExp(`\\|\\s*${n}\\s*\\|`).test(evIndex),
    `evidence/registry-evidence-index/README.md missing Batch ${n} row`,
  );
}
for (const n of [24, 25, 26, 27, 28, 29, 30, 31]) {
  const candidates = readdirSync("evidence")
    .filter((d) => d.startsWith(`batch-${n}-`) && statSync(join("evidence", d)).isDirectory());
  must(candidates.length > 0, `Missing evidence dir for Batch ${n}`);
  for (const c of candidates) {
    must(existsSync(join("evidence", c, "README.md")), `Missing README.md in evidence/${c}/`);
  }
}

// ─── 3. Release gate must not claim production-ready by default ────────
const gate = read("RELEASE_GATE.md");
must(gate.length > 0, "RELEASE_GATE.md missing");
// Forbidden top-level overclaims (must not appear as a status assertion).
const forbiddenGateLines = [
  /^\s*Final\s+status:\s*production[_ -]?ready\s*$/im,
  /^\s*Default\s+release\s+status:\s*production[_ -]?ready\s*$/im,
];
for (const re of forbiddenGateLines) {
  must(!re.test(gate), `RELEASE_GATE.md asserts production_ready as default (matches ${re})`);
}

// ─── 4. Batch 30 SSOT pins the SMS / WhatsApp not-configured labels ────
const opsSsot = read("src/lib/registry-operations-outreach-rules.ts");
must(opsSsot.includes('"SMS not configured"'),       "Batch 30 SSOT must pin 'SMS not configured'");
must(opsSsot.includes('"WhatsApp not configured"'),  "Batch 30 SSOT must pin 'WhatsApp not configured'");
must(/REGISTRY_OPS_AI_DRAFT_ONLY\s*=\s*true/.test(opsSsot),    "Batch 30 SSOT must pin REGISTRY_OPS_AI_DRAFT_ONLY = true");
must(/REGISTRY_OPS_AI_MAY_AUTO_SEND\s*=\s*false/.test(opsSsot),"Batch 30 SSOT must pin REGISTRY_OPS_AI_MAY_AUTO_SEND = false");

// ─── 5. Batch 29 SSOT pins sandbox default + no public self-serve prod ─
const apiSsot = read("src/lib/registry-api-operating-rules.ts");
must(/DEFAULT_ENVIRONMENT[^\n]*=\s*['"]sandbox['"]/.test(apiSsot),
     "Batch 29 SSOT must set DEFAULT_ENVIRONMENT = 'sandbox'");
must(/PUBLIC_SELF_SERVE_PRODUCTION[^\n]*=\s*false/.test(apiSsot),
     "Batch 29 SSOT must set PUBLIC_SELF_SERVE_PRODUCTION = false");
must(/RAW_BANK[^\n]*BLOCKED[^\n]*=\s*true/.test(apiSsot),
     "Batch 29 SSOT must set RAW_BANK ... BLOCKED = true");

// ─── 6. Shell invariants (Batch 22) — registry routes stay in DeskLayout
const desk = read("src/pages/Desk.tsx");
const openL = desk.indexOf("<DeskLayout>");
const closeL = desk.indexOf("</DeskLayout>");
must(openL > 0 && closeL > openL, "Desk.tsx missing <DeskLayout> block");
const inside = desk.slice(openL, closeL);
for (const route of ['path="registry"', 'path="registry/search"', 'path="registry/company/:id"', 'path="registry/company/:id/claim"']) {
  must(inside.includes(route), `Registry route ${route} must sit inside <DeskLayout>`);
}
// No registry route in <DeskFullBleed>.
const fullBleed = desk.match(/<DeskFullBleed>[\s\S]*?<\/DeskFullBleed>/g) ?? [];
for (const block of fullBleed) {
  must(!/registry/i.test(block), "Registry routes must not be wrapped in <DeskFullBleed>");
}

// ─── 7. Profile-level Claim Your Company panel (Batch 22) ──────────────
const profile = read("src/pages/registry/CompanyProfile.tsx");
must(profile.includes('data-testid="profile-claim-panel"'),
     "CompanyProfile.tsx must render the profile-claim-panel");
must(profile.includes("Is this your company?"),
     "CompanyProfile.tsx must keep the 'Is this your company?' heading");
must(!/bank_account_number|raw_bank_details|personal_email|personal_phone|residential_address/i.test(profile),
     "CompanyProfile.tsx must never reference raw bank or personal contact fields");

// ─── 8. Typeahead safety rails (Batch 23) ──────────────────────────────
const ty = read("src/components/registry/CompanyTypeahead.tsx");
must(ty.includes("SAFE_MATCH_FIELDS"), "CompanyTypeahead must keep SAFE_MATCH_FIELDS allow-list");
for (const forbidden of [/bank[_-]?account/i, /\biban\b/i, /personal[_-]?email/i, /personal[_-]?phone/i, /provider[_-]?payload/i, /raw[_-]?evidence/i]) {
  must(!forbidden.test(ty), `CompanyTypeahead must not reference ${forbidden}`);
}
for (const forbidden of [/\bverified\b/i, /\bguaranteed\b/i, /\bofficially confirmed\b/i, /\bproduction[- ]ready\b/i]) {
  must(!forbidden.test(ty), `CompanyTypeahead must not use overclaiming wording ${forbidden}`);
}

// ─── 9. Handover + cross-surface matrix docs exist ─────────────────────
must(existsSync("docs/registry/operating-rules-developer-handover.md"),
     "Missing docs/registry/operating-rules-developer-handover.md");
must(existsSync("docs/registry/operating-rules-cross-surface-matrix.md"),
     "Missing docs/registry/operating-rules-cross-surface-matrix.md");

// ─── Report ────────────────────────────────────────────────────────────
if (FAILS.length > 0) {
  console.error("Batch 31 cross-surface consistency guard FAILED:\n - " + FAILS.join("\n - "));
  process.exit(1);
}
console.log("Batch 31 cross-surface consistency guard OK.");
