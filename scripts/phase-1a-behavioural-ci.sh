#!/usr/bin/env bash
# ============================================================
# Phase 1A behavioural verification — CI gate.
#
# Runs the database-native behavioural proof against a disposable
# migrated database. Fails loudly if DATABASE_URL is not set OR the
# proof itself fails. Do NOT run against production.
#
# Usage (CI):
#   DATABASE_URL=postgres://... bash scripts/phase-1a-behavioural-ci.sh
#
# Usage (local, with `supabase start`):
#   DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
#     bash scripts/phase-1a-behavioural-ci.sh
# ============================================================
set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL is required." >&2
  echo "  This gate must run against an isolated migrated Postgres." >&2
  echo "  Locally: run 'supabase start' and export the resulting DB URL." >&2
  echo "  In CI:   set DATABASE_URL as a secret pointing at the test DB." >&2
  exit 2
fi

if echo "$DATABASE_URL" | grep -qiE '(prod|live|customer)'; then
  echo "ERROR: DATABASE_URL looks like a production database. Refusing." >&2
  exit 2
fi

PROOF="supabase/tests/phase_1a_support_behavioural_proof.sql"
if [ ! -f "$PROOF" ]; then
  echo "ERROR: missing proof file $PROOF" >&2
  exit 2
fi

echo "==> Running Phase 1A behavioural proof against $DATABASE_URL"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$PROOF"
echo "==> Phase 1A behavioural proof: PASSED"
