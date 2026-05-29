#!/usr/bin/env node
/**
 * check-smoke-evidence-bundle — structural + content gate for the Smoke A–D
 * evidence bundle. Run BEFORE handing the zip to the approver.
 *
 * Verifies:
 *   1. Top-level files present: evidence/index.html, playwright-report/index.html.
 *   2. Exactly one row directory present per A/B/C/D (matched by `smoke-<letter>-` prefix).
 *   3. Each row has summary.json, requests.jsonl, and ≥1 screenshot (*.png).
 *   4. summary.json: status === "passed", expected === "passed", error === null,
 *      requestIds is a non-empty array of strings.
 *
 * Usage:
 *   node scripts/check-smoke-evidence-bundle.mjs              # default ./evidence + ./playwright-report
 *   node scripts/check-smoke-evidence-bundle.mjs --dir <evidence_dir>
 *
 * Exit codes:
 *   0  bundle is green and complete
 *   1  one or more failures (printed to stderr)
 *   2  no evidence directory found
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(process.cwd());
const args = process.argv.slice(2);
const dirFlagIdx = args.indexOf("--dir");
const EVIDENCE_DIR = dirFlagIdx >= 0 ? resolve(args[dirFlagIdx + 1]) : join(ROOT, "evidence");
const REPORT_DIR = join(ROOT, "playwright-report");

const REQUIRED_ROWS = ["a", "b", "c", "d"];

const failures = [];
const fail = (msg) => failures.push(msg);

if (!existsSync(EVIDENCE_DIR)) {
  console.error(`No evidence directory at ${EVIDENCE_DIR}. Run the smoke suite first.`);
  process.exit(2);
}

// 1. Top-level required files.
if (!existsSync(join(EVIDENCE_DIR, "index.html"))) {
  fail(`Missing evidence/index.html (pack-evidence did not run, or it failed before writing the index).`);
}
if (!existsSync(join(REPORT_DIR, "index.html"))) {
  fail(`Missing playwright-report/index.html (HTML reporter did not produce a report).`);
}

// 2 & 3 & 4. Walk row directories.
const entries = await readdir(EVIDENCE_DIR);
const rowDirs = [];
for (const name of entries) {
  const p = join(EVIDENCE_DIR, name);
  // eslint-disable-next-line no-await-in-loop
  if ((await stat(p)).isDirectory()) rowDirs.push(name);
}

const byLetter = new Map();
for (const name of rowDirs) {
  const m = /^smoke-([a-d])-/i.exec(name);
  if (!m) {
    fail(`Unexpected evidence subdirectory: ${name} (does not match smoke-<a|b|c|d>-…).`);
    continue;
  }
  const letter = m[1].toLowerCase();
  if (byLetter.has(letter)) {
    fail(`Multiple row directories for smoke-${letter.toUpperCase()}: ${byLetter.get(letter)} and ${name}.`);
  } else {
    byLetter.set(letter, name);
  }
}
for (const letter of REQUIRED_ROWS) {
  if (!byLetter.has(letter)) fail(`Missing row directory for smoke-${letter.toUpperCase()}.`);
}

for (const letter of REQUIRED_ROWS) {
  const dir = byLetter.get(letter);
  if (!dir) continue;
  const rowPath = join(EVIDENCE_DIR, dir);
  const tag = `smoke-${letter.toUpperCase()}`;

  const summaryPath = join(rowPath, "summary.json");
  const requestsPath = join(rowPath, "requests.jsonl");

  if (!existsSync(summaryPath)) { fail(`${tag}: missing summary.json`); continue; }
  if (!existsSync(requestsPath)) fail(`${tag}: missing requests.jsonl`);

  // eslint-disable-next-line no-await-in-loop
  const screenshots = (await readdir(rowPath)).filter((f) => f.toLowerCase().endsWith(".png"));
  if (screenshots.length === 0) fail(`${tag}: no screenshot (*.png) artefacts captured`);

  let summary;
  try {
    // eslint-disable-next-line no-await-in-loop
    summary = JSON.parse(await readFile(summaryPath, "utf8"));
  } catch (e) {
    fail(`${tag}: summary.json is not valid JSON — ${e.message}`);
    continue;
  }

  if (summary.status !== "passed") {
    fail(`${tag}: status="${summary.status}" (expected "passed").${summary.error?.message ? ` error: ${summary.error.message}` : ""}`);
  }
  if (summary.expected && summary.expected !== "passed") {
    fail(`${tag}: expected="${summary.expected}" (test marked as not expected to pass).`);
  }
  if (summary.error != null) {
    fail(`${tag}: error field is non-null — ${summary.error?.message ?? JSON.stringify(summary.error)}`);
  }
  if (!Array.isArray(summary.requestIds) || summary.requestIds.length === 0) {
    fail(`${tag}: requestIds is missing or empty (cannot trace evidence back to edge function logs).`);
  } else {
    const bad = summary.requestIds.filter((x) => typeof x !== "string" || x.length === 0);
    if (bad.length) fail(`${tag}: ${bad.length} requestId entries are not non-empty strings.`);
  }
}

if (failures.length) {
  console.error(`\nSmoke evidence bundle FAILED ${failures.length} check(s):\n`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  console.error(`\nDo not hand this bundle to the approver. Re-run the suite or repack and re-validate.`);
  process.exit(1);
}

console.log(`Smoke evidence bundle OK — rows A/B/C/D all green with request IDs, index + playwright-report present.`);
