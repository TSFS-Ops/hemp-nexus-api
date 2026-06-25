#!/usr/bin/env node
/**
 * P-5 Batch 5 — vocabulary drift guard.
 *
 * Ensures the closed enums in `src/lib/p5-batch5/outcomes.ts` exactly
 * match the canonical Batch 5 lists, and that the version stamps in
 * `src/lib/p5-batch5/version.ts` match the migration defaults.
 *
 * Any change here MUST be paired with a migration changing the matching
 * Postgres enums / column defaults. Prebuild fails on drift so no UI,
 * RPC or API surface can silently extend Batch 5 vocab.
 *
 * Note: this guard is INDEPENDENT of the v1 basic_memory_records guard
 * (`scripts/check-basic-memory-vocab-drift.mjs`). v1 stays frozen.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const CANONICAL = {
  P5B5_FINALITY_STATUSES: [
    "none",
    "ready_for_finality",
    "final",
    "under_dispute",
    "corrected",
    "superseded",
    "invalid_test",
  ],
  P5B5_FINAL_OUTCOME_CODES: [
    "COMPLETED",
    "COMPLETED_WITH_EXCEPTION",
    "APPROVED_NOT_EXECUTED",
    "WITHDRAWN_BY_USER",
    "REJECTED",
    "EXPIRED",
    "CANCELLED",
    "FAILED_PROVIDER_DEPENDENCY",
    "DISPUTED",
    "SUPERSEDED",
    "TEST_OR_INVALID",
  ],
  P5B5_MEMORY_STATUSES: [
    "active",
    "paused",
    "excluded",
    "corrected",
    "superseded",
    "not_written",
  ],
  P5B5_DISPUTE_STATUSES: [
    "none",
    "under_dispute",
    "resolved_upheld",
    "resolved_partially_upheld",
    "resolved_dismissed",
    "withdrawn",
    "escalated",
  ],
  P5B5_CORRECTION_STATUSES: [
    "none",
    "corrected",
    "superseded",
    "administrative_reclassification",
  ],
  P5B5_PROVIDER_DEPENDENCY_STATUSES: [
    "success",
    "failed",
    "inconclusive",
    "reconciled",
    "refunded",
    "duplicate_ignored",
    "not_applicable",
  ],
  P5B5_EVIDENCE_COMPLETENESS_STATUSES: [
    "complete",
    "incomplete",
    "waived",
    "not_applicable",
  ],
};

const CANONICAL_VERSIONS = {
  P5B5_SCHEMA_VERSION: "p5b5.v1",
  P5B5_OUTCOME_CODE_VERSION: "p5b5-outcomes.v1",
};

const SRC = readFileSync(
  resolve(ROOT, "src/lib/p5-batch5/outcomes.ts"),
  "utf8",
);
const VSRC = readFileSync(
  resolve(ROOT, "src/lib/p5-batch5/version.ts"),
  "utf8",
);

const errors = [];

function extractArray(name) {
  const re = new RegExp(
    `export const ${name}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*as const`,
    "m",
  );
  const m = SRC.match(re);
  if (!m) return null;
  return Array.from(m[1].matchAll(/"([^"]+)"/g)).map((x) => x[1]);
}

for (const [name, expected] of Object.entries(CANONICAL)) {
  const got = extractArray(name);
  if (!got) {
    errors.push(`Missing export const ${name} in src/lib/p5-batch5/outcomes.ts`);
    continue;
  }
  const a = JSON.stringify(got);
  const b = JSON.stringify(expected);
  if (a !== b) {
    errors.push(
      `Vocab drift in ${name}\n  expected: ${b}\n  got:      ${a}`,
    );
  }
}

function extractStringConst(src, name) {
  const re = new RegExp(
    `export const ${name}\\s*=\\s*"([^"]+)"\\s*as const`,
    "m",
  );
  const m = src.match(re);
  return m ? m[1] : null;
}

for (const [name, expected] of Object.entries(CANONICAL_VERSIONS)) {
  const got = extractStringConst(VSRC, name);
  if (got !== expected) {
    errors.push(
      `Version drift in ${name}\n  expected: "${expected}"\n  got:      ${got === null ? "MISSING" : `"${got}"`}`,
    );
  }
}

if (errors.length) {
  console.error("[check-p5-batch5-vocab-drift] FAIL");
  for (const e of errors) console.error("  - " + e);
  console.error(
    "\nIf you intentionally changed Batch 5 vocab or versions, you MUST also\n" +
      "update the matching Postgres enums / column defaults in a migration.\n" +
      "Do not extend Batch 5 vocab without the paired migration.",
  );
  process.exit(1);
}

console.log("[check-p5-batch5-vocab-drift] OK");
