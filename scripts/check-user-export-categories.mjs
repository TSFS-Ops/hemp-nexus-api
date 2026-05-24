#!/usr/bin/env node
/**
 * DATA-005 Phase 1 — user export category & audit-name prebuild guard.
 *
 * Rules:
 *  1. The Deno SSOT (supabase/functions/_shared/user-export-categories.ts)
 *     and the client mirror (src/lib/user-export-categories.ts) MUST list
 *     the same ALLOWED set and the same FORBIDDEN set, in the same order.
 *  2. No forbidden category name (passwords, api_keys, ...) may appear
 *     inside ALLOWED_USER_EXPORT_CATEGORIES in either file.
 *  3. The user-export-request edge function MUST emit all three Phase 1
 *     canonical audit names:
 *       - data.user_export_requested
 *       - data.user_export_scope_resolved
 *       - data.user_export_blocked_or_declined
 *  4. The user-export-request edge function MUST NOT emit any Phase 2
 *     audit name (data.user_export_generated / _downloaded /
 *     _file_destroyed) — those belong to Phase 2.
 *  5. No file under src/ or supabase/functions/ may reference a category
 *     string outside the allow-list when used as an export category
 *     (heuristic: a forbidden name literal alongside the word
 *     "category" / "categories" in the same line).
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const DENO_SSOT = join(ROOT, "supabase/functions/_shared/user-export-categories.ts");
const CLIENT_MIRROR = join(ROOT, "src/lib/user-export-categories.ts");
const EDGE_FN = join(ROOT, "supabase/functions/user-export-request/index.ts");

const PHASE1_AUDITS = [
  "data.user_export_requested",
  "data.user_export_scope_resolved",
  "data.user_export_blocked_or_declined",
];
const PHASE2_AUDITS = [
  "data.user_export_generated",
  "data.user_export_downloaded",
  "data.user_export_file_destroyed",
];

const errors = [];

function read(p) {
  if (!existsSync(p)) {
    errors.push(`Missing required file: ${p}`);
    return "";
  }
  return readFileSync(p, "utf8");
}

function extractList(src, name) {
  const re = new RegExp(`${name}\\s*=\\s*\\[([\\s\\S]*?)\\]`, "m");
  const m = src.match(re);
  if (!m) return null;
  return m[1]
    .split(",")
    .map((s) => s.trim().replace(/^["']|["'],?$/g, "").replace(/["']/g, ""))
    .filter((s) => s.length > 0 && !s.startsWith("//"));
}

const denoSrc = read(DENO_SSOT);
const clientSrc = read(CLIENT_MIRROR);
const fnSrc = read(EDGE_FN);

const denoAllowed = extractList(denoSrc, "ALLOWED_USER_EXPORT_CATEGORIES");
const clientAllowed = extractList(clientSrc, "ALLOWED_USER_EXPORT_CATEGORIES");
const denoForbidden = extractList(denoSrc, "FORBIDDEN_USER_EXPORT_CATEGORIES");
const clientForbidden = extractList(clientSrc, "FORBIDDEN_USER_EXPORT_CATEGORIES");

if (!denoAllowed || !clientAllowed) {
  errors.push("Could not extract ALLOWED_USER_EXPORT_CATEGORIES from one of the SSOT files.");
} else if (JSON.stringify(denoAllowed) !== JSON.stringify(clientAllowed)) {
  errors.push(
    "ALLOWED_USER_EXPORT_CATEGORIES drift between Deno SSOT and client mirror.\n" +
      `  deno:   ${JSON.stringify(denoAllowed)}\n` +
      `  client: ${JSON.stringify(clientAllowed)}`,
  );
}
if (!denoForbidden || !clientForbidden) {
  errors.push("Could not extract FORBIDDEN_USER_EXPORT_CATEGORIES from one of the SSOT files.");
} else if (JSON.stringify(denoForbidden) !== JSON.stringify(clientForbidden)) {
  errors.push(
    "FORBIDDEN_USER_EXPORT_CATEGORIES drift between Deno SSOT and client mirror.",
  );
}

// Rule 2: forbidden ∩ allowed must be empty.
if (denoAllowed && denoForbidden) {
  const forbiddenSet = new Set(denoForbidden);
  const bad = denoAllowed.filter((c) => forbiddenSet.has(c));
  if (bad.length > 0) {
    errors.push(
      `Forbidden category name(s) found inside ALLOWED list: ${bad.join(", ")}`,
    );
  }
}

// Rules 3 & 4: edge function audit emissions.
for (const a of PHASE1_AUDITS) {
  if (!fnSrc.includes(`"${a}"`)) {
    errors.push(`user-export-request must emit Phase 1 audit "${a}"`);
  }
}
for (const a of PHASE2_AUDITS) {
  // Allow appearance only inside a comment line. Heuristic: search line by line.
  const lines = fnSrc.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes(`"${a}"`)) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("//") && !trimmed.startsWith("*")) {
        errors.push(
          `user-export-request must NOT emit Phase 2 audit "${a}" (line ${i + 1})`,
        );
      }
    }
  }
}

// Rule 5: any file declaring an export category enum must not list a
// forbidden name on the same line as the word "category"/"categories".
// We restrict the search to user-export specific files to avoid false
// positives in unrelated code (e.g. ExportPurpose enum for DATA-010).
import { readdirSync, statSync } from "node:fs";
function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    let s;
    try { s = statSync(p); } catch { continue; }
    if (s.isDirectory()) walk(p, acc);
    else if (/\.(ts|tsx|mjs)$/.test(name)) acc.push(p);
  }
  return acc;
}
const scanFiles = [
  ...walk(join(ROOT, "supabase/functions/user-export-request")),
  DENO_SSOT,
  CLIENT_MIRROR,
  join(ROOT, "src/components/desk/settings/DataExportTab.tsx"),
];
const forbiddenList = denoForbidden ?? [];
for (const f of scanFiles) {
  if (!existsSync(f)) continue;
  const src = readFileSync(f, "utf8");
  // Find ALLOWED_USER_EXPORT_CATEGORIES = [...] arrays and assert
  // none of their entries is in the forbidden set.
  const allowedLocal = extractList(src, "ALLOWED_USER_EXPORT_CATEGORIES");
  if (allowedLocal) {
    const bad = allowedLocal.filter((c) => forbiddenList.includes(c));
    if (bad.length > 0) {
      errors.push(`${f}: forbidden category name(s) in allow-list: ${bad.join(", ")}`);
    }
  }
}

if (errors.length > 0) {
  console.error("✗ check-user-export-categories: FAIL");
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}
console.log("✓ check-user-export-categories: OK");
