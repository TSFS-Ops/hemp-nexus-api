#!/usr/bin/env bash
# Seeds the Role-Negative & E2E Phase-1 fixtures and prints shell exports.
#
# Phase 1: users + orgs + user_roles. Record-level fixtures (trade,
# match, POI, WaD, document, refund, governance export, API key) are
# deferred to Phase 2 and tracked in docs/role-negative-e2e-coverage.md.
#
# Required env:
#   SUPABASE_URL                 - e.g. https://<ref>.supabase.co
#   SUPABASE_SERVICE_ROLE_KEY    - admin key
#   E2E_RN_PASSWORD              - shared password for all seeded users (≥12 chars)
#
# Usage:
#   bash scripts/seed-role-negative-e2e.sh > .env.role-negative
#   source .env.role-negative
#   npm run test:e2e:roles
set -euo pipefail
: "${SUPABASE_URL:?SUPABASE_URL required}"
: "${SUPABASE_SERVICE_ROLE_KEY:?SUPABASE_SERVICE_ROLE_KEY required}"
: "${E2E_RN_PASSWORD:?E2E_RN_PASSWORD (≥12 chars) required}"

payload=$(printf '{"confirm":"RUN_SEED_ROLE_NEGATIVE_E2E","password":"%s"}' "$E2E_RN_PASSWORD")

resp=$(curl -fsS -X POST \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d "$payload" \
  "$SUPABASE_URL/functions/v1/seed-role-negative-e2e-fixtures")

echo "$resp" | python3 -c "import sys, json; r = json.load(sys.stdin); print(r['shell_env']) if r.get('ok') else (sys.stderr.write(json.dumps(r, indent=2) + '\n'), sys.exit(1))"
