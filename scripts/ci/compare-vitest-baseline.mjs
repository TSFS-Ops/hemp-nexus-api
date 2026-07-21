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
  fail('missing required arguments (head-json base-json summary-out-md)');
}

function loadReport(path, label) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (e) {
    fail(`could not read ${label} report at ${path}: ${e.message}`);
  }
  let json;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    fail(`could not parse ${label} report at ${path} as JSON: ${e.message}`);
  }
  if (!json || !Array.isArray(json.testResults)) {
    fail(`${label} report at ${path} has no testResults array`);
  }
  return json;
}

// Vitest's JSON reporter emits absolute file paths. The PR-head suite runs
// from the repo root while the base/main suite runs from a nested
// `base-checkout/` checkout, so raw absolute paths never match even for
// identical test files. Normalize to a repo-relative path (anchored at the
// last `/src/` segment) so identifiers are comparable across checkouts.
function normalizePath(p) {
  if (!p) return p;
  const unified = p.replace(/\\/g, '/');
  const idx = unified.lastIndexOf('/src/');
  if (idx !== -1) return unified.slice(idx + 1);
  return unified;
}

function collectFailures(report, label) {
  const failed = new Set();
  const allIds = new Set();
  let count = 0;
  for (const fileResult of report.testResults) {
    const filePath = normalizePath(fileResult.name || fileResult.testFilePath || '(unknown file)');
    const assertions = Array.isArray(fileResult.assertionResults) ? fileResult.assertionResults : [];
    for (const a of assertions) {
      const testName = a.fullName || a.title || '(unnamed test)';
      const id = `${filePath} > ${testName}`;
      allIds.add(id);
      count += 1;
      if (a.status === 'failed') {
        failed.add(id);
      }
    }
  }
  if (count === 0) {
    fail(`${label} report collected zero tests; cannot compare`);
  }
  return { failed, allIds };
}

const headReport = loadReport(headPath, 'PR head');
const baseReport = loadReport(basePath, 'base/main');

const head = collectFailures(headReport, 'PR head');
const base = collectFailures(baseReport, 'base/main');

const introduced = [...head.failed].filter((id) => !base.failed.has(id)).sort();
const sharedBaseline = [...head.failed].filter((id) => base.failed.has(id)).sort();
const mainOnly = [...base.failed].filter((id) => !head.failed.has(id)).sort();

const lines2 = [];
lines2.push('# Full Vitest suite - PR head vs base/main comparison');
lines2.push('');
lines2.push(`Full-suite failures on PR head: ${head.failed.size}`);
lines2.push(`Full-suite failures on base/main: ${base.failed.size}`);
lines2.push(`PR-introduced regressions: ${introduced.length}`);
lines2.push(`Shared baseline failures (pre-existing on main): ${sharedBaseline.length}`);
lines2.push(`Main-only failures: ${mainOnly.length}`);
lines2.push('');
lines2.push('## PR-introduced regressions (fail on head, pass or absent on base)');
lines2.push(introduced.length ? introduced.map((s) => `- ${s}`).join('\n') : '(none)');
lines2.push('');
lines2.push('## Shared baseline failures (fail on both head and base)');
lines2.push(sharedBaseline.length ? sharedBaseline.map((s) => `- ${s}`).join('\n') : '(none)');
lines2.push('');
lines2.push('## Main-only failures (fail on base, pass or absent on head)');
lines2.push(mainOnly.length ? mainOnly.map((s) => `- ${s}`).join('\n') : '(none)');
lines2.push('');

writeFileSync(outPath, lines2.join('\n'));

console.log(`HEAD_FAILED_TOTAL=${head.failed.size}`);
console.log(`BASE_FAILED_TOTAL=${base.failed.size}`);
console.log(`PR_INTRODUCED_REGRESSIONS=${introduced.length}`);
console.log(`SHARED_BASELINE_FAILURES=${sharedBaseline.length}`);
console.log(`MAIN_ONLY_FAILURES=${mainOnly.length}`);

if (introduced.length > 0) {
  console.error('COMPARISON_FAIL: PR introduces new test regressions relative to base');
  process.exit(1);
}

console.log('COMPARISON_OK: no PR-introduced regressions relative to base');
process.exit(0);
