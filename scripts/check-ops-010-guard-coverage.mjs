#!/usr/bin/env node
/**
 * OPS-010 — Guard coverage check.
 *
 * Verifies that every live-side-effect surface imports and invokes the
 * shared demo-mode guard, and that the primary chokepoints physically
 * short-circuit live external providers when the row is demo.
 */
import fs from "node:fs";

const SECONDARY_SURFACES = [
  "supabase/functions/paystack-webhook/index.ts",
  "supabase/functions/admin-credit-org/index.ts",
  "supabase/functions/idv-verify/index.ts",
  "supabase/functions/ubo-verify/index.ts",
  "supabase/functions/wad/index.ts",
  "supabase/functions/p3-wad/index.ts",
  "supabase/functions/collapse/index.ts",
  "supabase/functions/deal-certificate/index.ts",
  "supabase/functions/evidence-pack/index.ts",
  "supabase/functions/webhooks/index.ts",
  "supabase/functions/webhook-retry/index.ts",
  "supabase/functions/webhook-events/index.ts",
  "supabase/functions/export-prepare/index.ts",
  "supabase/functions/export-download/index.ts",
];

const PRIMARY_CHOKEPOINTS = [
  // (file, required marker substring, human description)
  [
    "supabase/functions/send-transactional-email/index.ts",
    "wouldEmitToDemoOrg",
    "send-transactional-email must call wouldEmitToDemoOrg to enforce zero-outbound",
  ],
  [
    "supabase/functions/token-purchase/index.ts",
    "demo-mode-guard",
    "token-purchase must import demo-mode-guard to block live Paystack",
  ],
  [
    "supabase/functions/dilisense-screen/index.ts",
    "simulateInsteadOf",
    "dilisense-screen must call simulateInsteadOf to block live provider",
  ],
];

const APP_TSX = "src/App.tsx";

let failed = false;

for (const f of SECONDARY_SURFACES) {
  if (!fs.existsSync(f)) {
    console.error(`[ops-010-guard-coverage] missing surface: ${f}`);
    failed = true;
    continue;
  }
  const src = fs.readFileSync(f, "utf8");
  if (!src.includes("demo-mode-entry") || !src.includes("tryDemoShortCircuit")) {
    console.error(
      `[ops-010-guard-coverage] ${f} must import demo-mode-entry and call tryDemoShortCircuit`,
    );
    failed = true;
  }
}

for (const [file, marker, desc] of PRIMARY_CHOKEPOINTS) {
  if (!fs.existsSync(file)) {
    console.error(`[ops-010-guard-coverage] missing chokepoint: ${file}`);
    failed = true;
    continue;
  }
  const src = fs.readFileSync(file, "utf8");
  if (!src.includes(marker)) {
    console.error(`[ops-010-guard-coverage] ${desc} (looking for "${marker}")`);
    failed = true;
  }
}

if (fs.existsSync(APP_TSX)) {
  const src = fs.readFileSync(APP_TSX, "utf8");
  if (!src.includes("DemoModeBanner")) {
    console.error(
      `[ops-010-guard-coverage] DemoModeBanner must be mounted in ${APP_TSX}`,
    );
    failed = true;
  }
} else {
  console.error(`[ops-010-guard-coverage] missing ${APP_TSX}`);
  failed = true;
}

if (failed) process.exit(1);
console.log(
  `✓ OPS-010 guard coverage: ${SECONDARY_SURFACES.length} secondary + ${PRIMARY_CHOKEPOINTS.length} primary chokepoints wired; DemoModeBanner mounted.`,
);
