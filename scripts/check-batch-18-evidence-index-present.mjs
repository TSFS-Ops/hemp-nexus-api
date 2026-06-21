#!/usr/bin/env node
/**
 * Batch 18 — Ensures the central evidence index exists and lists every
 * registry batch from 1 through 18.
 */
import { readFileSync } from "node:fs";

const INDEX = "evidence/registry-evidence-index/README.md";
let src;
try { src = readFileSync(INDEX, "utf8"); } catch {
  console.error(`✗ missing ${INDEX}`);
  process.exit(1);
}

const required = ["1", "2", "3", "4", "5", "6", "7", "8", "9",
  "10", "11", "12", "13", "13B", "14B", "15", "15B", "16", "17", "18"];
const missing = required.filter((b) => !new RegExp(`\\|\\s*${b}\\s*\\|`).test(src));
if (missing.length) {
  console.error(`✗ ${INDEX}: missing rows for batches: ${missing.join(", ")}`);
  process.exit(1);
}
console.log(`✓ batch-18 evidence-index present with ${required.length} batch rows`);
