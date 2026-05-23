#!/usr/bin/env node
/**
 * DATA-010 Phase 1 — Export audit payload prebuild guard.
 *
 * Scans `src/components/{admin,desk,match}/**` and `src/components/MatchesList.tsx`
 * for every call to `auditedDownloadCSV`, `auditedDownloadCSVRaw`, or
 * `recordExportAudit`, extracts the options object passed in, and FAILS
 * the build if any of the DATA-010-required fields are missing:
 *
 *   - `purpose:`        — ExportPurpose enum (required server-side)
 *   - `reason`          — operator justification (server min 10 chars)
 *   - `data_categories` — what kind of data is leaving the system
 *   - `target_type:`    — for auditedDownloadCSV* callers
 *
 * This is a static guard. Server-side validation in
 * `supabase/functions/export-audit/index.ts` still enforces the values
 * at runtime, but this script catches drift at build time so missing
 * fields never reach production.
 *
 * Allowlist entries below MUST carry a written reason.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SCAN_DIRS = [
  join(ROOT, "src", "components", "admin"),
  join(ROOT, "src", "components", "desk"),
  join(ROOT, "src", "components", "match"),
];
const EXTRA_FILES = [join(ROOT, "src", "components", "MatchesList.tsx")];

// File paths (relative to repo root) that may legitimately bypass the
// strict payload check (e.g. test fixtures). Add only with a reason.
const ALLOWLIST = new Set([
  // (none currently)
]);

const CALL_NAMES = [
  "auditedDownloadCSV",
  "auditedDownloadCSVRaw",
  "recordExportAudit",
];

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

function extractCallBlock(src, startIdx) {
  // Find the first `{` after startIdx, then walk braces to its match.
  let i = src.indexOf("{", startIdx);
  if (i === -1) return null;
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return src.slice(i, j + 1);
    }
  }
  return null;
}

const violations = [];

function checkFile(file) {
  const rel = relative(ROOT, file);
  if (ALLOWLIST.has(rel)) return;
  const raw = readFileSync(file, "utf8");
  // Strip block + line comments so commented-out examples don't trip us up.
  const src = raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");

  for (const name of CALL_NAMES) {
    const re = new RegExp(`\\b${name}\\s*\\(`, "g");
    let m;
    while ((m = re.exec(src)) !== null) {
      const block = extractCallBlock(src, m.index + m[0].length);
      if (!block) continue;
      const missing = [];
      if (!/\bpurpose\s*:/.test(block)) missing.push("purpose");
      if (!/\breason\b/.test(block)) missing.push("reason");
      if (!/\bdata_categories\s*:/.test(block)) missing.push("data_categories");
      if (name !== "recordExportAudit" && !/\btarget_type\s*:/.test(block)) {
        missing.push("target_type");
      }
      if (missing.length > 0) {
        const line = src.slice(0, m.index).split("\n").length;
        violations.push({ file: rel, line, call: name, missing });
      }
    }
  }
}

for (const dir of SCAN_DIRS) for (const f of walk(dir)) checkFile(f);
for (const f of EXTRA_FILES) {
  try { statSync(f); checkFile(f); } catch { /* skip */ }
}

if (violations.length > 0) {
  console.error("[check-export-audit-payload] FAIL — DATA-010 required fields missing:");
  for (const v of violations) {
    console.error(`  - ${v.file}:${v.line}  ${v.call}(...)  missing: ${v.missing.join(", ")}`);
  }
  console.error(
    "\nFix: every admin/desk/match export call must include `purpose`, `reason`, " +
      "`data_categories`, and (for auditedDownloadCSV*) `target_type`. " +
      "See src/lib/export-purpose.ts and src/lib/download-utils.ts. " +
      "Add to ALLOWLIST in scripts/check-export-audit-payload.mjs only with a written reason.",
  );
  process.exit(1);
}

console.log("[check-export-audit-payload] OK — every admin export call carries DATA-010 metadata.");
