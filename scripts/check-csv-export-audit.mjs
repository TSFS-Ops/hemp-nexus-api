#!/usr/bin/env node
/**
 * Batch U — Required Fix 5: CSV export audit prebuild guard.
 *
 * Scans `src/components/admin/**`, `src/components/desk/**`,
 * `src/components/match/**` for unaudited CSV download patterns:
 *
 *   - `downloadCSV(` from `@/lib/download-utils`
 *   - `new Blob([...], { type: "text/csv...` patterns
 *
 * Every match must instead route through `auditedDownloadCSV` /
 * `auditedDownloadCSVRaw` so a row lands in `audit_logs` BEFORE bytes
 * leave the browser (AUD-017 / AUD-012).
 *
 * Exceptions go in ALLOWLIST below with a written reason.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SCAN_DIRS = [
  join(ROOT, "src", "components", "admin"),
  join(ROOT, "src", "components", "desk"),
  join(ROOT, "src", "components", "match"),
];

// File paths (relative to repo root) that are intentionally allowed to
// use raw downloadCSV / Blob CSV. Add only with a written reason.
const ALLOWLIST = new Set([
  // (none currently — every CSV export must be audited)
]);

function walk(dir) {
  const out = [];
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    const p = join(dir, name);
    let s;
    try { s = statSync(p); } catch { continue; }
    if (s.isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(p) && !/\.test\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

const violations = [];
for (const dir of SCAN_DIRS) {
  for (const file of walk(dir)) {
    const rel = relative(ROOT, file);
    if (ALLOWLIST.has(rel)) continue;
    const src = readFileSync(file, "utf8");

    // Heuristic 1 — direct `downloadCSV(` call (not the audited variant,
    // which is `auditedDownloadCSV` / `auditedDownloadCSVRaw`).
    // Match `downloadCSV(` not preceded by `audited`.
    const re1 = /(?<!audited)\bdownloadCSV(?:Raw)?\s*\(/g;
    if (re1.test(src)) {
      violations.push({ file: rel, kind: "raw downloadCSV call" });
      continue;
    }

    // Heuristic 2 — manual Blob construction with a CSV mime.
    const re2 = /new\s+Blob\s*\([^)]*text\/csv/i;
    if (re2.test(src)) {
      violations.push({ file: rel, kind: "manual Blob([...], text/csv) export" });
      continue;
    }
  }
}

if (violations.length > 0) {
  console.error("[check-csv-export-audit] FAIL — unaudited CSV download patterns detected:");
  for (const v of violations) console.error(`  - ${v.file}  (${v.kind})`);
  console.error(`\nFix: import { auditedDownloadCSV, auditedDownloadCSVRaw } from "@/lib/download-utils" and route the export through it so an audit_logs row is written before the file is delivered. Add to ALLOWLIST in scripts/check-csv-export-audit.mjs only with a written reason.`);
  process.exit(1);
}

console.log("[check-csv-export-audit] OK — every CSV export in admin/desk/match is audited.");
