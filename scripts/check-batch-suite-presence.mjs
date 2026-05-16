#!/usr/bin/env node
/**
 * Batch W prebuild guard. Reads the batch completion table in
 * docs/closeout-report.md and asserts every claimed batch row (A–W)
 * has at least one matching src/tests/batch-<letter>-*.test.ts(x) file.
 *
 * Catches reports that claim work without proof.
 */
import { readFileSync, readdirSync } from "node:fs";

const REPORT = "docs/closeout-report.md";
let body;
try {
  body = readFileSync(REPORT, "utf8");
} catch {
  console.error(`❌ ${REPORT} missing — required by Batch W.`);
  process.exit(1);
}

// Match table rows like: | A | ... |
const rows = [...body.matchAll(/^\|\s*([A-Z])\s*\|/gm)].map((m) => m[1]);
if (rows.length === 0) {
  console.error(`❌ ${REPORT} has no batch table rows.`);
  process.exit(1);
}

const tests = readdirSync("src/tests").filter((f) =>
  /^batch-[a-w][-.]/i.test(f),
);

const missing = [];
for (const letter of rows) {
  const needle = `batch-${letter.toLowerCase()}-`;
  const found = tests.some((t) => t.toLowerCase().startsWith(needle));
  if (!found) missing.push(letter);
}

if (missing.length > 0) {
  console.error(
    "\n❌ Batch W closeout proof check FAILED. Batches with no matching test file:",
  );
  for (const l of missing) console.error(`  - Batch ${l}`);
  console.error(
    `\nEither add a src/tests/batch-${missing[0].toLowerCase()}-*.test.ts pin, or remove the row from ${REPORT}.\n`,
  );
  process.exit(1);
}

console.log(
  `✓ Batch W closeout proof: all ${rows.length} batch row(s) have a test pin.`,
);
