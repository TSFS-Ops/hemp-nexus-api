#!/usr/bin/env node
// COMP-002 / COMP-012 — pin freshness thresholds (30 days sanctions,
// 365 days verification) in both the TS mirror and the Deno mirror.

import fs from "node:fs";

const PINS = [
  { name: "SANCTIONS_FRESHNESS_DAYS", value: "30" },
  { name: "VERIFICATION_FRESHNESS_DAYS", value: "365" },
];

const FILES = [
  "src/lib/compliance/freshness-thresholds.ts",
  "supabase/functions/_shared/freshness-thresholds.ts",
];

let failed = false;
for (const f of FILES) {
  if (!fs.existsSync(f)) {
    console.error(`[check-comp-002-012-thresholds] missing file: ${f}`);
    failed = true;
    continue;
  }
  const src = fs.readFileSync(f, "utf8");
  for (const { name, value } of PINS) {
    const re = new RegExp(`${name}\\s*=\\s*${value}\\b`);
    if (!re.test(src)) {
      console.error(
        `[check-comp-002-012-thresholds] ${f} must declare ${name} = ${value}`,
      );
      failed = true;
    }
  }
}

if (failed) process.exit(1);
console.log(
  "[check-comp-002-012-thresholds] ok — sanctions 30d / verification 365d pinned in both mirrors.",
);
