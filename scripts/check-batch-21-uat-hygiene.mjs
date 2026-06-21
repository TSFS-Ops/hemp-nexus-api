#!/usr/bin/env node
/**
 * Batch 21 — UAT Test Hygiene guard.
 *
 * Fails the build if:
 *   1. The quarantine ledger (src/tests/quarantine.json) is missing or
 *      malformed.
 *   2. Any quarantined file lacks a classification, reason, or
 *      `replaced_by_guards` array.
 *   3. The default vitest config still includes quarantined tests or
 *      src/tests/uat/** in the local run.
 *   4. A UAT journey file under src/tests/uat/journey-*.test.ts does NOT
 *      gate its describe() with `describe.skipIf(!UAT_PROVISIONING_ENABLED)`.
 *   5. The client-facing UAT evidence report contains an unexplained
 *      raw "X failed" count.
 *   6. `production_ready` appears as the default release-gate status in
 *      the client-facing UAT report.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const errors = [];
const fail = (m) => errors.push(m);

// 1 + 2: ledger present and well-formed
const ledgerPath = "src/tests/quarantine.json";
if (!existsSync(ledgerPath)) fail(`Missing quarantine ledger: ${ledgerPath}`);
let ledger;
try {
  ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));
} catch (e) {
  fail(`Cannot parse ${ledgerPath}: ${e.message}`);
}
const ALLOWED_CLASS = new Set([
  "stale_source_pin_replaced_by_prebuild_guard",
  "post_refactor_route_layout_update_required",
  "ci_only_requires_provisioning_secret",
  "true_regression",
  "duplicate_legacy_test",
  "obsolete_batch_test",
  "needs_manual_review",
]);
if (ledger?.files) {
  for (const f of ledger.files) {
    if (!f.path || !f.classification || !f.reason || !Array.isArray(f.replaced_by_guards)) {
      fail(`Ledger entry missing required fields: ${JSON.stringify(f)}`);
    }
    if (f.classification && !ALLOWED_CLASS.has(f.classification)) {
      fail(`Invalid classification on ${f.path}: ${f.classification}`);
    }
    if (f.classification === "true_regression") {
      fail(`Unresolved true_regression in ledger: ${f.path}`);
    }
    if (f.classification === "needs_manual_review" && !f.non_blocking_reason) {
      fail(`needs_manual_review without non_blocking_reason: ${f.path}`);
    }
    if (f.path && !existsSync(f.path)) {
      fail(`Ledger references missing file: ${f.path}`);
    }
  }
}

// 3: default vitest config excludes UAT + quarantine
const cfg = readFileSync("vitest.config.ts", "utf8");
if (!/UAT_CI_ONLY/.test(cfg) || !/quarantine\.json/.test(cfg)) {
  fail("vitest.config.ts must exclude src/tests/uat/** AND import the quarantine ledger.");
}
if (!/"src\/tests\/uat\/\*\*"/.test(cfg)) {
  fail("vitest.config.ts must list 'src/tests/uat/**' in UAT_CI_ONLY.");
}

// 4: every UAT journey file has the skipIf gate
const uatDir = "src/tests/uat";
if (existsSync(uatDir)) {
  for (const f of readdirSync(uatDir)) {
    if (!/^journey-.*\.test\.ts$/.test(f)) continue;
    const src = readFileSync(join(uatDir, f), "utf8");
    if (!/describe\.skipIf\(!UAT_PROVISIONING_ENABLED\)/.test(src)) {
      fail(`${uatDir}/${f}: missing describe.skipIf(!UAT_PROVISIONING_ENABLED) gate.`);
    }
    if (!/from "\.\/_ci-gate"/.test(src)) {
      fail(`${uatDir}/${f}: must import UAT_PROVISIONING_ENABLED from ./_ci-gate.`);
    }
  }
}

// 5 + 6: client-facing UAT report hygiene
const reportPath = "docs/registry/uat-execution-summary.md";
if (!existsSync(reportPath)) {
  fail(`Missing client-facing UAT report: ${reportPath}`);
} else {
  const r = readFileSync(reportPath, "utf8");
  // Allow the word "failed" only in an explicit, contextualised paragraph
  // mentioning "Legacy/internal test maintenance" or a section heading
  // describing how the count was separated.
  const rawFailMatches = r.match(/\b\d+\s+failed\b/gi) || [];
  for (const m of rawFailMatches) {
    // Acceptable if appearing in the technical-appendix link line. Be strict:
    // the client-facing summary should not lead with a raw count.
    fail(`Client-facing UAT report contains a raw failed-test count: "${m}". Move to the technical appendix.`);
  }
  if (/\bproduction[\-_ ]?ready\b/i.test(r) && !/not\s+production[\-_ ]?ready/i.test(r)) {
    fail(`Client-facing UAT report mentions 'production-ready' without 'not production-ready' qualifier.`);
  }
}

// 7: package scripts present
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
for (const s of ["test:uat:local", "test:uat:ci", "test:legacy"]) {
  if (!pkg.scripts[s]) fail(`package.json missing script: ${s}`);
}

if (errors.length) {
  console.error("check-batch-21-uat-hygiene: FAIL");
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}
console.log("check-batch-21-uat-hygiene: OK");
