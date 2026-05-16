# Launch Runbook

> Operational source of truth for production go-live. Combine with `RELEASE_GATE.md` (15-min pre-ship checklist) and `docs/closeout-report.md` (what shipped). This runbook is for the **launch event** and **first 24 hours**.

## 0. Roles & sign-off

| Sign-off | Owner | Evidence required |
|---|---|---|
| Engineering | Lead engineer | `npm run test:regression` green, `npm run build` green, this runbook §1–§6 ticked |
| Compliance / Operations | Ops lead | `docs/deferred-policy-register.md` reviewed, HealthBoard Closeout Drift tile green |
| Client / Izenzo | Client signatory | `docs/handover.md` acknowledged, deferred-policy register signed |

No tier ships without all three sign-offs and attached evidence (terminal output / screenshots).

---

## 1. Pre-launch command list (engineering)

Run **in order**:

```bash
# 1. Repo-contract proof
npm run test:regression        # vitest run src/tests/batch-*.test.ts
npm run build                  # runs all 17 prebuild static guards + vite build
npm run check:drift            # layout/footer/back-button drift

# 2. Optional: full test sweep
bunx vitest run                # everything, including non-batch tests
```

All three must exit 0. Attach the terminal output to the release ticket.

### Prebuild static guards enforced by `npm run build`

- `check-routes.mjs`
- `check-edge-function-paths.mjs`
- `check-no-inline-subject-truncate.mjs`
- `check-docs-no-zar-billing.mjs`
- `check-docs-staleness.mjs`
- `check-operational-visual-tokens.mjs`
- `check-match-lifecycle-mirror.mjs`
- `check-legacy-admin-rls.mjs`
- `check-webhook-callsite-idempotency.mjs`
- `check-fx-no-importers.mjs`
- `check-bypass-callsites.mjs`
- `check-public-page-imports.mjs`
- `check-edge-function-rpc-coverage.mjs`
- `check-csv-export-audit.mjs`
- `check-batch-suite-presence.mjs` (Batch W)
- `check-release-gate-sync.mjs` (Batch W)

---

## 2. Backend confirmations (ops)

| Check | How | Pass criterion |
|---|---|---|
| Migrations applied | Compare highest `supabase/migrations/*.sql` timestamp to live DB `schema_migrations` | Live ≥ repo |
| Edge functions deployed | Lovable Cloud → Functions list against `supabase/functions/*` | All present at current commit |
| Secrets configured | `require-secrets` helper response on a probe edge function | `status: "ok"` (or documented `degraded`) |
| Cron heartbeats | `select kind, last_run_at from cron_heartbeats` | All listed jobs ran within their window (see §3) |

### Critical scheduled jobs (must have recent heartbeat)

- `burn-poi-reconciliation`
- `balance-drift-reconciliation`
- `side-effect-reconciliation`
- `transaction-reconciliation`
- `cron-heartbeat-reconcile`
- `sentry-heartbeat`
- `email-log-anonymise`
- `lifecycle-scheduler`

If any heartbeat is stale, do not proceed.

---

## 3. Closeout drift snapshot

```bash
node scripts/closeout-snapshot.mjs
```

- Writes a dated artefact to `docs/closeout/YYYY-MM-DD-closeout-snapshot.md`.
- Calls `public.closeout_drift_summary()` against the live DB env.
- Only treat output as **live evidence** when run against the live DB; the script labels it so.

**Pass criterion:** open critical drift count = 0. Open lower-severity items must be acknowledged in writing in the release ticket.

Cross-check: HealthBoard → Closeout Drift tile is green (not rose, not amber).

---

## 4. Production safety sanity (ops)

| Check | How | Pass criterion |
|---|---|---|
| Test-mode bypass off in prod | `select * from admin_settings where key='test_mode_bypass'` | All flags `false` in production tier |
| Seeders refused | `curl` `seed-daniel-fixtures` on production → expect 403 `SEED_PRODUCTION_REFUSED` | 403 + audit row in `admin_audit_logs` |
| Demo orgs excluded | HQ → Revenue panel header | Shows "demo excluded" flag |
| Billing availability | Desk → Billing panel | Tier shows live USD pricing, no fallback banner |
| Sentry heartbeat | Sentry project → cron monitor | Last beat within 5 min |

---

## 5. Smoke tests (mixed)

Manual smoke per `RELEASE_GATE.md` sections 2–6 plus:

- Sign in → Desk → New Trade Request → save draft → reopen. **Pass:** draft persists.
- Admin → Engagements → open pending row → countdown visible.
- HealthBoard → all tiles render, Closeout Drift = green, no rose tiles.

---

## 6. Rollback

Trigger rollback if **any** of:
- Closeout Drift tile turns rose for >15 min.
- Critical reconciliation risk item opens and does not auto-close in 2 cycles.
- Edge function error rate >2% over 10 min.
- Sentry heartbeat goes stale.

Rollback steps:
1. Lovable: Publish → Update → roll to previous successful publish.
2. Backend migrations: if a migration is at fault, revert by applying a forward-compatible "undo" migration; never `DROP` in production without dual sign-off.
3. Edge functions: redeploy the previous commit's `supabase/functions/*` set.
4. Open a `release_rollback` audit row with the trigger reason.
5. Re-run §3 (closeout snapshot) and confirm drift cleared before re-enabling traffic.

---

## 7. First-24-hour watch

- Poll HealthBoard every 30 min for the first 4 hours, then hourly.
- Check `cron_heartbeats` at T+6h, T+12h, T+24h.
- Re-run `node scripts/closeout-snapshot.mjs` at T+24h and attach to the release ticket.

---

## 8. Evidence to attach before client sign-off

- Output of `npm run test:regression`.
- Output of `npm run build` (showing all prebuild guards green).
- The dated artefact from `scripts/closeout-snapshot.mjs`.
- Screenshot of HealthBoard with Closeout Drift = green.
- `docs/deferred-policy-register.md` with each item annotated **Accepted / Deferred-to-Tplus / Rejected** by the client.
- Sign-off block from §0 completed.
