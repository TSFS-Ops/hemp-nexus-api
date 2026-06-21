#!/usr/bin/env node
/**
 * Batch 18 — Ensures the four required Batch 18 documentation files
 * exist and are non-trivial.
 */
import { readFileSync } from "node:fs";

const DOCS = [
  "docs/registry/release-gate-matrix.md",
  "docs/registry/uat-scenarios.md",
  "docs/registry/demo-walkthrough.md",
  "docs/registry/client-safe-limitations.md",
  "evidence/batch-18-end-to-end-uat-release-demo/README.md",
];

let failed = false;
for (const d of DOCS) {
  let src = "";
  try { src = readFileSync(d, "utf8"); } catch {
    console.error(`✗ missing ${d}`);
    failed = true;
    continue;
  }
  if (src.length < 200) {
    console.error(`✗ ${d}: too short (${src.length} bytes)`);
    failed = true;
  }
}
if (failed) process.exit(1);
console.log(`✓ batch-18 docs present (${DOCS.length} files)`);
