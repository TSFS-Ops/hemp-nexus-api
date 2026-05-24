#!/usr/bin/env node
/**
 * DATA-009 Phase 2 — audit-emission guard.
 * Asserts each of the 4 canonical Phase 1 audit constants is actually
 * emitted in at least one expected file (migration / RPC body / edge /
 * shared guard). Fails CLOSED if a name is unwired.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const AUDIT_NAMES = [
  "data.residency_requirement_detected",
  "data.unapproved_residency_claim_blocked",
  "data.residency_exception_approved",
  "data.residency_exception_declined",
];

const SCAN_DIRS = [
  "supabase/migrations",
  "supabase/functions/_shared",
  "supabase/functions/residency-review-request",
  "supabase/functions/admin-residency-review-approve",
  "supabase/functions/admin-residency-review-decline",
];

function walk(dir) {
  const out = [];
  try {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      const s = statSync(p);
      if (s.isDirectory()) out.push(...walk(p));
      else out.push(p);
    }
  } catch { /* missing dir */ }
  return out;
}

const corpus = SCAN_DIRS.flatMap(walk)
  .filter((p) => /\.(ts|sql|mjs|js)$/.test(p))
  .map((p) => readFileSync(p, "utf8"))
  .join("\n");

const missing = AUDIT_NAMES.filter((n) => !corpus.includes(n));
if (missing.length) {
  console.error("\n❌ DATA-009 Phase 2 audit-emission guard FAILED:\n");
  for (const m of missing) console.error("  - " + m);
  process.exit(1);
}
console.log(`✓ DATA-009 Phase 2 audit-emission: all ${AUDIT_NAMES.length} canonical names emitted.`);
