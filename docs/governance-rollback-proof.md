# Governance Record — Live Rollback Proof

## What this proves

Empirical proof that the atomic `SECURITY DEFINER` RPC pattern actually
rolls back the business mutation when `gov_emit_event` raises.

For each atomic family, the harness:

1. Calls the production RPC with a payload crafted so `gov_emit_event`
   throws inside the same transaction.
2. Verifies that the business row (token balance, POI state, WaD row,
   collapse ledger row, dispute row, legal-hold row) is **not** present
   after the failure.
3. Records a `PASS` or `FAIL` notice per family.

The whole run is wrapped in `BEGIN; … ROLLBACK;` in
[`supabase/tests/governance_rollback_proof.sql`](../supabase/tests/governance_rollback_proof.sql),
so it leaves zero residue regardless of outcome.

## Atomic families covered

- Credit — `atomic_token_burn`
- Legal Hold — `atomic_legal_hold_apply`
- POI — `atomic_pois_transition`
- WaD — `atomic_wad_issue`
- Finality / Collapse — `atomic_collapse_record`
- Dispute — `atomic_dispute_open`

## NOT covered

- Payment webhooks — **sequential by design** (provider retries +
  best-effort canonical emission with risk-item escalation).
- Admin HQ decisions — **sequential by design** (post-RPC TS write with
  fail-closed guard).

These two surfaces are intentionally outside the atomic guarantee.

## Running it

### Locally / staging

```bash
export GOVERNANCE_ROLLBACK_DATABASE_URL='postgres://USER:PASS@HOST:PORT/DB'
npm run governance:rollback-proof
```

The script:

- Requires `GOVERNANCE_ROLLBACK_DATABASE_URL` and exits non-zero if absent.
- Calls `psql -f supabase/tests/governance_rollback_proof.sql`.
- Fails if any `FAIL` marker appears, if psql exits non-zero, or if
  fewer than 6 `PASS` markers are observed.
- Never prints the connection string.

### Expected success output

Six lines of the form:

```
NOTICE:  [1/6] PASS credit (atomic_token_burn): GOV_AUDIT_POSTURE_INVALID
NOTICE:  [2/6] PASS legal_hold (atomic_legal_hold_apply): ...
NOTICE:  [3/6] PASS poi (atomic_pois_transition): ...
NOTICE:  [4/6] PASS wad (atomic_wad_issue): ...
NOTICE:  [5/6] PASS collapse (atomic_collapse_record): ...
NOTICE:  [6/6] PASS dispute (atomic_dispute_open on match …): ...
ROLLBACK
✓ Governance rollback proof passed (6 PASS markers).
```

## Safety rules

- Run against **staging / test** databases unless production execution is
  explicitly approved by the release owner.
- The SQL file is non-destructive (`BEGIN; … ROLLBACK;`) — even a
  production run leaves no residue — but staging is the policy default.
- Never paste the connection string into chat, logs or PR descriptions.

## CI wiring

A GitHub Actions job named **`governance-rollback-proof`** is defined in
[`.github/workflows/ci.yml`](../.github/workflows/ci.yml). It runs only
when the repository secret `GOVERNANCE_ROLLBACK_DATABASE_URL` is
configured; otherwise it skips with a clear message rather than faking
success.

To activate the gate:

1. Add `GOVERNANCE_ROLLBACK_DATABASE_URL` as a repository secret
   pointing at a staging/test database.
2. Re-run the workflow. The job will execute the proof and fail the
   build if any family rolls forward instead of back.

Until that secret is configured, this remains a **documented manual
release gate** — the script is available locally but no CI job blocks
merges on it.
