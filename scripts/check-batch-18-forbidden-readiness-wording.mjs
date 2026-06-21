#!/usr/bin/env node
/**
 * Batch 18 — Forbids release-readiness wording (e.g. "Production-ready",
 * "Live", "Provider verified", "Bank verified", "Guaranteed accurate",
 * "Fully verified registry", "Ready for all customers", "Real-time bank
 * verification", "Raw bank details available", "Automatic approval") on
 * the Batch 18 SSOT-driven surfaces and registry docs.
 *
 * The SSOT itself (`src/lib/registry-release-gate-ssot.ts`) is exempt
 * because it enumerates the forbidden list verbatim as a guard.
 *
 * If a forbidden phrase appears in a SSOT-driven surface it MUST be
 * qualified by "not yet enabled", "not enabled", or "disabled by
 * default" within the same file — otherwise the build fails.
 */
import { readFileSync } from "node:fs";

const TARGETS = [
  "src/pages/admin/registry/ReleaseGate.tsx",
  "src/pages/admin/registry/DemoPack.tsx",
  "src/pages/admin/registry/UatScenarios.tsx",
  "docs/registry/release-gate-matrix.md",
  "docs/registry/uat-scenarios.md",
  "docs/registry/demo-walkthrough.md",
  "docs/registry/client-safe-limitations.md",
];

const FORBIDDEN = [
  "Production-ready",
  "Provider verified",
  "Bank verified",
  "Guaranteed accurate",
  "Fully verified registry",
  "Ready for all customers",
  "Real-time bank verification",
  "Raw bank details available",
  "Automatic approval",
];

let failed = false;
for (const path of TARGETS) {
  let src;
  try { src = readFileSync(path, "utf8"); } catch { continue; }
  const qualified = /not (yet )?enabled|disabled by default/i.test(src);
  for (const w of FORBIDDEN) {
    const re = new RegExp(`\\b${w}\\b`, "i");
    if (re.test(src) && !qualified) {
      console.error(`✗ ${path}: forbidden readiness wording "${w}" (no qualifying "not enabled" / "disabled by default")`);
      failed = true;
    }
  }
}

if (failed) process.exit(1);
console.log(`✓ batch-18 forbidden-readiness-wording check passed (${TARGETS.length} files scanned)`);
