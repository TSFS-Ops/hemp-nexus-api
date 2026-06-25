# cron_invoke correlation-id hardening — Phase 1 (outreach-only)

**Status:** `CRON_INVOKE_CORRELATION_HARDENING_PHASE_1_DEPLOYED_PENDING_TICK`

## Why this batch exists

C6.2 converted `outreach-sla-monitor-hourly` (jobid 17) to
`public.cron_invoke()` and seeded `cron_heartbeats.outreach-sla-monitor`.
Runtime verification then showed a fidelity gap, not a functional gap:

- The outreach edge function ran. Digests dispatched at 09:00 and 13:00 UTC,
  `poi_engagements.sla_reminder_sent_at` / `sla_reminder_count` updates
  matched legitimate digest counts, and `admin_audit_logs` showed
  `outreach.sla_digest_dispatched` rows for those ticks.
- However, `cron_heartbeats.outreach-sla-monitor.last_status` was `failed`
  with `last_error = 'DNS timeout of 5000 ms reached'` and
  `last_http_status = NULL`.
- `net._http_response` for the captured `last_request_id` had
  `status_code = NULL` and a DNS-timeout `error_msg`. Sibling pg_net rows
  in the same top-of-hour burst returned 200.

`cron_invoke()` calls `net.http_post` exactly once and records the single
returned request id; `cron_reconcile_heartbeats()` correctly reconciled
exactly that id. The visible failure was the pg_net response row chosen by
the bookkeeping, not the work the edge function actually performed.

**Rollback of C6.2 was rejected** — the conversion itself is correct
(removes the hard-coded anon bearer and gives C4 a heartbeat row).
**Broader C6 conversions are paused** until heartbeat correlation is
hardened, so the same false-failed pattern is not propagated to financial
or lifecycle jobs.

## Phase 1 scope (this batch)

- Outreach-only edge-side witness + reconciler fallback.
- No schedule shift.
- No additional cron job conversions.
- No witness rollout to other edge functions.
- No new `cron_run_events` table.
- No manual edge invocations, no manual emails, no business-table mutations
  in migration.

## What changed

### Migration

`supabase/migrations/20260625135237_40964f86-6099-4dd6-8723-4a142a1d8e2a.sql`

- `ALTER TABLE public.cron_heartbeats`
  - `ADD COLUMN IF NOT EXISTS last_correlation_id uuid NULL`
  - `ADD COLUMN IF NOT EXISTS last_metadata jsonb NULL`
  Additive only; no PK change; no rewrite of existing rows.
- `CREATE OR REPLACE FUNCTION public.cron_invoke(p_job_name, p_url, p_body)`
  - Signature and `RETURNS bigint` unchanged.
  - `v_run_id uuid := gen_random_uuid()`.
  - Posts `COALESCE(p_body,'{}'::jsonb) || jsonb_build_object('cron_run_id', v_run_id, 'cron_job_name', p_job_name)`.
  - Calls `net.http_post` exactly once; stores the returned request id.
  - Upserts `cron_heartbeats` with `last_correlation_id = v_run_id` and
    `last_metadata = { cron_job_name, url, pg_net_request_id, correlation_written_at }`.
  - Missing-secret branch preserved; now also writes
    `last_metadata.missing_secret = true`.
- `CREATE OR REPLACE FUNCTION public.cron_reconcile_heartbeats()`
  - Existing pg_net 2xx → `success` path unchanged for all jobs.
  - New outreach-only fallback: when `job_name = 'outreach-sla-monitor'`
    AND `last_correlation_id IS NOT NULL` AND pg_net reports
    `error_msg IS NOT NULL` OR `status_code IS NULL/non-2xx`, look up a
    matching `admin_audit_logs` row in the window
    `[last_run_at - 1 minute, last_run_at + 10 minutes]` where
    `action = 'cron.outreach_sla_monitor_tick'`,
    `details->>'cron_run_id' = last_correlation_id::text`,
    `details->>'outcome' = 'ok'`.
  - On witness hit:
    - `last_status = 'success_with_pg_net_warning'`
    - `last_error = NULL`
    - `last_metadata` merged with
      `pg_net_warning`, `witness_action`, `witness_seen_at`,
      `reconciled_via = 'edge_witness'`.
  - On no witness, **existing** failure behaviour is preserved.
- C4 risk-item branch updated so `success_with_pg_net_warning` is treated
  the same as `success` for auto-resolution and does **not** open a
  failed/high-severity risk item. The "failed" branch is unchanged.

### Edge function — outreach only

`supabase/functions/outreach-sla-monitor/index.ts`

- Reads `cron_run_id` and `cron_job_name` from the JSON request body.
- Defines `emitWitness(outcome, extras)` that inserts a single
  `admin_audit_logs` row:
  - `admin_user_id = null`
  - `action = 'cron.outreach_sla_monitor_tick'`
  - `target_type = 'cron_job'`
  - `target_id = null`
  - `details` includes `cron_run_id`, `cron_job_name`,
    `source = 'outreach-sla-monitor'`, `outcome`, `request_id`,
    `created_by = 'cron_invoke_correlation_phase_1'` plus run shape
    (`included`, `overdue_total`, `threshold_hours`, etc.).
- Emits the witness on:
  - `digest_disabled` early-return (outcome `ok`).
  - Zero-eligible path (outcome `ok`, `included = 0`).
  - Successful digest dispatch (outcome `ok`, `included = ids.length`).
  - `digest_send_failed` 502 path (outcome `error`).
  - Top-level catch (outcome `error`).
- Witness is **only** emitted when invoked via `cron_invoke()` (i.e. when
  `cron_run_id` is present). Manual ad-hoc admin POSTs do not produce a
  witness — they cannot be mistaken for a cron run.
- Witness insert failure is logged but does not block the handler's
  existing response — preserves current error posture.
- Existing digest, recheck, SLA-update, audit and dual-write logic is
  unchanged.

## C4 / infra-alerts posture

Existing C4 logic in `public.cron_reconcile_heartbeats()` only opens a
"Cron job failed" risk item when `last_status = 'failed'`. The new
`'success_with_pg_net_warning'` status therefore:

- does **not** open a high-severity failed alert;
- triggers the same `system_resolve_cron_risk_items` auto-resolution as
  `'success'`;
- carries the pg_net warning detail in `last_metadata` for later
  observability.

No new alerting was created in this batch.

## Tests

`src/tests/cron-invoke-correlation-hardening-phase-1.test.ts` pins:

- schema additions are present and non-destructive;
- no `cron_run_events` table created in this phase;
- `cron_invoke` signature, single `net.http_post`, correlation
  generation/injection, heartbeat persistence, missing-secret branch;
- reconciler witness fallback is outreach-scoped, uses
  `cron.outreach_sla_monitor_tick`, matches on `cron_run_id` +
  `outcome = 'ok'`, uses the `-1m..+10m` window, sets
  `success_with_pg_net_warning`, clears `last_error`, stores warning
  metadata, treats new status as non-failed for C4;
- existing `failed` branches preserved when no witness exists;
- outreach edge function reads correlation, defines `emitWitness`, writes
  the witness on zero-work, digest-dispatched, send-failed and catch
  paths, preserves existing `outreach.sla_digest_dispatched` audit, adds
  no retries;
- migration does not touch schedule / active flag;
- migration writes no business tables.

## Deployment posture and verification

- **No edge function was manually invoked.**
- **No outreach emails were sent by this deploy.**
- **No `poi_engagements`, `audit_logs`, `notification_*`, `email_send_log`,
  `acceptance_receipts`, `wads`, `matches`, `pois`, `token_*`,
  `refund_requests`, `payment_disputes` rows were mutated by the
  migration.**

Runtime verification — **pending next hourly tick**. At/after that tick,
inspect:

- `cron_heartbeats.outreach-sla-monitor`: `last_correlation_id` populated;
  `last_metadata` carries `cron_job_name`, `pg_net_request_id`, `url`.
- `admin_audit_logs` contains exactly one
  `cron.outreach_sla_monitor_tick` row with
  `details->>'cron_run_id'` matching the heartbeat.
- If pg_net DNS-timed-out but witness exists: heartbeat reads
  `success_with_pg_net_warning`; no new high-severity risk item; no
  duplicate digest.
- If pg_net returned 200: heartbeat reads `success` (legacy path).
- No new business mutations beyond normal scheduled execution.

C6.2 must remain **not** runtime-confirmed until a post-hardening tick
demonstrates either `success` or witness-backed `success_with_pg_net_warning`.

## Deferred — Phase 2

- Shift outreach schedule from `0 * * * *` to `5 * * * *` to dodge
  top-of-hour pg_net contention.
- Roll the same correlation-witness pattern to the remaining
  cron-invoked edge functions (lifecycle-scheduler,
  dispatch-acceptance-receipts, webhook-retry, engagement-reminder,
  burn-poi-reconciliation, infra-alerts, sentry-heartbeat,
  balance-drift-reconciliation, side-effect-reconciliation,
  transaction-reconciliation, p5-governance-sla-monitor).
- Re-evaluate the case for a dedicated `cron_run_events` table once the
  witness pattern is in place across all jobs.

## Known remaining limitations

- Only `outreach-sla-monitor` benefits from the witness fallback. Every
  other job remains exposed to the same pg_net DNS-timeout false-failed
  pattern; the C6 pause is the correct mitigation until Phase 2.
- The witness uses `admin_audit_logs` for storage. If retention or
  volume becomes a concern, Phase 3 may introduce `cron_run_events`.
- The fallback window is `-1m..+10m` around `last_run_at`. If a witness
  is delayed beyond +10m (long-running run), it will not be matched and
  the heartbeat will record `failed`. Acceptable for an hourly job that
  normally completes in seconds.
