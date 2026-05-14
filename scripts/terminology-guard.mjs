#!/usr/bin/env node
/**
 * Izenzo Terminology & Standards Guard
 *
 * Scans user-facing source files for banned terms, American spellings,
 * and legacy acronyms that violate the institutional style guide.
 *
 * Exit code 1 if violations found (blocks CI merge).
 *
 * Usage:
 *   node scripts/terminology-guard.mjs
 *   node scripts/terminology-guard.mjs --fix  (future: auto-replace)
 */

import { readFileSync, readdirSync, statSync } from "fs";
import { join, extname } from "path";

const SCAN_DIRS = ["src/components", "src/pages"];
const EXTENSIONS = new Set([".tsx", ".ts"]);
const IGNORE_PATHS = [
  "node_modules", ".test.", "test-client", "tests/", "__tests__",
  "integrations/supabase/types.ts", "integrations/supabase/client.ts",
];

// Banned terms: [regex, human-readable label, suggested replacement]
//
// Aligned with canon (mem://index, 2026-05-14):
//   - "Counterparty" is CANONICAL (do not flag).
//   - "POI" and "WaD" acronyms are CANONICAL in UI; "WaD" must always
//     expand as "Without a Doubt" — never "Warrant of Diligence".
//   - "Proof of Intention" is wrong; canon is "Proof of Intent".
//   - "Bid/Offer" is banned in UI; use Trade Request.
const BANNED_TERMS = [
  [/\bProof of Intention\b/gi, "Proof of Intention", "Proof of Intent"],
  [/\bWarrant of Diligence\b/gi, "Warrant of Diligence (wrong WaD expansion)", "Without a Doubt"],
  [/\bFinalise[d]?\s+Commitment\b/gi, "Finalised Commitment", "Signed Deal"],
  [/\bCompliance Match\b/gi, "Compliance Match", "Izenzo"],
  [/\bBid\s*\/\s*Offer\b/gi, "Bid/Offer", "Trade Request"],
  [/\b(?:demo|illustrative|mock-up)\b/gi, "demo/illustrative/mock-up", "(remove or replace)"],
  [/\bOrganization\b/g, "Organization (US spelling)", "Organisation"],
  [/\bFinalize\b/g, "Finalize (US spelling)", "Finalise"],
  [/\bLicense\b/g, "License (US spelling)", "Licence (noun)"],
];

// No acronym bans — POI and WaD are canonical UI tokens.
const ACRONYM_PATTERNS = [];

let totalViolations = 0;

function scanFile(filePath) {
  const content = readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const violations = [];

  // Allowlisted patterns: API payload keys, HTML IDs, and DB enum values
  const ALLOWLIST = [
    /counterparty:\s*\{/,                    // JSON payload key in API calls
    /value="share_with_counterparty"/,       // DB enum value
    /id="counterparty"/,                     // HTML element ID
    /htmlFor="counterparty"/,                // HTML label association
    /\.from\(["']counterparties["']\)/,            // Supabase table name reference
  ];

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = rawLine;

    // Skip allowlisted lines
    if (ALLOWLIST.some((al) => al.test(line))) continue;

    // Skip pure code-comment lines and block-comment bodies — the guard only
    // cares about user-facing copy, not internal documentation.
    const trimmed = line.trim();
    const isCommentLine =
      trimmed.startsWith("//") ||
      trimmed.startsWith("/*") ||
      trimmed.startsWith("*") ||
      trimmed.startsWith("*/");
    if (isCommentLine) continue;

    for (const [pattern, label, fix] of BANNED_TERMS) {
      pattern.lastIndex = 0;
      if (pattern.test(line)) {
        violations.push({ line: i + 1, term: label, fix, text: line.trim().slice(0, 80) });
      }
    }

    for (const [pattern, label] of ACRONYM_PATTERNS) {
      pattern.lastIndex = 0;
      if (pattern.test(line)) {
        violations.push({ line: i + 1, term: label, fix: "Remove acronym", text: line.trim().slice(0, 80) });
      }
    }
  }

  if (violations.length > 0) {
    console.log(`\n  ${filePath}`);
    for (const v of violations) {
      console.log(`    L${v.line}: [${v.term}] -> ${v.fix}`);
      console.log(`           ${v.text}`);
    }
    totalViolations += violations.length;
  }
}

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (IGNORE_PATHS.some((p) => full.includes(p))) continue;
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full);
    else if (EXTENSIONS.has(extname(full))) scanFile(full);
  }
}

console.log("Izenzo Terminology Guard");
console.log("========================");

for (const dir of SCAN_DIRS) {
  try { walk(dir); } catch { /* dir may not exist */ }
}

if (totalViolations > 0) {
  console.log(`\n FAIL: ${totalViolations} terminology violation(s) found.`);
  process.exit(1);
} else {
  console.log("\n PASS: No terminology violations detected.");
  process.exit(0);
}
