#!/usr/bin/env node
/**
 * Batch O Phase 2b Step 1 — inconsistencyReasons() unit tests.
 * Pure logic, no framework. Run via:
 *   node scripts/test-match-lifecycle-reasons.mjs
 */
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmp = mkdtempSync(join(tmpdir(), "mlr-"));
const out = join(tmp, "ml.mjs");
const r = spawnSync(
  "npx",
  ["--yes", "esbuild", "src/lib/match-lifecycle.ts", "--format=esm", "--platform=neutral", `--outfile=${out}`, "--log-level=error"],
  { stdio: "inherit" },
);
if (r.status !== 0) process.exit(1);

const m = await import(pathToFileURL(out).href);
const { inconsistencyReasons, isInconsistentMatch, isActiveMatch } = m;

let passed = 0, failed = 0;
function t(name, cond) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}`); }
}
function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

console.log("Batch O Phase 2b Step 1 — inconsistencyReasons tests:\n");

// 1. clean match → []
t("1. clean match returns []",
  eq(inconsistencyReasons({ status: "matched", state: "discovery", poi_state: "DRAFT" }), []));

// 2. each reason fires for its case
t("2a. legacy_repair_required",
  eq(inconsistencyReasons({ metadata: { legacy_repair_required: true } }), ["legacy_repair_required"]));
t("2b. state_reconciliation_required",
  eq(inconsistencyReasons({ metadata: { state_reconciliation_required: true } }), ["state_reconciliation_required"]));
t("2c. settled_with_draft_poi",
  eq(inconsistencyReasons({ status: "settled", poi_state: "DRAFT" }), ["settled_with_draft_poi"]));
t("2d. completed_state_with_open_poi",
  eq(inconsistencyReasons({ state: "completed", poi_state: "DRAFT" }), ["completed_state_with_open_poi"]));
t("2e. settled_at_without_settled_status",
  eq(inconsistencyReasons({ status: "matched", settled_at: "2026-01-01" }), ["settled_at_without_settled_status"]));
t("2f. both_committed_but_still_discovery",
  eq(inconsistencyReasons({ state: "discovery", buyer_committed_at: "x", seller_committed_at: "y" }),
     ["both_committed_but_still_discovery"]));
t("2g. same_org_both_sides",
  eq(inconsistencyReasons({ buyer_org_id: "org-1", seller_org_id: "org-1" }), ["same_org_both_sides"]));

// 3. multiple reasons return stable ordered list
t("3. multiple reasons stable order",
  eq(inconsistencyReasons({
    status: "settled",
    state: "completed",
    poi_state: "DRAFT",
    settled_at: null,
    buyer_org_id: "o", seller_org_id: "o",
    metadata: { legacy_repair_required: true, state_reconciliation_required: true },
  }), [
    "legacy_repair_required",
    "state_reconciliation_required",
    "settled_with_draft_poi",
    "completed_state_with_open_poi",
    "same_org_both_sides",
  ]));

// 4. isInconsistentMatch ≡ reasons.length > 0
const cases = [
  { status: "matched", state: "discovery", poi_state: "DRAFT" },
  { status: "settled", poi_state: "DRAFT" },
  { state: "completed", poi_state: "DRAFT" },
  { metadata: { legacy_repair_required: true } },
  { buyer_org_id: "x", seller_org_id: "x" },
  { state: "discovery", buyer_committed_at: "a", seller_committed_at: "b" },
  { settled_at: "z", status: "matched" },
  { status: "completed", state: "completed", poi_state: "COMPLETED" },
];
let invariantOk = true;
for (const c of cases) {
  if (isInconsistentMatch(c) !== (inconsistencyReasons(c).length > 0)) invariantOk = false;
}
t("4. isInconsistentMatch ≡ reasons.length > 0 across cases", invariantOk);

// 5. parent_archived_admin_exception_hold: not active, not a reason
const exHold = {
  status: "matched", state: "discovery", poi_state: "DRAFT",
  metadata: { parent_archived_admin_exception_hold: true },
};
t("5a. exception_hold not active",
  isActiveMatch(exHold) === false);
t("5b. exception_hold is NOT an inconsistency reason",
  eq(inconsistencyReasons(exHold), []));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
