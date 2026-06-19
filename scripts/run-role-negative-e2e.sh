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

usage() {
  cat <<'EOF'
run-role-negative-e2e.sh — single end-to-end runner for the Role-Negative & E2E suite.

USAGE
  bash scripts/run-role-negative-e2e.sh [--help]

REQUIRED ENV (export before running)
  SUPABASE_URL                 Project URL (e.g. https://<ref>.supabase.co)
  SUPABASE_SERVICE_ROLE_KEY    Service-role key (admin; not exposed by Lovable Cloud)
  E2E_RN_PASSWORD              Password for seeded TEST/UAT users (≥12 chars)

OPTIONAL ENV
  WRITE_RUN_SUMMARY=1|0        Write run-summary.json next to the zip (default 1)
  EVIDENCE_OUT_DIR             Override output dir for the zip (default /mnt/documents)

WHAT IT DOES
  1. Seeds Phase 1 + Phase 2 fixtures → .env.role-negative
  2. Sources that env (orgs, users, record IDs, E2E_RN_ENV=live-demo)
  3. Runs the matrix coverage guard (static release gate)
  4. Runs the critical Playwright suite (role-negative + critical journeys)
  5. Packs the evidence zip
  6. Prints the skipped-test summary (incl. RN-DEF-06)
  7. Writes run-summary.json (counts + touched-real-data flags) next to the zip

OUTPUT
  Final two lines:
    ==> EVIDENCE ZIP: /mnt/documents/<run>.zip
    ==> RUN SUMMARY: /mnt/documents/<run>.run-summary.json
  Exit code mirrors the Playwright run (0 = green).

SAFETY
  Constrained to E2E_RN_ENV=live-demo with seeded/fingerprinted TEST/UAT rows and
  sandbox API keys. No real tenant data, payments, notifications, live providers,
  production API keys or compliance decisions are touched.
EOF
}

EVIDENCE_OUT_DIR_DEFAULT="${EVIDENCE_OUT_DIR:-/mnt/documents}"
ZIP_FORMAT="${EVIDENCE_OUT_DIR_DEFAULT}/role-negative-e2e-<run-id>.zip"
SUMMARY_FORMAT="${EVIDENCE_OUT_DIR_DEFAULT}/role-negative-e2e-<run-id>.run-summary.json"

show_env() {
  mask_len() { local v="${1:-}"; if [ -z "$v" ]; then echo "<unset>"; else echo "set (${#v} chars)"; fi; }
  echo "Required env (values not printed):"
  printf "  %-28s %s\n" "SUPABASE_URL"              "${SUPABASE_URL:-<unset>}"
  printf "  %-28s %s\n" "SUPABASE_SERVICE_ROLE_KEY" "$(mask_len "${SUPABASE_SERVICE_ROLE_KEY:-}")"
  printf "  %-28s %s\n" "E2E_RN_PASSWORD"           "$(mask_len "${E2E_RN_PASSWORD:-}")"
  echo
  echo "Optional env:"
  printf "  %-28s %s\n" "WRITE_RUN_SUMMARY" "${WRITE_RUN_SUMMARY:-1 (default)}"
  printf "  %-28s %s\n" "EVIDENCE_OUT_DIR"  "${EVIDENCE_OUT_DIR:-/mnt/documents (default)}"
  echo
  echo "Expected output paths:"
  echo "  evidence zip : ${ZIP_FORMAT}"
  echo "  run summary  : ${SUMMARY_FORMAT}"
}

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  usage
  exit 0
fi
if [ "${1:-}" = "--show-env" ]; then
  show_env
  exit 0
fi

# Upfront validation — collect all missing/invalid vars before failing.
MISSING=()
[ -z "${SUPABASE_URL:-}" ] && MISSING+=("SUPABASE_URL (e.g. https://<ref>.supabase.co)")
[ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ] && MISSING+=("SUPABASE_SERVICE_ROLE_KEY (admin service-role key)")
if [ -z "${E2E_RN_PASSWORD:-}" ]; then
  MISSING+=("E2E_RN_PASSWORD (≥12 chars, password for seeded TEST/UAT users)")
elif [ "${#E2E_RN_PASSWORD}" -lt 12 ]; then
  MISSING+=("E2E_RN_PASSWORD is set but only ${#E2E_RN_PASSWORD} chars — needs ≥12")
fi
if [ "${#MISSING[@]}" -gt 0 ]; then
  echo "ERROR: required env vars missing or invalid:" >&2
  for m in "${MISSING[@]}"; do echo "  - $m" >&2; done
  echo >&2
  echo "Export them in your shell, then re-run. See: bash scripts/run-role-negative-e2e.sh --help" >&2
  echo "To inspect what is currently set:  bash scripts/run-role-negative-e2e.sh --show-env" >&2
  exit 2
fi
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
