# Batch G — Notification & Customer Webhook Reliability

Status: **BATCH_G_NOTIFICATION_WEBHOOK_RELIABILITY_DEPLOYED_PENDING_VERIFICATION**

## Tracker items

| # | Issue | Prior state | New state |
|---|---|---|---|
| 23 | Customer webhook endpoint auto-disabled after 10 consecutive failures with no audit, no risk item, no notification, no infra-alert. Only a `console.warn`. | Open | Additive observability wired in without changing threshold or backoff. |
| 69 | Slack dispatch failures already recorded in `notification_channel_skipped_events` and in the dispatch audit row, but no infra-alert window and no explicit slack disposition on the response. | Contained | Explicit `slack_status` envelope field + infra-alert window added. |
| 29 | (Out of scope for this batch.) | Unchanged | Unchanged. |

## Changes

### Migration
- `supabase/migrations/<timestamp>_batch_g_webhook_auto_disable_observability.sql`
  - Rewrites `public.webhook_record_failure(uuid, integer)` while preserving:
    - default threshold `10`
    - atomic counter increment
    - idempotent trip (only trips when `disabled_at IS NULL`)
    - existing `TABLE(new_consecutive_failures integer, tripped boolean)` return shape
  - On the trip edge (active → inactive) additionally writes:
    - `audit_logs` row with action `webhook.endpoint.auto_disabled`, `entity_type='webhook'`, and metadata (endpoint_id, org_id, url, consecutive_failures, threshold, disabled_at).
    - `admin_risk_items` row with `kind='webhook_auto_disabled'`, severity `warning`, and dedup_key `webhook_auto_disabled:<endpoint>:<disabled_at>` (idempotent via `ON CONFLICT (dedup_key) DO NOTHING`).
    - One `notifications` row per user in `user_roles` with `role='platform_admin'`, linking to `/admin/webhooks` and referencing the endpoint.
  - Each observability insert is in its own `BEGIN...EXCEPTION WHEN OTHERS` block so an observability failure never breaks the atomic counter/trip contract.
  - Adds `admin_risk_items_dedup_key_unique` partial-unique index to support `ON CONFLICT`.

### Edge function edits
- `supabase/functions/webhooks/index.ts` (PATCH `/webhooks/:id`)
  - Now fetches `id, status, disabled_at` from the existing row.
  - When `status` flips from `inactive` → `active`:
    - Clears `disabled_at` and `consecutive_failures` in the update payload.
    - Writes a distinct `webhook.endpoint.reenabled` audit row with previous/new status, previous `disabled_at`, actor IP, and user agent.
  - All other PATCH semantics and the permission model are unchanged.

- `supabase/functions/infra-alerts/index.ts`
  - **Check 15 — Webhook Auto-Disable (1 hr):** counts `admin_risk_items` rows with `kind='webhook_auto_disabled'` in the last hour. `warning >= 1`, `critical >= 5`. Wrapped in try/catch.
  - **Check 16 — Slack Dispatcher Unavailable (1 hr):** counts `notification_channel_skipped_events` with `channel='slack'` and `reason='dispatcher_unavailable'` in the last hour. `warning >= 5`, `critical >= 20`. Wrapped in try/catch.
  - Neither check performs any outbound Slack, email, or webhook traffic; both are read-only counts.

- `supabase/functions/notification-dispatch/index.ts`
  - Introduces a `slackStatus: "sent" | "skipped_not_configured" | "failed" | "not_requested"` variable and returns `slack_status` in the response envelope alongside `dispatched` / `skipped`.
  - All existing behaviour preserved: Slack failures still land in `notification_channel_skipped_events` and in the dispatch audit row; email dispatch is unchanged; response remains `{ ok: true, ... }` because Slack is not a required channel.

### Tests / static guards
- `src/tests/batch-g-notification-webhook-reliability.test.ts` asserts the migration contracts (threshold preserved, audit row action, risk-item kind + dedup, notifications insert, EXCEPTION blocks) and the edge-function contracts (re-enable audit, two new infra-alert windows with correct thresholds and try/catch wrappers, `slack_status` envelope values).
- Existing `src/tests/batch-d-webhook-reliability.test.ts` still covers the threshold/backoff contracts — unchanged, so any accidental drift on those would still fail there.

## Behaviour before / after

| Scenario | Before | After |
|---|---|---|
| 9 consecutive failures | counter=9, endpoint remains active | unchanged |
| 10th consecutive failure (trip) | endpoint inactive, `console.warn` only | endpoint inactive + `audit_logs` row + `admin_risk_items` row + `notifications` rows for platform admins |
| 11th failure after trip | idempotent (no new trip, no dup risk item) | unchanged (dedup_key blocks duplicate risk item; trip flag false so no new inserts) |
| Success clears counter | works | unchanged |
| PATCH endpoint inactive → active | single `webhook.updated` audit row | `webhook.updated` + `webhook.endpoint.reenabled` audit row; `disabled_at` and counter cleared |
| Slack 5xx | recorded in `notification_channel_skipped_events`; response `{ok:true, dispatched:['email'], skipped:[{channel:'slack',...}]}` | same, plus `slack_status:'failed'` in response |
| Slack thrown error | same recording | plus `slack_status:'failed'` |
| Slack not configured | skipped event recorded | plus `slack_status:'skipped_not_configured'` |
| Infra-alerts run with 1+ auto-disable in last hour | no alert emitted | warning alert (or critical if ≥5) |
| Infra-alerts run with 5+ slack dispatcher failures in last hour | no alert emitted | warning alert (or critical if ≥20) |

## Confirmations

- No change to webhook failure threshold (`10`).
- No change to webhook retry/backoff timing (`webhook-retry` untouched).
- No real webhooks, emails, Slack messages, or provider calls were sent during apply.
- No change to RLS, grants, storage, cron schedules, payments, refunds, credits, token ledger, WaD, POI, lifecycle, reconciliation, retention, or legal holds.
- Batch F item #29 (registry/bank verification) was not touched.
- The new SQL function keeps the previous return shape so all existing callers (`_shared/webhooks.ts`, `webhook-retry/index.ts`) continue to receive `{new_consecutive_failures, tripped}` and need no code changes.
