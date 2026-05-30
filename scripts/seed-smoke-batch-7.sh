#!/usr/bin/env bash
# Seeds the Admin Export Controls Batch 7 smoke fixture pack and prints
# shell exports the smoke harness can consume directly.
#
# Required env:
#   SUPABASE_URL                 - e.g. https://<ref>.supabase.co
#   SUPABASE_SERVICE_ROLE_KEY    - admin key (do NOT commit)
#   SMOKE_PASSWORD               - shared password for all 4 accounts (≥12 chars)
#
# Usage:
#   bash scripts/seed-smoke-batch-7.sh > .env.smoke-b7
#   source .env.smoke-b7
#   npm run smoke:admin-export-controls
#   cat evidence/admin-export-controls-batch-7-live-e2e-smoke.json
#
set -euo pipefail
: "${SUPABASE_URL:?SUPABASE_URL required}"
: "${SUPABASE_SERVICE_ROLE_KEY:?SUPABASE_SERVICE_ROLE_KEY required}"
: "${SMOKE_PASSWORD:?SMOKE_PASSWORD (≥12 chars) required}"

payload=$(printf '{"confirm":"RUN_SEED_SMOKE_BATCH_7","password":"%s"}' \
  "$SMOKE_PASSWORD")

resp=$(curl -fsS -X POST \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d "$payload" \
  "$SUPABASE_URL/functions/v1/seed-smoke-batch-7-fixtures")

# Print the shell-ready exports to stdout; diagnostics to stderr.
echo "$resp" | python3 -c "import sys, json; r = json.load(sys.stdin); print(r['shell_env']) if r.get('ok') else (sys.stderr.write(json.dumps(r, indent=2) + '\n'), sys.exit(1))"
