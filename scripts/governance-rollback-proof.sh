#!/usr/bin/env bash
# Governance Record — live rollback proof runner.
#
# Executes supabase/tests/governance_rollback_proof.sql via psql against the
# database pointed to by $GOVERNANCE_ROLLBACK_DATABASE_URL. The SQL file
# wraps its entire run in BEGIN; … ROLLBACK; so it leaves no residue.
#
# Exits non-zero if any RAISE NOTICE line indicates FAIL, if psql exits
# non-zero, or if no FAIL/PASS markers are observed (defensive — means the
# harness did not actually execute the proofs).
#
# Required env var:
#   GOVERNANCE_ROLLBACK_DATABASE_URL  postgres connection string for a
#                                     staging/test database. Must NOT be
#                                     production unless explicitly approved.
#
# Usage:
#   GOVERNANCE_ROLLBACK_DATABASE_URL=postgres://... ./scripts/governance-rollback-proof.sh

set -euo pipefail

SQL_FILE="supabase/tests/governance_rollback_proof.sql"

if [[ ! -f "$SQL_FILE" ]]; then
  echo "::error::Missing $SQL_FILE" >&2
  exit 2
fi

if [[ -z "${GOVERNANCE_ROLLBACK_DATABASE_URL:-}" ]]; then
  echo "::error::GOVERNANCE_ROLLBACK_DATABASE_URL is not set." >&2
  echo "  Set it to a staging/test postgres connection string and re-run." >&2
  exit 3
fi

# Never echo the URL.
echo "→ Running governance rollback proof against configured database…"

# Capture output; do not leak connection string. psql reads URL from env var,
# never passed on the command line.
OUT_FILE="$(mktemp)"
trap 'rm -f "$OUT_FILE"' EXIT

set +e
PGCONNECT_TIMEOUT=10 psql \
  "$GOVERNANCE_ROLLBACK_DATABASE_URL" \
  --set ON_ERROR_STOP=on \
  --no-psqlrc \
  --quiet \
  -f "$SQL_FILE" \
  >"$OUT_FILE" 2>&1
PSQL_EXIT=$?
set -e

# Print psql output (NOTICEs include PASS/FAIL lines). The SQL file itself
# does not echo secrets.
cat "$OUT_FILE"

if [[ $PSQL_EXIT -ne 0 ]]; then
  echo "::error::psql exited with status $PSQL_EXIT" >&2
  exit $PSQL_EXIT
fi

if grep -E '\bFAIL\b' "$OUT_FILE" >/dev/null; then
  echo "::error::Governance rollback proof reported FAIL." >&2
  exit 1
fi

PASS_COUNT=$(grep -cE '\bPASS\b' "$OUT_FILE" || true)
if [[ "$PASS_COUNT" -lt 6 ]]; then
  echo "::error::Expected ≥6 PASS markers (one per atomic family), saw $PASS_COUNT." >&2
  exit 1
fi

echo "✓ Governance rollback proof passed ($PASS_COUNT PASS markers)."
