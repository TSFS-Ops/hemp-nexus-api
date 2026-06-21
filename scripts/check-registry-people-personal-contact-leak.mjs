#!/usr/bin/env node
// Prebuild guard: forbid any public-facing surface from selecting
// personal_email, personal_phone or personal_address on
// registry_company_people (or referencing those columns in client code
// at all).
//
// Allowed:
//   - migrations (schema definition and protection triggers)
//   - this guard itself
//   - tests that assert protection
//   - the public-safe RPC `registry_company_people_public_safe`
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const FORBIDDEN = ["personal_email", "personal_phone", "personal_address"];
const SCAN_DIRS = ["src", "supabase/functions"];
const ALLOW = [
  "supabase/migrations/",
  "scripts/check-registry-people-personal-contact-leak.mjs",
  "src/integrations/supabase/types.ts", // generated types are reference-only
  "src/tests/batch-12-registry-people-personal-contact.test.ts",
  "supabase/functions/_shared/outreach-validator.ts", // PII detection allowlist
  "supabase/functions/ai-outreach-draft-v2-decision/phase5_test.ts",
];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const violations = [];
for (const d of SCAN_DIRS) {
  for (const file of walk(join(ROOT, d))) {
    const rel = relative(ROOT, file);
    if (ALLOW.some((a) => rel === a || rel.startsWith(a))) continue;
    if (!/\.(ts|tsx|js|mjs|sql)$/.test(file)) continue;
    const text = readFileSync(file, "utf8");
    if (!/registry_company_people/.test(text)) continue;
    for (const f of FORBIDDEN) {
      if (text.includes(f)) {
        violations.push(`${rel}: references ${f} on registry_company_people surface`);
      }
    }
  }
}

if (violations.length) {
  console.error("❌ registry_company_people personal contact leak guard failed:");
  for (const v of violations) console.error("  - " + v);
  process.exit(1);
}
console.log("✓ registry_company_people personal contact leak guard passed");
