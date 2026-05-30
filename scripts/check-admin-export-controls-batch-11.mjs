#!/usr/bin/env node
/**
 * Admin Export Controls Batch 11 — prebuild guard.
 *
 * Batch 11 is an evidence-only batch: it turns the Batch 10 manual QA
 * pack into a structured evidence folder. This guard pins the contract
 * so the folder cannot silently mutate into a place where someone
 * claims fake screenshots or instructs testers to run generation/
 * download/prepare/destroy actions.
 *
 * Asserts:
 *   1. The Batch 11 evidence folder + required files exist.
 *   2. README + qa-results + screenshot-index do not contain positive
 *      instructions to download / generate / prepare / destroy exports.
 *   3. Evidence does not claim a screenshot exists unless the PNG file
 *      is actually present on disk.
 *   4. No runtime export-controls source picked up forbidden tokens.
 *      (Mirrors the Batch 10 sanity scan for defence-in-depth.)
 *   5. Batch 7C production guard remains intact (file present + still
 *      references the production environment check).
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const failures = [];
const DIR = "evidence/admin-export-controls-batch-11-qa-dry-run";
const REQUIRED = ["README.md", "qa-results.md", "screenshot-index.md", "qa-results.json"];

// 1. Folder + required files
if (!existsSync(DIR)) {
  failures.push(`Batch 11 evidence folder missing: ${DIR}`);
} else {
  for (const f of REQUIRED) {
    if (!existsSync(join(DIR, f))) failures.push(`Missing required file: ${DIR}/${f}`);
  }
}

// 2. No positive instructions to perform forbidden actions.
//    Treat each line in isolation; allow lines whose context is negative
//    (no/not/never/absent/forbidden/blocker/STOP/button absent/etc.).
const FORBIDDEN_INSTRUCTIONS = [
  [/^\s*(?:\d+\.|-|\*)?\s*click\s+download\b/i, "instructs testers to click download"],
  [/^\s*(?:\d+\.|-|\*)?\s*download the (csv|pdf|json|file)\b/i, "instructs testers to download a file"],
  [/^\s*(?:\d+\.|-|\*)?\s*generate (the )?export\b/i, "instructs testers to generate an export"],
  [/^\s*(?:\d+\.|-|\*)?\s*prepare (the )?export\b/i, "instructs testers to prepare an export"],
  [/^\s*(?:\d+\.|-|\*)?\s*destroy (the )?export\b/i, "instructs testers to destroy an export"],
];
const isNegativeContext = (line) =>
  /\bno\b|\bnot\b|\bnever\b|absent|forbid|forbidden|blocker|STOP|button|appears?\b|wording|listing|list of|surfaces?\b|placeholder|do not|don't/i.test(line);

for (const f of REQUIRED.filter((n) => n.endsWith(".md"))) {
  const p = join(DIR, f);
  if (!existsSync(p)) continue;
  const src = readFileSync(p, "utf8");
  for (const line of src.split(/\r?\n/)) {
    if (isNegativeContext(line)) continue;
    for (const [re, label] of FORBIDDEN_INSTRUCTIONS) {
      if (re.test(line)) failures.push(`${f}: ${label} (line: ${line.trim().slice(0, 120)})`);
    }
  }
}

// 3. No fake-screenshot claims: any screenshot referenced as captured
//    must actually exist on disk. We treat status:"captured" in the
//    JSON OR a "Captured? | yes" cell in screenshot-index.md as a claim
//    that requires a real PNG.
const SHOT_DIR = join(DIR, "screenshots");
const presentShots = existsSync(SHOT_DIR)
  ? new Set(readdirSync(SHOT_DIR).filter((n) => n.toLowerCase().endsWith(".png")))
  : new Set();

const idxPath = join(DIR, "screenshot-index.md");
if (existsSync(idxPath)) {
  const idx = readFileSync(idxPath, "utf8");
  // Match table rows like `| 1 | b10-foo.png | ... | yes |`
  const rowRe = /\|\s*\d+\s*\|\s*`?([\w.-]+\.png)`?\s*\|[^|]*\|\s*(yes|captured|✅)\s*\|/gi;
  let m;
  while ((m = rowRe.exec(idx)) !== null) {
    const file = m[1];
    if (!presentShots.has(file)) {
      failures.push(`screenshot-index.md claims '${file}' is captured but it is missing in ${SHOT_DIR}/`);
    }
  }
}

const jsonPath = join(DIR, "qa-results.json");
if (existsSync(jsonPath)) {
  try {
    const data = JSON.parse(readFileSync(jsonPath, "utf8"));
    const claimed = data.screenshots_captured === true;
    if (claimed && presentShots.size === 0) {
      failures.push(`qa-results.json claims screenshots_captured=true but ${SHOT_DIR}/ has no PNGs`);
    }
    for (const s of data.scenarios ?? []) {
      if (s.status === "passed" && s.screenshot && typeof s.screenshot === "string") {
        const base = s.screenshot.replace(/^.*\//, "");
        if (!presentShots.has(base)) {
          failures.push(`qa-results.json scenario ${s.id} marked passed but screenshot '${base}' missing`);
        }
      }
    }
  } catch (e) {
    failures.push(`qa-results.json failed to parse: ${e.message}`);
  }
}

// 4. Defensive runtime re-scan (mirror of Batch 10) — Batch 11 must
//    not have nudged any runtime file toward a generation surface.
const RUNTIME_TARGETS = [
  "supabase/functions/admin-governance-export-list/index.ts",
  "supabase/functions/admin-governance-export-preview/index.ts",
  "src/components/admin/governance/AdminGovernanceExportRequestsListPanel.tsx",
  "src/components/admin/governance/AdminGovernanceExportPreviewPanel.tsx",
];
const FORBIDDEN_RUNTIME = [
  [/createSignedUrl\s*\(/, "createSignedUrl"],
  [/\bsigned_url\b/, "signed_url"],
  [/storage\.from\([^)]*\)\.upload\s*\(/, "storage upload"],
  [/new\s+Blob\s*\(/, "new Blob("],
  [/URL\.createObjectURL\s*\(/, "URL.createObjectURL("],
  [/Content-Disposition/i, "Content-Disposition"],
  [/text\/csv/i, "text/csv"],
  [/application\/pdf/i, "application/pdf"],
  [/<a[^>]*\bdownload\b/i, "anchor download attribute"],
  [/["']admin-governance-export-(prepare|download|destroy)["']/, "prepare/download/destroy invocation"],
];
for (const path of RUNTIME_TARGETS) {
  if (!existsSync(path)) {
    failures.push(`Batch 11 sanity: expected runtime target missing: ${path}`);
    continue;
  }
  const src = readFileSync(path, "utf8");
  for (const [re, label] of FORBIDDEN_RUNTIME) {
    if (re.test(src)) failures.push(`Batch 11 sanity: ${path} introduced forbidden token "${label}"`);
  }
}

// 5. Batch 7C production guard intact
const SMOKE = "supabase/functions/admin-export-batch-7c-smoke/index.ts";
if (!existsSync(SMOKE)) {
  failures.push(`Batch 7C smoke runner missing at ${SMOKE} — Batch 11 must not remove it`);
} else {
  const src = readFileSync(SMOKE, "utf8");
  if (!/is_production_environment|production_refused/i.test(src)) {
    failures.push("Batch 7C smoke runner no longer references the production refusal path");
  }
}

// 6. Scope tightness: no unexpected sibling evidence files at the
//    Batch 11 prefix outside the canonical folder.
const EVIDENCE_DIR = "evidence";
if (existsSync(EVIDENCE_DIR)) {
  for (const entry of readdirSync(EVIDENCE_DIR)) {
    if (!/admin-export-controls-batch-11/.test(entry)) continue;
    if (entry === "admin-export-controls-batch-11-qa-dry-run") continue;
    const full = join(EVIDENCE_DIR, entry);
    if (statSync(full).isFile()) {
      failures.push(`Batch 11 scope drift: unexpected sibling artifact ${full}`);
    }
  }
}

if (failures.length > 0) {
  console.error("[check-admin-export-controls-batch-11] FAIL — QA dry-run evidence contract drift:");
  for (const f of failures) console.error(`  - ${f}`);
  console.error(
    "\nBatch 11 is evidence-only. It must not instruct testers to download/" +
      "generate/prepare/destroy, must not claim screenshots that are not on " +
      "disk, must not weaken the Batch 7C production guard, and must not " +
      "introduce file generation surfaces.",
  );
  process.exit(1);
}

console.log("[check-admin-export-controls-batch-11] OK — QA dry-run evidence contract holds.");
