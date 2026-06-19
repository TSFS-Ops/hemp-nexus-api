#!/usr/bin/env node
// Batch 1 hardening guard — API Usage Dashboard V1
//
// Asserts that NO code path writes full request payloads or response bodies
// into `api_request_logs`. The DB layer also enforces this via a BEFORE
// INSERT/UPDATE trigger (`api_request_logs_strip_payloads`), but this build
// guard is the first line of defence: it fails the build the moment a
// developer adds a `request_body:` or `response_body:` field to a logging
// insert/update, so the regression is caught before deploy.
//
// Scope:
//   - Scans supabase/functions/** and src/**
//   - Flags any source line that, within an `api_request_logs` write
//     (insert/update), references `request_body` or `response_body`.
//   - The trigger function itself is allowed to mention these column names.

import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const ROOTS = ["supabase/functions", "src"];
const FORBIDDEN = ["request_body", "response_body"];
const ALLOWED_FILES = new Set([
  // The guard itself + the trigger / migration that strips payloads.
  "scripts/check-api-request-logs-no-payloads.mjs",
]);

function rgFiles(pattern, root) {
  try {
    const out = execSync(
      `rg -l --no-messages -e ${JSON.stringify(pattern)} ${root}`,
      { encoding: "utf8" },
    );
    return out.split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

const candidates = new Set();
for (const root of ROOTS) {
  for (const f of rgFiles("api_request_logs", root)) candidates.add(f);
}

const offences = [];
for (const file of candidates) {
  if (ALLOWED_FILES.has(file)) continue;
  if (file.endsWith(".test.ts") || file.endsWith(".test.tsx")) continue;
  const src = readFileSync(file, "utf8");
  if (!/api_request_logs/.test(src)) continue;

  const lines = src.split("\n");
  // Find every `.from("api_request_logs")` chain and inspect the next ~40
  // lines for forbidden field writes inside an object literal.
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/from\(\s*["']api_request_logs["']\s*\)/.test(line)) continue;
    const slice = lines.slice(i, i + 60).join("\n");
    if (!/\.(insert|update|upsert)\s*\(/.test(slice)) continue;
    for (const f of FORBIDDEN) {
      // Match `request_body:` or `response_body:` as an object-literal key.
      const re = new RegExp(`(^|[\\s,{])${f}\\s*:`, "m");
      if (re.test(slice)) {
        offences.push(`${file}: writes \`${f}\` into api_request_logs (line ~${i + 1})`);
      }
    }
  }
}

if (offences.length > 0) {
  console.error("❌ check-api-request-logs-no-payloads FAILED");
  console.error("");
  console.error("api_request_logs must never store raw request or response payloads.");
  console.error("Remove the offending field; the DB trigger will null it anyway.");
  console.error("");
  for (const o of offences) console.error("  - " + o);
  process.exit(1);
}

console.log("✅ check-api-request-logs-no-payloads: no payload writes detected");
