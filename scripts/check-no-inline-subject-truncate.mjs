#!/usr/bin/env node
/**
 * SSOT guard for the email-subject 200-char contract.
 *
 * Background:
 *   `_shared/email-subject.ts` is the single source of truth for clamping
 *   outbound email/Slack subject lines to 200 characters while preserving
 *   trace tails. If new code does its own inline truncation
 *   (`subject.slice(0, 200)`, `subject.substring(0, 200)`, manual ellipsis,
 *   etc.) it silently bypasses the contract — which is exactly the bug
 *   class that produced the original VALIDATION_ERROR for over-long
 *   outreach subjects.
 *
 * What this script enforces:
 *   - No edge function file (other than `_shared/email-subject.ts` itself)
 *     may contain inline subject truncation patterns.
 *   - Any new caller must `import { clampSubject } from "../_shared/email-subject.ts"`.
 *
 * Failure exit code is 1 so this can run in `prebuild` and fail CI.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FUNCTIONS_DIR = path.join(ROOT, "supabase", "functions");
const SSOT_FILE = path.join(FUNCTIONS_DIR, "_shared", "email-subject.ts");

// Regex patterns that indicate inline subject truncation.
// We deliberately scope to identifiers literally containing "subject"
// so we don't flag unrelated string-slicing.
const FORBIDDEN_PATTERNS = [
  // foo.subject.slice(0, 200) | subject.slice(0, 199) etc.
  /\bsubject\b[^\n;]{0,80}\.slice\s*\(\s*0\s*,\s*\d{2,4}\s*\)/i,
  // foo.subject.substring(0, 200)
  /\bsubject\b[^\n;]{0,80}\.substring\s*\(\s*0\s*,\s*\d{2,4}\s*\)/i,
  // const SUBJECT_MAX = 200; declared outside the SSOT
  /const\s+SUBJECT_MAX\s*=\s*\d+/,
  // raw `subject = ... slice(0, 200)` re-implementation
  /subject\s*=\s*[^\n;]{0,120}slice\s*\(\s*0\s*,\s*\d{2,4}\s*\)/i,
];

const ALLOWED_FILES = new Set([
  path.relative(ROOT, SSOT_FILE),
  // The guard script itself contains the patterns as data — never as code.
  path.relative(ROOT, __filename),
]);

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip vendored deps if any
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      files.push(...(await walk(full)));
    } else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
      files.push(full);
    }
  }
  return files;
}

async function main() {
  let files;
  try {
    files = await walk(FUNCTIONS_DIR);
  } catch (err) {
    if (err.code === "ENOENT") {
      console.log("[check-no-inline-subject-truncate] supabase/functions not found — skipping.");
      return;
    }
    throw err;
  }

  const violations = [];
  for (const file of files) {
    const rel = path.relative(ROOT, file);
    if (ALLOWED_FILES.has(rel)) continue;

    const text = await fs.readFile(file, "utf8");
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Skip comments — humans referring to the rule in prose are fine.
      const trimmed = line.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;

      for (const pattern of FORBIDDEN_PATTERNS) {
        if (pattern.test(line)) {
          violations.push({ file: rel, line: i + 1, snippet: trimmed, pattern: pattern.source });
          break;
        }
      }
    }
  }

  if (violations.length === 0) {
    console.log(
      `[check-no-inline-subject-truncate] OK — ${files.length} edge function files scanned, no inline subject truncation found.`
    );
    return;
  }

  console.error("\n[check-no-inline-subject-truncate] DRIFT DETECTED");
  console.error(
    "Inline subject truncation bypasses the 200-char SSOT contract in _shared/email-subject.ts."
  );
  console.error(
    'Replace with: import { clampSubject } from "../_shared/email-subject.ts"; const subject = clampSubject(rawSubject, optionalTail);\n'
  );
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}`);
    console.error(`    ${v.snippet}`);
  }
  console.error(`\n${violations.length} violation(s). Failing build.\n`);
  process.exit(1);
}

main().catch((err) => {
  console.error("[check-no-inline-subject-truncate] Unexpected error:", err);
  process.exit(1);
});
