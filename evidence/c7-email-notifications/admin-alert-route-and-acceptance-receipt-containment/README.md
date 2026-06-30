# C7.2 — Admin alert email route migration & acceptance-receipt containment

Status: `C7_2_EMAIL_ADMIN_ALERT_QUEUE_MIGRATION_AND_RECEIPT_CONTAINMENT_DEPLOYED_PENDING_VERIFICATION`

## Client decisions (received)

- **Decision 1: B** — Move admin alert emails to the same email route
  already working for normal platform emails.
- **Decision 2: A** — Do not resend the 8 old acceptance-receipt emails;
  mark them as historical records where the receipt exists but the old
  email was not sent.

Source: Daniel approval reply (attached to C7.2 request).

## Background

- The previous admin-alert email path in `notification-dispatch` issued
  a direct `POST https://api.resend.com/emails` request. This path was
  failing with `http_403` and was recorded as
  `dispatcher_unavailable` in `notification_channel_skipped_events`.
- The normal platform email path
  (`send-transactional-email` → pgmq `transactional_emails` →
  `process-email-queue`) was healthy and continued to deliver
  application emails.
- 8 historical acceptance receipts were created before any email
  dispatch wiring existed. Their receipt artifacts (signed payload,
  signature, attestation linkage, validity) remain intact; no email
  was dispatched at the time, which surfaced as `high` severity open
  `admin_risk_items` titled "Acceptance receipt &lt;id&gt; not notified".

## Implementation summary

### Part 1 — Admin alert email route (notification-dispatch)

- `notification-dispatch` no longer calls `https://api.resend.com/emails`
  directly. The email branch now invokes the existing
  `send-transactional-email` edge function with `templateName:
  "admin-alert"`, which enqueues onto the healthy platform queue.
- New React Email template:
  `supabase/functions/_shared/transactional-email-templates/admin-alert.tsx`,
  registered in `registry.ts` as `admin-alert`. Renders the existing
  subject / message / event_type / occurredAt / metadata verbatim. No
  marketing content, no upsell, no unsubscribe footer (the system
  appends one).
- Per-recipient idempotency key:
  `admin-alert-{event_type}-{recipient}-{ISOminute}` so any accidental
  double-fire within the same minute collapses to one queued email.
- `notification_dispatches` rows now carry
  `metadata.dispatcher = "platform_email_queue"`,
  `metadata.template_name = "admin-alert"`, and the idempotency key
  for cross-surface QA.
- Skip-audit rows now carry `extra.dispatcher = "platform_email_queue"`
  in place of the previous `http_status: 403` shape.
- **Old failed `http_403` rows are NOT automatically retried.** There
  is no replay loop and no reprocessing of historical
  `notification_channel_skipped_events`.
- Slack dispatch path is unchanged.
- Resend remains usable elsewhere in the codebase (e.g. infra-alerts,
  outreach send) but is no longer the admin-alert path.

### Part 2 — 8 historical acceptance-receipt items

Containment applied via SQL with the receipt update-guard inside one
transaction (`set_config('app.allow_risk_item_update', 'on', true)`).
No receipt artifact was modified; only metadata + risk-item rows.

For each receipt id:

```
d02021f0, 2b00ce28, 4063cd07, ff18d9dd,
3f99f403, 4bb122b6, ef66e1f2, 2d8ec2c6
```

- `acceptance_receipts.metadata.historical_email_dispatch` set to
  `{ state: "pre_dispatch_wiring_window",
     reason: "acceptance_receipt_pre_dispatch_wiring_window",
     note: "Receipt exists; historical email dispatch was not recorded",
     contained_at: now(), change_request: "C7.2" }`.
- Matching open `admin_risk_items`:
  - title rewritten from
    `Acceptance receipt <id> not notified` to
    `Acceptance receipt <id-8> — receipt exists; historical email dispatch was not recorded`.
  - severity lowered from `high` to `low`.
  - status set to `resolved`, `resolved_at = now()`.
  - description appended with a `[C7.2]` containment note.
  - metadata.c72_containment preserves original title + severity +
    receipt_id + `no_resend: true`.

## Confirmations

- No resend occurred. No call was made to the Resend API for any of the
  8 receipts. No row was enqueued onto `transactional_emails`.
- Receipts remain valid. `signed_payload`, `signature_hash`,
  `attestation_id`, `receipt_version`, `accepted_at`, `match_id`,
  `engagement_id`, `initiator_org_id`, `counterparty_org_id`,
  `counterparty_email`, `accepting_user_*` were not touched.
- No money, credit, balance, POI, WaD, refund, registry, or ledger
  mutation.
- No cron change. No reprocessing of old `http_403` skip rows.
- No mutation to unrelated tables.
- Wording now distinguishes "receipt exists" from "email not sent at
  the time".
- Duplicate alerts for the same 8 historical receipts no longer remain
  open at high severity (verified by post-run query — see below).

## Post-run verification

```sql
SELECT severity, status, title
FROM admin_risk_items
WHERE metadata ? 'c72_containment'
ORDER BY title;
```

Returned 8 rows, all `low` / `resolved`, all titled
`Acceptance receipt <id-8> — receipt exists; historical email dispatch was not recorded`.

```sql
SELECT id, metadata->'historical_email_dispatch'->>'state' AS state
FROM acceptance_receipts
WHERE substring(id::text,1,8) = ANY(
  ARRAY['d02021f0','2b00ce28','4063cd07','ff18d9dd',
        '3f99f403','4bb122b6','ef66e1f2','2d8ec2c6']
);
```

Returned 8 rows, all `state = pre_dispatch_wiring_window`.

## Deploys

- `send-transactional-email` (template registry change).
- `notification-dispatch` (Resend → queue migration).

## Runtime-confirmation criteria (NOT yet ticked)

Do not mark `RUNTIME_CONFIRMED` until:

1. A natural future admin alert flows through
   `notification-dispatch` → `send-transactional-email` →
   `process-email-queue` and lands as `status = sent` in
   `email_send_log` for `template_name = 'admin-alert'`.
2. No new `http_403` skipped event appears on the admin-alert path.
3. The 8 receipt items remain contained (no resend, no
   re-emergence as `open`/`high`).
