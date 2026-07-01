#!/usr/bin/env node
// Batch D1 — static guard against reintroducing a UAT / arbitrary password
// reset backdoor (tracker item #4).
//
// Fails the build if:
//   1. A function directory named set-uat-passwords (or equivalent variants)
//      reappears under supabase/functions/.
//   2. Any file under supabase/functions/ mentions such a route/name.
//   3. Any custom edge function performs an admin password reset for an
//      arbitrary named account without BOTH a non-production/sandbox guard
//      AND an internal secret guard.
//
// Legitimate Supabase-managed recovery flows (auth.resetPasswordForEmail,
// updateUser({ password }) for the authenticated user) are not flagged.
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, basename } from "node:path";

const ROOT = process.cwd();
const FN_DIR = join(ROOT, "supabase/functions");

const FORBIDDEN_NAMES = [
  "set-uat-passwords",
  "set_uat_passwords",
  "uat-password-reset",
  "uat_password_reset",
  "reset-uat-password",
  "reset_uat_password",
];

const violations = [];

function walk(dir, out = []) {
  let ents;
  try { ents = readdirSync(dir); } catch { return out; }
  for (const n of ents) {
    const p = join(dir, n);
    let st; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

// 1) Forbidden directory names.
if (existsSync(FN_DIR)) {
  for (const entry of readdirSync(FN_DIR)) {
    if (FORBIDDEN_NAMES.includes(entry)) {
      violations.push(`supabase/functions/${entry}/ is a forbidden UAT password reset endpoint`);
    }
  }
}

// This guard file may legitimately mention the forbidden names.
const ALLOW_MENTIONS = new Set([
  "scripts/check-no-uat-password-reset.mjs",
  "evidence/batch-d-backdoor-admin-bypass/static-guards/README.md",
]);

// Known-safe staging/fixture seeders. Each was reviewed and confirmed to:
//   - scope every seeded account to the @test.izenzo.co.za fixture domain
//     and/or refuse on production tier, AND
//   - require a service-role bearer or INTERNAL_CRON_KEY / platform_admin.
// Adding a new file to this list requires the same review.
const KNOWN_FIXTURE_SEEDERS = new Set([
  "supabase/functions/seed-smoke-a-d-fixtures/index.ts",
  "supabase/functions/seed-smoke-ai-review-fixtures/index.ts",
  "supabase/functions/seed-smoke-batch-7-fixtures/index.ts",
  "supabase/functions/seed-uat-facilitation-accounts/index.ts",
  "supabase/functions/staging-set-fixture-password/index.ts",
  "supabase/functions/uat-facilitation-phase-1/index.ts",
  "supabase/functions/seed-ai-light-intel-uat/index.ts",
]);

const files = walk(FN_DIR).filter((f) => /\.(ts|tsx|js|mjs|json|sql)$/.test(f));

for (const f of files) {
  const rel = relative(ROOT, f);
  if (ALLOW_MENTIONS.has(rel)) continue;
  const text = readFileSync(f, "utf8");

  // 2) Forbidden route/name mentions.
  for (const name of FORBIDDEN_NAMES) {
    if (text.includes(name)) {
      violations.push(`${rel}: references forbidden UAT password reset name "${name}"`);
    }
  }

  // 3) Detect custom admin password reset for arbitrary accounts without guards.
  //    Signals: supabase.auth.admin.updateUserById(... { password ... })
  //    or auth.admin.generateLink type=recovery for arbitrary user_id/email.
  const dangerous =
    /auth\.admin\.updateUserById\s*\([^)]*password/s.test(text) ||
    /auth\.admin\.generateLink\s*\(\s*\{[^}]*type:\s*['"]recovery['"]/s.test(text);

  if (dangerous && !KNOWN_FIXTURE_SEEDERS.has(rel)) {
    // Look for non-prod guard.
    const nonProdGuard =
      /NODE_ENV\s*!==?\s*['"]production['"]/i.test(text) ||
      /APP_ENV\s*!==?\s*['"]production['"]/i.test(text) ||
      /ENVIRONMENT\s*!==?\s*['"]production['"]/i.test(text) ||
      /['"](sandbox|staging|uat|development|dev|test)['"]/i.test(text) ||
      /is[_-]?prod(uction)?/i.test(text);

    // Look for internal secret guard.
    const secretGuard =
      /INTERNAL_CRON_KEY/.test(text) ||
      /INTERNAL_[A-Z_]+_KEY/.test(text) ||
      /x-internal-key/i.test(text) ||
      /STAGING_[A-Z_]+_KEY/.test(text) ||
      /FIXTURE_[A-Z_]+_KEY/.test(text);

    if (!nonProdGuard || !secretGuard) {
      violations.push(
        `${rel}: performs admin password reset for arbitrary account without both a non-production guard (${nonProdGuard ? "ok" : "MISSING"}) and an internal secret guard (${secretGuard ? "ok" : "MISSING"})`,
      );
    }
  }
}

if (violations.length) {
  console.error("❌ Batch D1 no-UAT-password-reset check failed:");
  for (const v of violations) console.error("  - " + v);
  process.exit(1);
}

console.log(`✓ Batch D1 no-UAT-password-reset check passed (${files.length} edge-function files scanned)`);
