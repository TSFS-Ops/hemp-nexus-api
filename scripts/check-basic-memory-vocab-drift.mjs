#!/usr/bin/env node
/**
 * Basic Memory Record v1 — vocabulary drift guard.
 *
 * Ensures the closed enums declared in src/lib/basic-memory/outcomes.ts
 * exactly match the canonical v1 lists. The same lists are mirrored as
 * CHECK constraints in the basic_memory_records table migration; any
 * change here MUST be paired with a migration changing the CHECK
 * constraints (and vice versa). Prebuild fails on drift so the HQ panel
 * and downstream writers cannot silently extend the v1 vocabulary.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const CANONICAL = {
  BASIC_MEMORY_TRIGGER_TYPES: [
    "finality.collapsed",
    "wad.sealed",
    "dispute.resolved",
  ],
  BASIC_MEMORY_OUTCOMES: ["completed", "wad_sealed", "dispute_resolved"],
  BASIC_MEMORY_OUTCOME_REASONS: [
    "collapse_recorded",
    "attestations_complete",
    "dispute_resolved",
  ],
  BASIC_MEMORY_ENVIRONMENTS: ["live", "demo", "test"],
};

const SRC = readFileSync(
  resolve(ROOT, "src/lib/basic-memory/outcomes.ts"),
  "utf8",
);

const errors = [];

function extractArray(name) {
  // Match `export const NAME = [ ... ] as const;`
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
    errors.push(`Missing export const ${name} in outcomes.ts`);
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

if (errors.length) {
  console.error("[check-basic-memory-vocab-drift] FAIL");
  for (const e of errors) console.error("  - " + e);
  console.error(
    "\nIf you intentionally changed the v1 vocabulary, you MUST also update\n" +
      "the CHECK constraints in the basic_memory_records migration and the\n" +
      "CANONICAL lists in this guard. Do not extend v1 without sign-off.",
  );
  process.exit(1);
}

console.log("[check-basic-memory-vocab-drift] OK");
