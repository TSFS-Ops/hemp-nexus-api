#!/usr/bin/env node
/**
 * Batch 20 — Pre-UAT Embarrassment Audit guard.
 *
 * Rejects TODO/FIXME/XXX/HACK/`console.log`/`DEBUG:`/`PLACEHOLDER` strings
 * inside user-visible registry UI (public, company portal, and admin
 * registry surfaces). Comments inside these files would still ship to the
 * client during UAT so we treat any of these tokens as a UAT blocker.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = [
  "src/pages/registry",
  "src/pages/admin/registry",
  "src/components/registry",
];

const FORBIDDEN = [
  /\bTODO\b/,
  /\bFIXME\b/,
  /\bXXX\b/,
  /\bHACK\b/,
  /\bPLACEHOLDER\b/,
  /\bDEBUG:/,
  /console\.log\(/,
];

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    const f = join(dir, e);
    const s = statSync(f);
    if (s.isDirectory()) walk(f, out);
    else if (/\.(tsx?|jsx?)$/.test(e) && !/\.test\.[tj]sx?$/.test(e)) out.push(f);
  }
  return out;
}

const failures = [];
for (const root of ROOTS) {
  for (const file of walk(root)) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      for (const re of FORBIDDEN) {
        if (re.test(line)) failures.push(`${file}:${i + 1}  ${line.trim().slice(0, 120)}`);
      }
    });
  }
}

if (failures.length) {
  console.error("❌ batch-20 no-debug-in-registry-ui — forbidden tokens found:");
  for (const f of failures) console.error("  " + f);
  process.exit(1);
}
console.log("✓ batch-20 no-debug-in-registry-ui guard ok");
