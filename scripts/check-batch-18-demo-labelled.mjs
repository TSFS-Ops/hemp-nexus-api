#!/usr/bin/env node
/**
 * Batch 18 — Ensures every demo record in the SSOT carries
 * `isDemo: true` and is labelled with the `(UAT)` suffix so demo records
 * cannot be mistaken for production data.
 */
import { readFileSync } from "node:fs";

const SSOT = "src/lib/registry-release-gate-ssot.ts";
const src = readFileSync(SSOT, "utf8");

// Extract DEMO_RECORDS block
const block = src.match(/DEMO_RECORDS:\s*DemoRecord\[\]\s*=\s*\[([\s\S]*?)\];/);
if (!block) {
  console.error(`✗ ${SSOT}: cannot find DEMO_RECORDS export.`);
  process.exit(1);
}
const body = block[1];
const rows = body.split(/\},\s*\{/);
let failed = false;
for (const r of rows) {
  if (!/isDemo:\s*true/.test(r)) {
    console.error(`✗ DEMO_RECORDS row missing isDemo: true → ${r.slice(0, 80)}...`);
    failed = true;
  }
  if (!/\(UAT\)/.test(r)) {
    console.error(`✗ DEMO_RECORDS row missing (UAT) label → ${r.slice(0, 80)}...`);
    failed = true;
  }
}
if (failed) process.exit(1);
console.log(`✓ batch-18 demo-labelled check passed (${rows.length} records)`);
