#!/usr/bin/env node
/**
 * Batch 3 — Registry search/profile/claim wording guard.
 *
 *  1. Registry pages and components MUST NOT use the forbidden wording set
 *     (verified / live / guaranteed / production-ready) unless the file is a
 *     SSOT (src/lib/registry-*) or a test file.
 *
 *  2. The non-verification approval copy MUST appear verbatim in:
 *       - src/lib/registry-claims.ts (SSOT)
 *       - supabase/functions/_shared/registry-claims.ts (Deno mirror)
 *       - supabase/functions/registry-company-claim/index.ts
 *       - the admin claims surface
 *
 *  3. Search result labels MUST never appear adjacent to "verified" without
 *     the canonical "not" prefix (profile_not_verified / bank_details_not_*).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const APPROVAL_COPY = "Approving this claim confirms only that the claim record has passed review. It does not verify authority-to-act, company profile accuracy or bank details.";
const FORBIDDEN = ["verified", "live", "guaranteed", "production-ready"];

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, files);
    else if (/\.(tsx?|md)$/.test(name)) files.push(p);
  }
  return files;
}

let failed = false;

// (1) Forbidden wording on registry SHELL surfaces (search + profile + claim + admin claims).
const shellDirs = [
  "src/components/registry/claims",
  "src/pages/registry",
  "src/pages/admin/registry",
];
for (const d of shellDirs) {
  let files;
  try { files = walk(d); } catch { continue; }
  for (const f of files) {
    if (f.includes(".test.")) continue;
    const src = readFileSync(f, "utf8");
    for (const word of FORBIDDEN) {
      // allow the canonical "_not_verified" / "_not_provided" labels and the
      // explicit non-verification approval copy.
      const re = new RegExp(`\\b${word}\\b`, "i");
      if (!re.test(src)) continue;
      const lines = src.split(/\n/);
      const offending = lines.filter((line) => {
        if (!re.test(line)) return false;
        if (line.includes("not_verified") || line.includes("not verified")) return false;
        if (line.includes("not verify")) return false;
        if (line.includes("_not_provided")) return false;
        return true;
      });
      if (offending.length) {
        console.error(`✗ forbidden word "${word}" in ${f}: ${offending[0].trim().slice(0, 120)}`);
        failed = true;
      }
    }
  }
}

// (2) Verbatim non-verification approval copy in the required surfaces.
const mustHaveCopy = [
  "src/lib/registry-claims.ts",
  "supabase/functions/_shared/registry-claims.ts",
  "supabase/functions/registry-company-claim/index.ts",
  "src/pages/admin/registry/Claims.tsx",
];
for (const f of mustHaveCopy) {
  const src = readFileSync(f, "utf8");
  if (!src.includes(APPROVAL_COPY)) {
    console.error(`✗ ${f} is missing the canonical non-verification approval copy`);
    failed = true;
  }
}

if (failed) process.exit(1);
console.log("✓ registry-claim approval wording + shell forbidden wording OK");
