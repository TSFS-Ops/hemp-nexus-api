#!/usr/bin/env node
/**
 * Batch W prebuild guard. Ensures the human-readable release
 * documentation does not drift from enforced automation.
 *
 * Asserts:
 *  1. Every check-*.mjs script referenced in package.json `prebuild`
 *     is mentioned in RELEASE_GATE.md OR docs/launch-runbook.md.
 *  2. Every critical scheduled cron job is mentioned in
 *     docs/launch-runbook.md.
 *  3. test:regression is referenced from RELEASE_GATE.md.
 */
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const prebuild = pkg.scripts?.prebuild ?? "";
const releaseGate = readFileSync("RELEASE_GATE.md", "utf8");
let runbook = "";
try {
  runbook = readFileSync("docs/launch-runbook.md", "utf8");
} catch {
  console.error("❌ docs/launch-runbook.md is missing — required by Batch W.");
  process.exit(1);
}
const human = releaseGate + "\n" + runbook;

const scripts = [
  ...prebuild.matchAll(/scripts\/(check-[a-z0-9._-]+\.mjs)/gi),
].map((m) => m[1]);

const missingScripts = scripts.filter((s) => !human.includes(s));

const CRITICAL_JOBS = [
  "burn-poi-reconciliation",
  "balance-drift-reconciliation",
  "side-effect-reconciliation",
  "transaction-reconciliation",
  "cron-heartbeat-reconcile",
  "sentry-heartbeat",
  "email-log-anonymise",
];
const missingJobs = CRITICAL_JOBS.filter((j) => !runbook.includes(j));

const failures = [];
if (missingScripts.length) {
  failures.push(
    "Prebuild scripts not mentioned in RELEASE_GATE.md or launch-runbook.md:\n  - " +
      missingScripts.join("\n  - "),
  );
}
if (missingJobs.length) {
  failures.push(
    "Critical cron jobs not mentioned in docs/launch-runbook.md:\n  - " +
      missingJobs.join("\n  - "),
  );
}
if (!/test:regression/.test(releaseGate)) {
  failures.push("RELEASE_GATE.md does not reference `test:regression`.");
}

if (failures.length) {
  console.error("\n❌ Batch W release-gate sync check FAILED:\n");
  for (const f of failures) console.error(f + "\n");
  process.exit(1);
}

console.log(
  `✓ Batch W release-gate sync: ${scripts.length} script(s) and ${CRITICAL_JOBS.length} cron job(s) documented.`,
);
