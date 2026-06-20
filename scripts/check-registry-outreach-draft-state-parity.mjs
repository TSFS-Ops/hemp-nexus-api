#!/usr/bin/env node
/**
 * Batch 6 — Outreach SSOT parity (draft states, approval states, channels,
 * send methods/outcomes, audit names, bucket list) between TS and Deno mirrors.
 */
import { readFileSync } from "node:fs";

const ts = readFileSync("src/lib/registry-outreach.ts", "utf8");
const deno = readFileSync("supabase/functions/_shared/registry-outreach.ts", "utf8");

const NAMES = [
  "REGISTRY_OUTREACH_DRAFT_STATES",
  "REGISTRY_OUTREACH_APPROVAL_STATES",
  "REGISTRY_OUTREACH_REVIEW_ACTIONS",
  "REGISTRY_OUTREACH_CHANNELS",
  "REGISTRY_OUTREACH_SEND_METHODS",
  "REGISTRY_OUTREACH_SEND_OUTCOMES",
  "REGISTRY_OUTREACH_AUDIT_EVENT_NAMES",
  "REGISTRY_CLIENT_READINESS_BUCKETS",
];

let failed = false;
for (const n of NAMES) {
  const re = new RegExp(`${n}\\s*=\\s*\\[([\\s\\S]*?)\\]`);
  const a = ts.match(re)?.[1].replace(/\s+/g, "");
  const b = deno.match(re)?.[1].replace(/\s+/g, "");
  if (!a || !b) { console.error(`✗ ${n}: missing from one mirror`); failed = true; continue; }
  if (a !== b) { console.error(`✗ ${n}: TS ↔ Deno mismatch`); failed = true; }
}

if (failed) process.exit(1);
console.log(`✓ Batch 6 outreach SSOT parity passed (${NAMES.length} arrays)`);
