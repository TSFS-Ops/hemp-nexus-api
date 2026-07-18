#!/usr/bin/env node
// scripts/ci/compare-vitest-baseline.mjs
//
// Compares Vitest JSON-reporter output between the PR head and the
// base/main branch, run under identical conditions in this workflow.
// Fails closed: exits 1 if any test passes on base but fails on head
// (a PR-introduced regression), or if the comparison itself cannot be
// completed (missing/unreadable/empty reports).
//
// Usage:
//   node scripts/ci/compare-vitest-baseline.mjs <head-json> <base-json> <summary-out-md>

import { readFileSync, writeFileSync } from 'node:fs';

function fail(msg) {
  console.error(`COMPARISON_FAIL: ${msg}`);
  process.exit(1);
}

const [, , headPath, basePath, outPath] = process.argv;

if (!headPath || !basePath || !outPath) {
  fail('missing required arguments <head-json> <base-json> <summary-out-md>');
}

let headRaw, baseRaw;
try {
  headRaw = readFileSync(headPath, 'utf8');
} catch (e) {
  fail(`could not read head report at ${headPath}: ${e.message}`);
}
try {
  baseRaw = readFileSync(basePath, 'utf8');
} catch (e) {
  fail(`could not read base report at ${basePath}: ${e.message}`);
}

let headJson, baseJson;
try {
  headJson = JSON.parse(headRaw);
} catch (e) {
  fail(`head report is not valid JSON: ${e.message}`);
}
try {
  baseJson = JSON.parse(baseRaw);
} catch (e) {
  fail(`base report is not valid JSON: ${e.message}`);
}

// Vitest's built-in 'json' reporter emits a Jest-compatible shape:
// { testResults: [ { name: <file path>, assertionResults: [ { fullName, status } ] } ] }
function collectFailures(report, label) {
  if (!report || !Array.isArray(report.testResults)) {
    fail(`${label} report missing testResults array - comparison cannot be completed`);
  }
  const failed = new Set();
  const allIds = new Set();
  for (const fileResult of report.testResults) {
    const filePath = fileResult.name || fileResult.testFilePath || '(unknown-file)';
    const assertions = fileResult.assertionResults || [];
    for (const a of assertions) {
      const id = `${filePath} > ${a.fullName || a.title || '(unnamed test)'}`;
      allIds.add(id);
      if (a.status === 'failed') {
        failed.add(id);
      }
    }
  }
  return { failed, allIds };
}

const headData = collectFailures(headJson, 'head');
const baseData = collectFailures(baseJson, 'base');

if (headData.allIds.size === 0) {
  fail('head report contains zero collected tests - comparison cannot be completed');
}
if (baseData.allIds.size === 0) {
  fail('base report contains zero collected tests - comparison cannot be completed');
}

const introduced = [...headData.failed].filter((id) => !baseData.failed.has(id)).sort();
const sharedBaseline = [...headData.failed].filter((id) => baseData.failed.has(id)).sort();
const mainOnly = [...baseData.failed].filter((id) => !headData.failed.has(id)).sort();

const lines2 = [];
lines2.push('# Full-suite baseline comparison (PR head vs base/main)');
lines2.push('');
lines2.push(`Head failed total: ${headData.failed.size}`);
lines2.push(`Base failed total: ${baseData.failed.size}`);
lines2.push(`PR-introduced regressions: ${introduced.length}`);
lines2.push(`Shared baseline failures: ${sharedBaseline.length}`);
lines2.push(`Main-only failures (present on base, not reproduced on head): ${mainOnly.length}`);
lines2.push('');
if (introduced.length > 0) {
  lines2.push('## PR-introduced regressions (fail the gate)');
  for (const id of introduced) lines2.push(`- ${id}`);
  lines2.push('');
}
lines2.push('## Shared baseline failures (pre-existing on main, not caused by this PR)');
for (const id of sharedBaseline) lines2.push(`- ${id}`);
lines2.push('');
lines2.push('## Main-only failures (present on base, not reproduced on PR head)');
for (const id of mainOnly) lines2.push(`- ${id}`);
lines2.push('');

writeFileSync(outPath, lines2.join('\n'), 'utf8');

console.log(`HEAD_FAILED_TOTAL=${headData.failed.size}`);
console.log(`BASE_FAILED_TOTAL=${baseData.failed.size}`);
console.log(`PR_INTRODUCED_REGRESSIONS=${introduced.length}`);
console.log(`SHARED_BASELINE_FAILURES=${sharedBaseline.length}`);
console.log(`MAIN_ONLY_FAILURES=${mainOnly.length}`);

if (introduced.length > 0) {
  console.error('COMPARISON_FAIL: PR introduces new test regressions relative to base');
  process.exit(1);
}

console.log('COMPARISON_OK: no PR-introduced regressions relative to base');
process.exit(0);
