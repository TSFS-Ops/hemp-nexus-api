# SMS / WhatsApp Notification Channel Readiness Shell — Phase 1

**Status:** SMS_WHATSAPP_NOTIFICATION_READINESS_SHELL_PHASE_1_COMPLETE

## Scope (client-approved)

Phase 1 is a **readiness shell only**. The build does NOT:

- send SMS messages
- send WhatsApp messages
- call any external SMS provider API
- call any WhatsApp Business API
- store live provider credentials
- create provider webhooks
- expose live test sends
- expose SMS or WhatsApp as live client-facing delivery channels

Client-facing users continue to use **in-app and email** notifications only.
SMS and WhatsApp appear only on the internal admin readiness surface as
**Not Configured** or **Disabled**.

## Database (migration `20260621*_notification_channel_readiness`)

| Table | Purpose |
| --- | --- |
| `notification_channel_readiness` | One row per channel. SMS/WhatsApp pinned to `not_configured` by trigger. |
| `notification_channel_skipped_events` | Append-only safe-skip audit. Raw phone numbers rejected by trigger. |
| `manual_outreach_contact_logs` | Admin/support manual contact records — unknown-counterparty facilitation ONLY. Trigger enforces canonical label and masked contact. |
| `notification_channel_consent_states` | Readiness fields for channel consent + opt-out. No live enforcement in Phase 1. |

### Phase 1 hard guards (DB-enforced)

`notification_channel_readiness_phase1_guard()` rejects any insert/update on
SMS or WhatsApp that:
- enables `live_sending_enabled`
- enables `test_send_enabled`
- sets `status` to anything other than `not_configured` / `disabled`
- moves `credentials_status` off `not_configured`
- moves `webhook_status` off `not_configured`
- moves `provider_status` to `configured`

## Edge functions

| Function | Role |
| --- | --- |
| `notification-channel-readiness-list` | platform_admin / compliance_analyst read of all four channels. |
| `notification-channel-readiness-update` | platform_admin label/status (not_configured ↔ disabled) edits only. Rejects any client attempt to enable live sending, test sends, credentials or webhooks. |
| `notification-channel-skip-record` | Internal (service role / cron key) recorder for skipped SMS/WhatsApp evaluations. Validates against the 8-reason SSOT and rejects raw phone numbers. |
| `manual-outreach-contact-log` | platform_admin / support_admin only. Records manual SMS/WhatsApp/phone/in-person contact for unknown-counterparty facilitation cases. Masks phone, stores canonical safe label, emits `manual_outreach_logged` + (when engagement_complete) `unknown_counterparty_engagement_confirmed`. |

## Admin surface

Route: `/admin/notifications/channel-readiness` (platform_admin only).

Renders:
- Per-channel cards with provider / credentials / templates / webhook /
  live-sending / test-send status chips.
- The Phase 1 event→channel matrix (7 events).
- The 8 recognised skip reasons.
- Phase 1 control banner.

The page exposes no live-send, no test-send and no provider configuration
control.

## Audit vocabulary

- `notification_channel_readiness_viewed`
- `notification_channel_readiness_label_updated`
- `notification_channel_skip_recorded`
- `manual_outreach_logged`
- `unknown_counterparty_engagement_confirmed`

Provider message ID is always recorded as `not_applicable` in Phase 1.

## Role matrix

| Role | View readiness | Edit label | View skipped | Log manual contact | Mark engagement complete | Enable live send |
| --- | :-: | :-: | :-: | :-: | :-: | :-: |
| platform_admin | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ (blocked) |
| compliance_analyst | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ |
| support_admin | ✗ | ✗ | (via case context) | ✓ | ✓ | ✗ |
| developer/internal | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| requester / trader / counterparty | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |

## Workflow gates (unchanged)

POI / WaD progression remains gated by the existing engagement progression
helpers. Notification readiness, queued, sent, delivered, skipped or
failed status NEVER unlocks progression. For unknown-counterparty cases
only, the next step requires an authorised admin/support user to record a
manual contact log with `engagement_complete = true`.

## Build guards (added to prebuild)

- `check-notification-channel-readiness-parity.mjs` — TS ↔ Deno SSOT parity
- `check-notification-no-live-sms-whatsapp-providers.mjs` — bans Twilio / MessageBird / Vonage / Plivo / WhatsApp Cloud / WhatsApp Business / FB Graph etc.
- `check-notification-skipped-status-parity.mjs` — TS ↔ DB CHECK parity for skip reasons
- `check-manual-outreach-safe-label.mjs` — canonical "Izenzo logged manual contact…" wording

## Tests

`src/tests/batch-sms-whatsapp-readiness-shell-phase1.test.ts` covers:

- SSOT shape and channel set
- Phase 1 lock for SMS + WhatsApp
- 8 skip reasons present in both mirrors
- Canonical safe labels published
- Event matrix: zero SMS/WhatsApp system-sends, manual log allowed only for unknown-CP facilitation
- No live provider SDK or credential token in Phase 1 files
- No fetch to twilio / whatsapp / facebook graph hosts
- Update endpoint hard-rejects live/test/credentials/webhook payloads
- Skip recorder validates reason + rejects raw phones + writes `not_applicable` provider id
- Manual log endpoint restricts to platform_admin / support_admin and never writes a phrase like "SMS was sent"
- POI/WaD progression cannot be unlocked from notification status
- Admin page renders matrix + safe-label banner, exposes no test-send control
- Audit vocabulary present
- Phone masking behaves: `+27821234567` → `+27******567`

## UAT matrix (Phase 1 acceptance)

| # | Scenario | Expected outcome |
| --- | --- | --- |
| 1 | Admin opens `/admin/notifications/channel-readiness` | Sees SMS = Not Configured, WhatsApp = Not Configured. No send buttons. |
| 2 | Admin attempts to enable live sending via API | 400 `phase_1_locked`. |
| 3 | Workflow evaluates SMS for a POI reminder | `notification-channel-skip-record` writes `notification_not_in_phase_1`. POI is not unlocked. |
| 4 | Support_admin logs manual SMS contact on unknown-CP case | Row stored with canonical label. `manual_outreach_logged` audit emitted. |
| 5 | Trader user POSTs to `manual-outreach-contact-log` | 403 forbidden. |
| 6 | Manual log with `engagement_complete=true` | Emits `unknown_counterparty_engagement_confirmed`. |
| 7 | Skip recorder receives raw phone number | 400 `masked_contact_required`. |
| 8 | Client-facing surfaces | No SMS/WhatsApp delivery option visible. |

## Acceptance

All Phase 1 acceptance conditions satisfied:

- SMS + WhatsApp visible only as Not Configured / Disabled.
- Approved events fall back to in-app/email.
- Skip events are audited.
- Manual SMS/WhatsApp log allowed only for unknown-counterparty facilitation.
- POI/WaD gates do not unlock from notification status.
- No live SMS, no live WhatsApp, no credentials, no webhooks, no test sends.

**Final status:** `SMS_WHATSAPP_NOTIFICATION_READINESS_SHELL_PHASE_1_COMPLETE`
