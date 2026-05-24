#!/usr/bin/env node
/**
 * OPS-010 — Pin the 12 canonical demo-workspace audit name strings.
 * The TS browser SSOT and the Deno edge-fn SSOT must both contain
 * every entry; drift in either is a hard prebuild failure.
 */
import fs from "node:fs";

const REQUIRED = [
  "ops.demo_workspace_created",
  "ops.demo_workspace_reset",
  "ops.demo_workspace_archived",
  "ops.demo_mode_side_effect_suppressed",
  "ops.demo_data_accessed",
  "ops.demo_external_call_blocked",
  "ops.demo_credit_burn_simulated",
  "ops.demo_payment_event_simulated",
  "ops.demo_compliance_call_simulated",
  "ops.demo_outreach_blocked",
  "ops.demo_export_marked",
  "ops.demo_boundary_violation_rejected",
];

const FILES = [
  "src/lib/ops/ops-010-audit.ts",
  "supabase/functions/_shared/ops-010-audit.ts",
];

let failed = false;
for (const f of FILES) {
  if (!fs.existsSync(f)) {
    console.error(`[check-ops-010-audit-names] missing file: ${f}`);
    failed = true;
    continue;
  }
  const src = fs.readFileSync(f, "utf8");
  for (const name of REQUIRED) {
    if (!src.includes(`"${name}"`)) {
      console.error(
        `[check-ops-010-audit-names] ${f} is missing canonical audit "${name}"`,
      );
      failed = true;
    }
  }
}

if (failed) process.exit(1);
console.log(
  `✓ OPS-010 audit names: ${REQUIRED.length} canonical names present in both SSOTs.`,
);
