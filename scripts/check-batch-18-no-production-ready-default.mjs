#!/usr/bin/env node
/**
 * Batch 18 — Ensures the SSOT default final release status is NOT
 * `production_ready`, and that the SSOT actually exports the named
 * constant. Pins the contract behind the release-gate viewer.
 */
import { readFileSync } from "node:fs";

const SSOT = "src/lib/registry-release-gate-ssot.ts";
const src = readFileSync(SSOT, "utf8");

const m = src.match(/DEFAULT_FINAL_RELEASE_STATUS:\s*ReleaseStatus\s*=\s*"([a-z_]+)"/);
if (!m) {
  console.error(`✗ ${SSOT}: cannot find DEFAULT_FINAL_RELEASE_STATUS export.`);
  process.exit(1);
}
if (m[1] === "production_ready") {
  console.error(`✗ ${SSOT}: DEFAULT_FINAL_RELEASE_STATUS must not be 'production_ready'.`);
  process.exit(1);
}
console.log(`✓ batch-18 default final release status = '${m[1]}' (not production_ready)`);
