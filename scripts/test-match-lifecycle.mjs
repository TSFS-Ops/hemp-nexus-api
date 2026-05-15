#!/usr/bin/env node
/**
 * Batch O Phase 1 — Lifecycle predicate unit tests.
 *
 * Pure logic tests, no test framework dependency. Run via:
 *   node scripts/test-match-lifecycle.mjs
 */

import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Transpile TS predicate file to JS for node import
const tmp = mkdtempSync(join(tmpdir(), "matchlife-"));
const out = join(tmp, "match-lifecycle.mjs");
const r = spawnSync(
  "npx",
  ["--yes", "esbuild", "src/lib/match-lifecycle.ts", "--format=esm", "--platform=neutral", `--outfile=${out}`, "--log-level=error"],
  { stdio: "inherit" },
);
if (r.status !== 0) {
  console.error("✗ failed to transpile match-lifecycle.ts");
  process.exit(1);
}

const m = await import(pathToFileURL(out).href);
const {
  isTerminalMatch,
  isActiveMatch,
  isInconsistentMatch,
  requiresNamedContact,
  hasActiveChildMatches,
} = m;

let passed = 0;
let failed = 0;
function t(name, cond) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

console.log("Batch O Phase 1 — predicate tests:\n");

// 1. normal active match
t(
  "1. normal active match",
  isActiveMatch({ status: "matched", state: "discovery", poi_state: "DRAFT" }) === true &&
    isTerminalMatch({ status: "matched", state: "discovery", poi_state: "DRAFT" }) === false,
);

// 2. terminal completed match
t(
  "2. terminal completed match",
  isTerminalMatch({ status: "completed", state: "completed", poi_state: "COMPLETED", completed_at: "2026-01-01" }) === true &&
    isActiveMatch({ status: "completed", state: "completed", poi_state: "COMPLETED", completed_at: "2026-01-01" }) === false,
);

// 3. POI expired/rejected/annulled terminal
t(
  "3a. POI EXPIRED terminal",
  isTerminalMatch({ status: "matched", state: "discovery", poi_state: "EXPIRED" }) === true,
);
t(
  "3b. POI REJECTED terminal",
  isTerminalMatch({ status: "matched", state: "discovery", poi_state: "REJECTED" }) === true,
);
t(
  "3c. POI ANNULLED terminal",
  isTerminalMatch({ status: "matched", state: "discovery", poi_state: "ANNULLED" }) === true,
);

// 4. settled + DRAFT inconsistent
t(
  "4. settled + DRAFT inconsistent",
  isInconsistentMatch({ status: "settled", state: "intent_declared", poi_state: "DRAFT" }) === true &&
    isActiveMatch({ status: "settled", state: "intent_declared", poi_state: "DRAFT" }) === false,
);

// 5. completed state + DRAFT POI inconsistent
t(
  "5. completed state + DRAFT inconsistent",
  isInconsistentMatch({ status: "matched", state: "completed", poi_state: "DRAFT" }) === true,
);

// 6. settled_at present with non-settled status inconsistent
t(
  "6. settled_at present non-settled inconsistent",
  isInconsistentMatch({ status: "matched", state: "discovery", settled_at: "2026-01-01" }) === true,
);

// 7. both committed timestamps present but state discovery
t(
  "7. both committed but state discovery inconsistent",
  isInconsistentMatch({
    status: "matched",
    state: "discovery",
    buyer_committed_at: "2026-01-01",
    seller_committed_at: "2026-01-02",
  }) === true,
);

// 8. legacy_repair_required marker
t(
  "8. legacy_repair_required inconsistent + not active",
  isInconsistentMatch({ status: "matched", state: "discovery", metadata: { legacy_repair_required: true } }) === true &&
    isActiveMatch({ status: "matched", state: "discovery", metadata: { legacy_repair_required: true } }) === false,
);

// 9. state_reconciliation_required marker
t(
  "9. state_reconciliation_required inconsistent + not active",
  isInconsistentMatch({ status: "matched", state: "discovery", metadata: { state_reconciliation_required: true } }) === true &&
    isActiveMatch({ status: "matched", state: "discovery", metadata: { state_reconciliation_required: true } }) === false,
);

// 10. parent_archived_admin_exception_hold not active but not terminal
t(
  "10. exception_hold not active but not terminal",
  isActiveMatch({
    status: "matched",
    state: "discovery",
    poi_state: "DRAFT",
    metadata: { parent_archived_admin_exception_hold: true },
  }) === false &&
    isTerminalMatch({
      status: "matched",
      state: "discovery",
      poi_state: "DRAFT",
      metadata: { parent_archived_admin_exception_hold: true },
    }) === false,
);

// 11. org attached, missing buyer contact
t(
  "11. org attached missing buyer returns 'buyer'",
  requiresNamedContact({
    buyer_org_id: "org-b",
    seller_org_id: "org-s",
    seller_authorised_user_id: "u-s",
  }) === "buyer",
);

// 12. org attached, missing seller contact
t(
  "12. org attached missing seller returns 'seller'",
  requiresNamedContact({
    buyer_org_id: "org-b",
    seller_org_id: "org-s",
    buyer_authorised_user_id: "u-b",
  }) === "seller",
);

// 13. both sides missing
t(
  "13. both sides missing returns 'both'",
  requiresNamedContact({ buyer_org_id: "org-b", seller_org_id: "org-s" }) === "both",
);

// 14. no org attached returns null
t(
  "14. no org attached returns null",
  requiresNamedContact({}) === null,
);

// 15. hasActiveChildMatches: only true if a non-terminal active child exists
t(
  "15a. all terminal children → false",
  hasActiveChildMatches([
    { status: "completed", state: "completed", poi_state: "COMPLETED", completed_at: "x" },
    { status: "matched", state: "discovery", poi_state: "EXPIRED" },
  ]) === false,
);
t(
  "15b. one active non-terminal child → true",
  hasActiveChildMatches([
    { status: "completed", state: "completed", poi_state: "COMPLETED", completed_at: "x" },
    { status: "matched", state: "discovery", poi_state: "DRAFT" },
  ]) === true,
);
t(
  "15c. inconsistent child does not count as active",
  hasActiveChildMatches([
    { status: "settled", state: "intent_declared", poi_state: "DRAFT" },
  ]) === false,
);
t(
  "15d. exception-hold child does not count as active",
  hasActiveChildMatches([
    { status: "matched", state: "discovery", poi_state: "DRAFT", metadata: { parent_archived_admin_exception_hold: true } },
  ]) === false,
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
