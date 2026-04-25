#!/usr/bin/env node
/**
 * Test runner summary that separates pre-existing UAT credential failures
 * from new failures so cleanup PRs are easier to trust.
 *
 * Usage:
 *   node scripts/test-summary.mjs                 # run all tests, summarise
 *   node scripts/test-summary.mjs --json out.json # also write structured JSON
 *   node scripts/test-summary.mjs --strict        # exit 1 only on NEW failures
 *
 * How it classifies a failure as "pre-existing UAT credential":
 *   - The test file lives under src/tests/uat/
 *   - AND the failure message matches one of the known credential / live-backend
 *     signatures (missing env vars, sign-up rejected, edge function 401/404,
 *     "Failed to confirm test user", etc.).
 *
 * Anything else is treated as a NEW failure and surfaced loudly.
 *
 * The script shells out to `bunx vitest run --reporter=json` so it works in the
 * sandbox without extra deps. Stdout from vitest is parsed; stderr is preserved.
 */

import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { argv, exit, stdout, stderr } from "node:process";

const args = argv.slice(2);
const jsonOutIdx = args.indexOf("--json");
const jsonOut = jsonOutIdx >= 0 ? args[jsonOutIdx + 1] : null;
const strict = args.includes("--strict");

// ── Known pre-existing UAT failure signatures ─────────────────────────────
// These are failures we already know stem from missing live-backend
// credentials or environment, NOT from code changes in a cleanup PR.
const UAT_CRED_PATTERNS = [
  /VITE_SUPABASE_URL/i,
  /VITE_SUPABASE_PUBLISHABLE_KEY/i,
  /Failed to confirm test user/i,
  /confirm-test-user/i,
  /Signup returned no user/i,
  /Sign-in returned no session/i,
  /Email signups are disabled/i,
  /Invalid login credentials/i,
  /User already registered/i,
  /Edge Function returned a non-2xx status code/i,
  /fetch failed/i,
  /ECONNREFUSED/i,
  /ENOTFOUND/i,
  /Network request failed/i,
  /401\b.*(api-keys|match|confirm-test-user)/i,
  /404\b.*functions\/v1/i,
];

const UAT_PATH_PREFIX = "src/tests/uat/";

function isUatFile(file) {
  return typeof file === "string" && file.includes(UAT_PATH_PREFIX);
}

function isCredentialFailure(message) {
  if (!message) return false;
  return UAT_CRED_PATTERNS.some((re) => re.test(message));
}

// ── Run vitest ────────────────────────────────────────────────────────────
function runVitest() {
  return new Promise((resolve) => {
    const child = spawn(
      "bunx",
      ["--bun", "vitest", "run", "--reporter=json", "--reporter=default"],
      { stdio: ["ignore", "pipe", "pipe"] },
    );

    let out = "";
    let err = "";
    child.stdout.on("data", (d) => { out += d.toString(); });
    child.stderr.on("data", (d) => { err += d.toString(); });
    child.on("close", (code) => resolve({ code: code ?? 1, out, err }));
  });
}

function extractJsonBlob(stdoutText) {
  // Vitest with multiple reporters interleaves output. Find the JSON object
  // that contains "testResults". Scan from the first '{' to the last '}'.
  const start = stdoutText.indexOf('{"numTotalTestSuites"');
  if (start === -1) {
    // Fallback: try generic
    const gStart = stdoutText.indexOf("{");
    const gEnd = stdoutText.lastIndexOf("}");
    if (gStart === -1 || gEnd === -1) return null;
    try {
      return JSON.parse(stdoutText.slice(gStart, gEnd + 1));
    } catch {
      return null;
    }
  }
  // Walk braces to find matching close
  let depth = 0;
  for (let i = start; i < stdoutText.length; i++) {
    const ch = stdoutText[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(stdoutText.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

// ── Main ──────────────────────────────────────────────────────────────────
const { code, out, err } = await runVitest();
const blob = extractJsonBlob(out);

if (!blob) {
  stderr.write("[test-summary] Could not parse vitest JSON output.\n");
  stderr.write(err);
  exit(code || 1);
}

const preExistingUat = [];
const newFailures = [];
let totalTests = 0;
let passed = 0;
let skipped = 0;

for (const suite of blob.testResults ?? []) {
  const file = suite.name || suite.testFilePath || "";
  for (const t of suite.assertionResults ?? []) {
    totalTests++;
    if (t.status === "passed") { passed++; continue; }
    if (t.status === "skipped" || t.status === "pending" || t.status === "todo") { skipped++; continue; }
    if (t.status !== "failed") continue;

    const message = (t.failureMessages ?? []).join("\n");
    const entry = {
      file,
      title: t.fullName || t.title,
      message: message.slice(0, 800),
    };
    if (isUatFile(file) && isCredentialFailure(message)) {
      preExistingUat.push(entry);
    } else {
      newFailures.push(entry);
    }
  }
}

const summary = {
  totalTests,
  passed,
  skipped,
  failed: preExistingUat.length + newFailures.length,
  preExistingUatFailures: preExistingUat.length,
  newFailures: newFailures.length,
  vitestExitCode: code,
};

// ── Render ────────────────────────────────────────────────────────────────
const line = "─".repeat(64);
stdout.write(`\n${line}\n`);
stdout.write(`  TEST RUNNER SUMMARY\n`);
stdout.write(`${line}\n`);
stdout.write(`  Total      : ${summary.totalTests}\n`);
stdout.write(`  Passed     : ${summary.passed}\n`);
stdout.write(`  Skipped    : ${summary.skipped}\n`);
stdout.write(`  Failed     : ${summary.failed}\n`);
stdout.write(`    ↳ pre-existing UAT credential : ${summary.preExistingUatFailures}\n`);
stdout.write(`    ↳ NEW failures                : ${summary.newFailures}\n`);
stdout.write(`${line}\n\n`);

if (preExistingUat.length > 0) {
  stdout.write(`Pre-existing UAT credential failures (safe to ignore for cleanup PRs):\n`);
  for (const f of preExistingUat) {
    stdout.write(`  • ${f.file}\n      ${f.title}\n`);
  }
  stdout.write(`\n`);
}

if (newFailures.length > 0) {
  stdout.write(`❌ NEW failures (must be investigated before merge):\n`);
  for (const f of newFailures) {
    stdout.write(`  • ${f.file}\n      ${f.title}\n`);
    const firstLine = f.message.split("\n").find((l) => l.trim()) ?? "";
    if (firstLine) stdout.write(`      ↳ ${firstLine.trim()}\n`);
  }
  stdout.write(`\n`);
} else {
  stdout.write(`✅ No new failures introduced.\n\n`);
}

if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify({ summary, preExistingUat, newFailures }, null, 2));
  stdout.write(`Wrote structured report to ${jsonOut}\n`);
}

// ── Exit code ─────────────────────────────────────────────────────────────
// Default: mirror vitest's exit code (any failure is non-zero).
// --strict: exit 0 if only pre-existing UAT failures remain; non-zero on NEW.
if (strict) {
  exit(newFailures.length > 0 ? 1 : 0);
}
exit(code);
