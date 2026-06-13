#!/usr/bin/env node
/**
 * Asserts the facilitation case state machine in
 *   src/lib/facilitation-case-state.ts
 * is byte-equal in its INTERNAL_STATUSES + OUTCOMES + audit-name lists to
 *   supabase/functions/_shared/facilitation-case-state.ts
 * preventing drift between server and client SSOT.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const CLIENT = "src/lib/facilitation-case-state.ts";
const SERVER = "supabase/functions/_shared/facilitation-case-state.ts";

function extractList(src, marker) {
  const start = src.indexOf(`export const ${marker} = [`);
  if (start < 0) return null;
  const end = src.indexOf("] as const", start);
  if (end < 0) return null;
  const items = src.slice(start, end)
    .match(/"([^"]+)"/g)?.map((s) => s.slice(1, -1)) ?? [];
  return items;
}

const errors = [];
for (const p of [CLIENT, SERVER]) {
  if (!existsSync(resolve(ROOT, p))) { errors.push(`Missing SSOT file: ${p}`); }
}
if (errors.length) {
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}

const c = readFileSync(resolve(ROOT, CLIENT), "utf8");
const s = readFileSync(resolve(ROOT, SERVER), "utf8");

for (const marker of ["INTERNAL_STATUSES", "OUTCOMES", "FACILITATION_AUDIT_NAMES"]) {
  const a = extractList(c, marker);
  const b = extractList(s, marker);
  if (!a || !b) { errors.push(`${marker}: could not extract from one of the SSOTs`); continue; }
  if (a.length !== b.length || a.some((v, i) => v !== b[i])) {
    errors.push(`${marker} drift between client and server SSOT\n    client: ${JSON.stringify(a)}\n    server: ${JSON.stringify(b)}`);
  }
}

if (errors.length) {
  console.error("[check-facilitation-status-drift] FAILED:");
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}
console.log("[check-facilitation-status-drift] OK");
