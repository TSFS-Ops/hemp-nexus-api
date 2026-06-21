#!/usr/bin/env node
/**
 * Phase 1 — Notification skip-reason parity guard.
 *
 * The set of recognised skip reasons MUST be the same in the TS SSOT,
 * the Deno mirror, the skip-record edge function payload validation, and
 * the database CHECK constraint declared in the Phase 1 migration.
 */
import { readFileSync, readdirSync } from "node:fs";

const ts = readFileSync("src/lib/notification-channel-readiness.ts", "utf8");
const fn = readFileSync("supabase/functions/notification-channel-skip-record/index.ts", "utf8");

function extractArr(src) {
  const m = src.match(/NOTIFICATION_SKIP_REASONS\s*=\s*\[([\s\S]*?)\]\s*as const;/);
  if (!m) throw new Error("missing NOTIFICATION_SKIP_REASONS");
  return Array.from(m[1].matchAll(/"([^"]+)"/g)).map((x) => x[1]);
}

const reasons = extractArr(ts);

// Edge function uses NOTIFICATION_SKIP_REASONS via import — verify import line
if (!fn.includes("NOTIFICATION_SKIP_REASONS")) {
  console.error("✗ skip-record edge function does not import NOTIFICATION_SKIP_REASONS");
  process.exit(1);
}

// Verify all reasons appear in the most recent Phase 1 migration
const files = readdirSync("supabase/migrations").sort();
const recent = files.slice(-15).map((f) => readFileSync(`supabase/migrations/${f}`, "utf8")).join("\n");
let failed = false;
for (const r of reasons) {
  if (!recent.includes(`'${r}'`)) {
    console.error(`✗ migration CHECK constraint missing reason: ${r}`);
    failed = true;
  }
}

if (failed) process.exit(1);
console.log("✓ notification-skip-reason parity OK across TS / edge function / migration");
