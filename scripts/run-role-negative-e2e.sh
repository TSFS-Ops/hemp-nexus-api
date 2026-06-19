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
#
# Optional flags:
#   WRITE_RUN_SUMMARY=1   (default 1) write run-summary.json next to the zip
#   WRITE_RUN_SUMMARY=0   to disable
set -euo pipefail
: "${SUPABASE_URL:?SUPABASE_URL required}"
: "${SUPABASE_SERVICE_ROLE_KEY:?SUPABASE_SERVICE_ROLE_KEY required}"
: "${E2E_RN_PASSWORD:?E2E_RN_PASSWORD (≥12 chars) required}"
WRITE_RUN_SUMMARY="${WRITE_RUN_SUMMARY:-1}"

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

SUMMARY_PATH=""
if [ "$WRITE_RUN_SUMMARY" = "1" ] && [ -n "${ZIP_PATH:-}" ]; then
  echo "==> Writing run-summary.json"
  SUMMARY_PATH="${ZIP_PATH%.zip}.run-summary.json"
  ZIP_PATH="$ZIP_PATH" SUMMARY_PATH="$SUMMARY_PATH" RUN_STATUS="${RUN_STATUS:-0}" E2E_RN_ENV="${E2E_RN_ENV:-live-demo}" node -e '
    const fs = require("fs");
    const path = require("path");
    const root = "test-evidence/role-negative-e2e";
    const runs = fs.existsSync(root)
      ? fs.readdirSync(root).filter(d => fs.statSync(path.join(root, d)).isDirectory()).sort()
      : [];
    const latest = runs[runs.length - 1] || null;
    const jsonl = latest ? path.join(root, latest, "evidence.jsonl") : null;
    const rows = jsonl && fs.existsSync(jsonl)
      ? fs.readFileSync(jsonl, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse)
      : [];
    const count = (s) => rows.filter(r => r.pass_fail_status === s).length;
    const passed = count("passed");
    const failed = count("failed");
    const skipped = count("skipped");
    const total = rows.length;
    const skippedTests = rows
      .filter(r => r.pass_fail_status === "skipped")
      .map(r => ({ test_name: r.test_name, reason: r.notes || r.failure_reason || null }));
    const summary = {
      generated_at: new Date().toISOString(),
      evidence_zip: process.env.ZIP_PATH,
      run_id: latest,
      environment: process.env.E2E_RN_ENV,
      exit_status: Number(process.env.RUN_STATUS || "0"),
      counts: { total, passed, failed, skipped },
      skipped_tests: skippedTests,
      touched_real_data: {
        real_tenant_data: false,
        real_payments: false,
        real_notifications: false,
        live_providers: false,
        production_api_keys: false,
        real_compliance_decisions: false,
        basis: "Suite is constrained to E2E_RN_ENV=live-demo with seeded/fingerprinted TEST/UAT rows and sandbox API keys; any deviation aborts the run before side-effects.",
      },
    };
    fs.writeFileSync(process.env.SUMMARY_PATH, JSON.stringify(summary, null, 2) + "\n");
    console.log("wrote", process.env.SUMMARY_PATH);
  '
fi

echo
echo "==> EVIDENCE ZIP: ${ZIP_PATH:-<not found — check npm run test:e2e:evidence-pack output above>}"
[ -n "$SUMMARY_PATH" ] && echo "==> RUN SUMMARY: $SUMMARY_PATH"
exit "${RUN_STATUS:-0}"
