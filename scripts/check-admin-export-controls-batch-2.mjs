#!/usr/bin/env node
/**
 * Admin Export Controls Batch 2 — prebuild guard.
 *
 * Enforces:
 *
 *  1. The new edge function `admin-governance-export-request`:
 *     - calls `assertAal2`
 *     - calls `is_admin`
 *     - emits BOTH canonical audit constants (requested + blocked_or_declined)
 *     - does NOT generate files / signed URLs / CSV / Blob output
 *
 *  2. The new HQ panel `AdminGovernanceExportRequestPanel.tsx`:
 *     - does NOT contain `signedUrl`, `createSignedUrl`, `downloadCSV`,
 *       `Blob([` with `text/csv`, or `<a href=` download anchors
 *     - guards visibility on `isPlatformAdmin`
 *
 * Failure here means Batch 2 has accidentally crossed into Batch 3
 * (approve / prepare / download) scope.
 */
import { readFileSync, existsSync } from "node:fs";

const EDGE = "supabase/functions/admin-governance-export-request/index.ts";
const PANEL =
  "src/components/admin/governance/AdminGovernanceExportRequestPanel.tsx";

const failures = [];

function must(path, label, predicates) {
  if (!existsSync(path)) {
    failures.push(`${label}: missing file ${path}`);
    return;
  }
  const src = readFileSync(path, "utf8");
  for (const [name, re, expect] of predicates) {
    const found = re.test(src);
    if (found !== expect) {
      failures.push(
        `${label}: predicate "${name}" expected ${expect ? "PRESENT" : "ABSENT"} but was ${found ? "PRESENT" : "ABSENT"} in ${path}`,
      );
    }
  }
}

must(EDGE, "edge:admin-governance-export-request", [
  ["calls assertAal2", /\bassertAal2\s*\(/, true],
  ["calls is_admin RPC", /rpc\(\s*["']is_admin["']/, true],
  [
    "emits requested audit",
    /DATA_010_AUDIT_ACTIONS\.requested/,
    true,
  ],
  [
    "emits blocked_or_declined audit",
    /DATA_010_AUDIT_ACTIONS\.blocked_or_declined/,
    true,
  ],
  [
    "no signed URL minting",
    /createSignedUrl\s*\(|signed_url\s*[:=]/,
    false,
  ],
  [
    "no storage upload",
    /storage\.from\([^)]*\)\.upload\s*\(/,
    false,
  ],
  ["no toCsv", /\btoCsv\s*\(/, false],
  [
    "no manual CSV blob",
    /new\s+Blob\s*\([^)]*text\/csv/i,
    false,
  ],
]);

must(PANEL, "panel:AdminGovernanceExportRequestPanel", [
  ["guards on isPlatformAdmin", /isPlatformAdmin/, true],
  [
    "no signed URL handling",
    /signedUrl|createSignedUrl|signed_url/,
    false,
  ],
  ["no downloadCSV", /\bdownloadCSV(?:Raw)?\s*\(/, false],
  [
    "no CSV blob",
    /new\s+Blob\s*\([^)]*text\/csv/i,
    false,
  ],
  [
    "no anchor download attribute",
    /<a[^>]*\bdownload\b/i,
    false,
  ],
  [
    "calls admin-governance-export-request",
    /["']admin-governance-export-request["']/,
    true,
  ],
]);

if (failures.length > 0) {
  console.error(
    "[check-admin-export-controls-batch-2] FAIL — unsafe export shortcut detected:",
  );
  for (const f of failures) console.error(`  - ${f}`);
  console.error(
    "\nBatch 2 scope is request + audit ONLY. Approve / prepare / download / file generation are NOT allowed in this batch.",
  );
  process.exit(1);
}

console.log(
  "[check-admin-export-controls-batch-2] OK — request shell stays within scope.",
);
