#!/usr/bin/env bash
# Seeds the Role-Negative & E2E fixtures and prints shell exports.
#
# By default seeds BOTH phases:
#   Phase 1 — orgs, users, user_roles
#   Phase 2 — entities, trade_requests, matches, pois (DRAFT),
#             match_documents, api_clients, api_keys, export_requests
#
# Deferred (Phase 2b — must not be synthesised by a seeder):
#   wads            — needs sealed canonical payload + ledger chain
#   refund_requests — needs a paid token_purchase
# The runtime specs that target wad/refund skip cleanly with a reason.
#
# Required env:
#   SUPABASE_URL                 - https://<ref>.supabase.co
#   SUPABASE_SERVICE_ROLE_KEY    - admin key (operator-supplied)
#   E2E_RN_PASSWORD              - shared password for seeded users (≥12 chars)
#
# Optional env:
#   PHASE                        - 1 or 2 (default 2)
#
# Usage:
#   bash scripts/seed-role-negative-e2e.sh > .env.role-negative
#   source .env.role-negative
#   npm run test:e2e:coverage-guard
#   npm run test:e2e:critical
#   npm run test:e2e:evidence-pack
set -euo pipefail
: "${SUPABASE_URL:?SUPABASE_URL required}"
: "${SUPABASE_SERVICE_ROLE_KEY:?SUPABASE_SERVICE_ROLE_KEY required}"
: "${E2E_RN_PASSWORD:?E2E_RN_PASSWORD (≥12 chars) required}"
PHASE="${PHASE:-2}"

payload=$(printf '{"confirm":"RUN_SEED_ROLE_NEGATIVE_E2E","password":"%s","phase":%s}' "$E2E_RN_PASSWORD" "$PHASE")

resp=$(curl -fsS -X POST \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d "$payload" \
  "$SUPABASE_URL/functions/v1/seed-role-negative-e2e-fixtures")

echo "$resp" | python3 -c "import sys, json; r = json.load(sys.stdin); print(r['shell_env']) if r.get('ok') else (sys.stderr.write(json.dumps(r, indent=2) + '\n'), sys.exit(1))"
