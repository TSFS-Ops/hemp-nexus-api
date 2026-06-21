#!/usr/bin/env node
/**
 * Phase 1 — Notification channel readiness SSOT parity guard.
 * Ensures TS (src/lib) and Deno (_shared) mirrors stay in sync.
 */
import { readFileSync } from "node:fs";

const ts = readFileSync("src/lib/notification-channel-readiness.ts", "utf8");
const deno = readFileSync("supabase/functions/_shared/notification-channel-readiness.ts", "utf8");

function extractArr(src, name) {
  const m = src.match(new RegExp(`export const ${name}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*as const;`, "m"));
  if (!m) throw new Error(`could not extract ${name}`);
  return Array.from(m[1].matchAll(/"([^"]+)"/g)).map((x) => x[1]);
}

const NAMES = [
  "NOTIFICATION_CHANNELS",
  "NOTIFICATION_CHANNEL_STATUSES",
  "NOTIFICATION_SKIP_REASONS",
  "NOTIFICATION_CHANNEL_AUDIT_EVENT_NAMES",
  "MANUAL_OUTREACH_AUTHORISED_ROLES",
];

let failed = false;
for (const n of NAMES) {
  const a = extractArr(ts, n);
  const b = extractArr(deno, n);
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    console.error(`✗ ${n} drift between TS and Deno SSOT`);
    console.error("  TS:  ", a);
    console.error("  Deno:", b);
    failed = true;
  }
}

if (failed) process.exit(1);
console.log("✓ notification-channel-readiness TS ↔ Deno parity OK");
