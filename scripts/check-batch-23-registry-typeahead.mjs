#!/usr/bin/env node
/**
 * Batch 23 — Guard: the registry typeahead component must keep its
 * safety rails. Fails the build if:
 *   1. The safe match-reason allow-list is removed.
 *   2. Unsafe field references (bank/personal-contact/provider
 *      payload/raw evidence/compliance notes) leak into the component.
 *   3. Verification / production-ready / guaranteed wording appears
 *      inside the dropdown markup.
 *   4. The sample-record chip is removed.
 *   5. The "Show all results" link drops the query or shell base.
 *   6. The typeahead bypasses the shell-aware rebase helper.
 *   7. The /desk/registry/search route is no longer inside the
 *      DeskLayout block.
 */
import { readFileSync } from "node:fs";

const FAILS = [];
const fail = (m) => FAILS.push(m);

const typeahead = readFileSync(
  "src/components/registry/CompanyTypeahead.tsx",
  "utf8",
);
const search = readFileSync("src/pages/registry/Search.tsx", "utf8");
const desk = readFileSync("src/pages/Desk.tsx", "utf8");

if (!/SAFE_MATCH_FIELDS\.has\(m\.field_label\)/.test(typeahead)) {
  fail("CompanyTypeahead: SAFE_MATCH_FIELDS allow-list filter is missing.");
}

const FORBIDDEN_SUBSTRINGS = [
  /bank[_-]?account/i,
  /\biban\b/i,
  /personal[_-]?email/i,
  /personal[_-]?phone/i,
  /personal[_-]?address/i,
  /provider[_-]?payload/i,
  /compliance[_-]?note/i,
  /raw[_-]?evidence/i,
];
for (const re of FORBIDDEN_SUBSTRINGS) {
  if (re.test(typeahead)) fail(`CompanyTypeahead: forbidden reference ${re}`);
}

const FORBIDDEN_WORDING = [
  /\bverified\b/i,
  /\bproduction[- ]ready\b/i,
  /\bguaranteed\b/i,
  /\bofficially confirmed\b/i,
];
for (const re of FORBIDDEN_WORDING) {
  if (re.test(typeahead)) fail(`CompanyTypeahead: forbidden wording ${re}`);
}

if (!/Sample record/.test(typeahead)) {
  fail("CompanyTypeahead: sample-record chip removed.");
}

if (!/rebaseRegistryPath\(r\.profile_link, base\)/.test(typeahead)) {
  fail("CompanyTypeahead: selection no longer routes via rebaseRegistryPath.");
}

if (!/params\.set\("q", query\.trim\(\)\)/.test(typeahead) ||
    !/\$\{base\}\/search\?/.test(typeahead)) {
  fail("CompanyTypeahead: 'Show all results' link lost query or shell base.");
}

if (!/<CompanyTypeahead /.test(search)) {
  fail("Search.tsx: CompanyTypeahead is no longer mounted on the search page.");
}

const open = desk.indexOf("<DeskLayout>");
const close = desk.indexOf("</DeskLayout>");
if (open < 0 || close < open) {
  fail("Desk.tsx: DeskLayout block not found.");
} else if (!/path="registry\/search"/.test(desk.slice(open, close))) {
  fail("Desk.tsx: registry/search route is outside the DeskLayout shell.");
}

if (FAILS.length > 0) {
  console.error("Batch 23 typeahead guard FAILED:\n - " + FAILS.join("\n - "));
  process.exit(1);
}
console.log("Batch 23 typeahead guard OK.");
