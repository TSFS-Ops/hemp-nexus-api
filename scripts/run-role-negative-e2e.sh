#!/usr/bin/env bash
# Single end-to-end runner for the Role-Negative & E2E suite.
#
# Required env (exported in your shell before running):
#   SUPABASE_URL
#   SUPABASE_SERVICE_ROLE_KEY
#   E2E_RN_PASSWORD              (≥12 chars)
#
# Usage:
#   bash scripts/run-role-negative-e2e.sh
#
# Prints the evidence zip path on the final line.
set -euo pipefail
: "${SUPABASE_URL:?SUPABASE_URL required}"
: "${SUPABASE_SERVICE_ROLE_KEY:?SUPABASE_SERVICE_ROLE_KEY required}"
: "${E2E_RN_PASSWORD:?E2E_RN_PASSWORD (≥12 chars) required}"

echo "==> Seeding Phase 1 + Phase 2 fixtures"
bash scripts/seed-role-negative-e2e.sh > .env.role-negative

echo "==> Sourcing seeded env (orgs, users, record IDs, E2E_RN_ENV=live-demo)"
set -a; source .env.role-negative; set +a

echo "==> Matrix coverage guard (static release gate)"
npm run test:e2e:coverage-guard

echo "==> Critical Playwright suite (role-negative + critical journeys)"
npm run test:e2e:critical || RUN_STATUS=$?

echo "==> Packing evidence zip"
ZIP_OUTPUT=$(npm run --silent test:e2e:evidence-pack 2>&1 | tee /dev/stderr)
ZIP_PATH=$(echo "$ZIP_OUTPUT" | grep -oE '/mnt/documents/[^[:space:]]+\.zip' | tail -n1)

echo "==> Skipped-test summary"
node -e '
  const fs = require("fs");
  const g = require("path");
  const root = "test-evidence/role-negative-e2e";
  if (!fs.existsSync(root)) { console.log("(no evidence dir)"); process.exit(0); }
  const runs = fs.readdirSync(root).filter(d => fs.statSync(g.join(root, d)).isDirectory()).sort();
  const latest = runs[runs.length - 1];
  const p = g.join(root, latest, "evidence.jsonl");
  if (!fs.existsSync(p)) { console.log("(no evidence.jsonl in", latest, ")"); process.exit(0); }
  const rows = fs.readFileSync(p, "utf8").trim().split("\n").map(JSON.parse);
  const skipped = rows.filter(r => r.pass_fail_status === "skipped");
  console.log("skipped:", skipped.length, "of", rows.length);
  for (const r of skipped) console.log(" -", r.test_name, "::", r.notes || r.failure_reason || "");
'

echo
echo "==> EVIDENCE ZIP: ${ZIP_PATH:-<not found — check npm run test:e2e:evidence-pack output above>}"
exit "${RUN_STATUS:-0}"
