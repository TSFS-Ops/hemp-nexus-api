#!/usr/bin/env bash
# Seeds the Smoke A–D fixture pack and prints shell exports.
#
# Required env:
#   SUPABASE_URL                 - e.g. https://<ref>.supabase.co
#   SUPABASE_SERVICE_ROLE_KEY    - admin key
#   SMOKE_PASSWORD               - shared password for all 3 accounts (≥12 chars)
# Optional:
#
# Usage:
#   bash scripts/seed-smoke-a-d.sh > .env.smoke
#   source .env.smoke
#   npm run smoke:daniel
set -euo pipefail
: "${SUPABASE_URL:?SUPABASE_URL required}"
: "${SUPABASE_SERVICE_ROLE_KEY:?SUPABASE_SERVICE_ROLE_KEY required}"
: "${SMOKE_PASSWORD:?SMOKE_PASSWORD (≥12 chars) required}"

payload=$(printf '{"confirm":"RUN_SEED_SMOKE_A_D","password":"%s"}' \
  "$SMOKE_PASSWORD")

resp=$(curl -fsS -X POST \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d "$payload" \
  "$SUPABASE_URL/functions/v1/seed-smoke-a-d-fixtures")

# Print the shell-ready exports to stdout; diagnostics to stderr.
echo "$resp" | python3 -c "import sys, json; r = json.load(sys.stdin); print(r['shell_env']) if r.get('ok') else (sys.stderr.write(json.dumps(r, indent=2) + '\n'), sys.exit(1))"
