# Batch D — D4 Step 1: Notification, Audit & Communication Preflight

**Status:** Planning only. No code, edge function, migration, UI, fixture, DOCX, or `notification-dispatch` change has been made.
**Predecessors:** D1 / D1.5 / D1.6 (schema), D2a (server enforcement, live-proven), D2b (binding-review resolver, live-proven), D3 (admin Pending Engagement UI, Human-Eyes QA passed).
**Purpose:** Decide *who* gets told, *when*, *how*, and *what must never be sent* for the new Batch D admin-controlled state transitions, **before** any notification logic is written.

---

## 1. Existing notification system (as-is)

| Concern | Where it lives | Notes |
|---|---|---|
| Central dispatcher | `supabase/functions/notification-dispatch/index.ts` | Internal only. Auth: `INTERNAL_CRON_KEY` header **or** service-role JWT. Reads `admin_settings.notifications` for `emailAlerts` toggle + `slackWebhook`. |
| Subject SSOT | `supabase/functions/_shared/email-subject.ts` (`clampSubject`) | 200-char ceiling, trace-tail preserved. Defensive clamp inside `notification-dispatch` writes `email.subject_defensively_truncated` audit when the caller forgot to clamp. Lint guard: `scripts/check-no-inline-subject-truncate.mjs`. |
| Skip audit | `supabase/functions/_shared/notification-skip-audit.ts` | `recordNotificationSkipped()` writes `notification_skipped` audit rows with a fixed reason vocabulary (`no_recipient`, `recipient_suppressed`, `email_disabled`, `slack_not_configured`, `dispatcher_unavailable`, `duplicate_suppressed`, etc.). Best-effort, never throws. |
| Idempotency | `supabase/functions/_shared/idempotency.ts` + `webhook_replay_guard` (Webhook Replay Protection memory) | `Idempotency-Key` header re-uses the prior response; `assertNotReplayed` blocks replayed inbound webhooks (409 `WEBHOOK_REPLAY`). |
| Outreach audit | `engagement_outreach_logs` (multi-purpose audit for any engagement outreach attempt or admin action). All writes in `poi-engagements/index.ts`: 14 call-sites covering create / send / patch / dispute / cancel-for-email-change / resolve-binding. |
| Append-only audit | `audit_logs` (org-scoped, JSON metadata). Used by `notification-dispatch` for `notification.dispatched`, by progression suppression for `challenge.progression_notification_suppressed`, and by every D2a/D2b/D3 server action. |
| Suppression | `suppressed_emails` table (bounce/complaint/unsubscribe). Honoured by transactional/email senders only — `notification-dispatch` itself sends to a fixed admin alias. |
| Progression suppression | `notification-dispatch` blocks any `progression.*` event whose match has an open or under-review challenge; suppression audit insert failure → fail-closed. |
| Channels in production | `email` (Resend, `Izenzo Alerts <alerts@notify.izenzo.co.za>` → `admin@izenzo.co.za`), `slack` (admin webhook). **No general per-user in-app notifications table exists today** — admin context is conveyed through `AdminPendingEngagementsPanel` queue and audit views. |
| Lifecycle digests | `lifecycle-scheduler/index.ts` invokes `notification-dispatch` for breach / overdue events on a cron. |

**Implication for D4:** there is a working dispatcher, a clean skip-audit vocabulary, and an outreach-log + audit-log substrate. There is **no** end-user in-app notification surface. Proposing per-org-user inbox UI in D4 would be net-new infrastructure and is out of scope for a safe first cut.

---

## 2. Batch D events that may need communication

Sourced from `poi-engagements/index.ts`, `engagement-state.ts`, `humanise-engagement-error.ts`, and the D3 dialogs.

| # | Event (canonical name) | Where it fires | Who triggers it |
|---|---|---|---|
| E1 | `engagement.binding_review_required` (transition into `binding_review_required`) | `poi-engagements` create / patch when ≥2 candidate orgs match named contact | System |
| E2 | `engagement.binding_review_resolved` (`confirmed_canonical` / `confirmed_external` / `rejected`) | `BindingReviewResolverDialog` → `poi-engagements/resolve-binding` | Platform admin |
| E3 | `engagement.disputed_being_named` | `DisputeEngagementDialog` → `poi-engagements/dispute` (sources: `counterparty_token`, `admin_report`, `support_ticket`) | Platform admin (or counterparty via signed token) |
| E4 | `engagement.cancelled_email_change` | `CancelForEmailChangeDialog` → `poi-engagements/cancel-for-email-change` | Platform admin |
| E5 | `engagement.email_change_blocked` (server returns `EMAIL_CHANGE_REQUIRES_CANCEL_RECREATE` on PATCH email) | `poi-engagements` PATCH guard | Org admin attempting an email edit on an outreach-bearing row |
| E6 | `outreach.blocked.contact_incomplete` | Send guard | Org admin clicking Send |
| E7 | `outreach.blocked.binding_review_pending` | Send guard | Org admin clicking Send |
| E8 | `outreach.blocked.disputed_being_named` | Send guard | Org admin clicking Send |
| E9 | (future, not yet modelled) `engagement.dispute_lifted` | Not implemented | n/a — flagged so D4b doesn't promise it |

> **Scope note:** "engagement_outreach_logs" already records E2–E8 as audit rows. The question D4 must answer is which of these audit events should *additionally* dispatch a human-readable message.

---

## 3. Per-event recommendation

Legend — Channel: `audit` (audit row only, no message), `queue` (visible in admin Pending Engagements panel), `in-app-admin` (toast/badge for platform admin session), `email-admin` (digest/immediate to platform admin alias), `email-org-admin` (transactional email to initiating org admin), `email-counterparty` (transactional email to outside party).

| # | Event | Notify? | Recipients | Channel(s) | Timing | Reasoning |
|---|---|---|---|---|---|---|
| E1 | binding_review_required | **Yes** | Platform admin only | `queue` + `in-app-admin` (badge count on Engagements tab); optional **daily digest** `email-admin` if backlog > 0 for >24h | Queue: immediate. Email: daily 09:00 UTC digest. | The initiating org and counterparty must not see candidate-org details — that would leak which registered orgs share a domain. Admin needs to act, but a per-event email is noisy. |
| E2 | binding_review_resolved | **Yes (admin only)** | Platform admin (audit confirmation), initiating org admin (neutral status) | `audit` always; `in-app-admin` toast on the dialog (already exists); **no email to org admin in D4b** — defer until in-app inbox exists | Immediate audit, no fan-out email | Resolution is internal admin housekeeping. Org admin's only visible change is the engagement progressing; they will see this in the existing engagement detail when they next return. |
| E3 | disputed_being_named | **Yes, carefully** | Platform admin (queue + immediate `email-admin`); initiating org admin (neutral, non-accusatory in-app + audit) | Admin: `queue` + immediate `email-admin`. Initiator: `audit` only in D4b; opt-in email in D4c. | Admin: immediate. Initiator: best deferred until in-app inbox. | Counterparty has objected to being named. Initiator must eventually know but **must not be told who disputed or why**. Wording must avoid "accusation". |
| E4 | cancelled_email_change | **Yes** | Platform admin (queue + audit), initiating org admin (in-app status only) | `audit`; admin queue tab `cancelled_email_change`; **no email** | Immediate audit | This is a deliberate corrective action. The org admin will be guided in-app to recreate; an email could read like a punishment. |
| E5 | email_change_blocked (server 409) | **No notification** | n/a — handled inline by `humaniseEngagementError` toast in `AddContactDialog` | n/a | Inline | The user is sitting in front of the dialog; an email would be redundant and confusing. |
| E6 | outreach.blocked.contact_incomplete | **No** | n/a | `audit` only (already written) | n/a | Pure form-validation feedback. |
| E7 | outreach.blocked.binding_review_pending | **No active dispatch** | n/a | `audit` only; surface as inline notice in the engagement view | n/a | Admin already sees the queue; org admin sees an inline banner. An email would imply the org did something wrong. |
| E8 | outreach.blocked.disputed_being_named | **No active dispatch in D4b** | n/a | `audit` only; inline neutral notice ("This counterparty has paused contact pending review.") | n/a | Same logic as E7, plus: emailing the org admin a "blocked because disputed" notice is the most sensitive wording surface in the batch — defer to D4c after Daniel signs off on copy. |
| E9 | dispute_lifted | **N/A** | — | — | — | Not implemented. D4 must not promise resolution notifications because there is no resolution path yet. |

**Hard rule (re-stated):** Under no circumstances does D4 send an email to the disputed counterparty after E3. The Webhook Replay Guard, send-guard, and dispatcher must all treat that recipient as suppressed for the lifetime of the dispute.

---

## 4. Safety rules (must-not list)

1. **Never re-contact a disputed counterparty** (E3 → recipient added to a per-engagement suppression set; checked by send guard *and* by `notification-dispatch` for any future channel).
2. **Never reveal candidate registered orgs** to either side of a binding review. The candidate JSON is admin-only.
3. **Never expose binding-review reasoning** (admin notes) to ordinary org members; restrict to `platform_admin` / `auditor` via `audit-logs` RLS path.
4. **Never imply guilt or wrongdoing.** Forbidden words in any D4 outbound copy: *accusation, accuse, guilty, liable, liability, wrongdoing, fraud, fraudulent, upheld, dismissed, winner, loser, blame, fault, violation, breach* (where "breach" is not a Pod breach term-of-art). Add a wording lint similar to `scripts/check-engagement-wording.mjs`.
5. **Never create legal reliance** before admin review: outbound copy must use "pending review", "paused for review", "awaiting platform review" — never "confirmed", "verified", "validated", "approved counterparty".
6. **Never email an unverified external counterparty** about a dispute or binding state. Only registered org admins receive any D4 email; external parties see only the existing token-based outreach pages.
7. **Never dispatch when audit insert fails** (already the established `notification-dispatch` pattern for progression suppression — extend to D4 events).
8. **Never bypass `clampSubject`** — every subject string concatenating engagement / org / commodity goes through it (per Email Subject Length Contract memory).
9. **Never write the disputed party's email or name into an admin-broadcast subject line** (PII in Slack/email subject is harder to redact later than body).
10. **Never reuse a `notification.dispatched` audit row to claim a non-dispatch** — skips must use `notification_skipped` with an explicit reason.

---

## 5. Suggested wording (drafts for review)

All wording uses Simple British Trade English (per Trade Terminology memory) and the canonical terms: **Pending Engagement**, **Binding review**, **Counterparty dispute**, **Email change cancellation**.

### E1 — Admin queue badge / digest
- **Subject (digest):** `Pending Engagements: binding review awaiting resolution`
- **Body:** "One or more Pending Engagements require a binding-review decision. Open the Engagements tab and select **Binding review required** to resolve."

### E2 — Admin in-app toast (already wired)
- **Confirmed canonical:** "Binding review resolved. The engagement is now linked to the confirmed organisation."
- **Confirmed external:** "Binding review resolved as an external party. The engagement remains unlinked to a registered organisation."
- **Rejected:** "Binding review rejected. The engagement is closed."

### E3 — Admin email (immediate)
- **Subject:** `Pending Engagement: counterparty dispute received`
- **Body:** "A counterparty has disputed being named on a Pending Engagement. The engagement has been paused for platform review. Open the Engagements tab and select **Disputed — being named**."

### E3 — Initiating org admin in-app notice (D4c, opt-in email later)
- "This Pending Engagement has been paused while the platform reviews a counterparty query. No further outreach will be sent until review is complete."
- Explicitly does **not** name the disputing party, the dispute reason, or the dispute source.

### E4 — Admin queue notice
- "Pending Engagement cancelled for email change. The initiating organisation can create a replacement engagement with the corrected email address."

### E7 / E8 — Inline org-admin notice
- E7: "Outreach is paused while the platform confirms the registered organisation associated with this contact. No action is required from you."
- E8: "Outreach is paused while a counterparty query is under platform review. No action is required from you."

> All of the above are **drafts**; final copy lands with Daniel before D4c.

---

## 6. Audit requirements (per event)

| # | `engagement_outreach_logs` | `audit_logs` | Other |
|---|---|---|---|
| E1 | `kind='binding_review_required'`, candidate orgs in metadata | `action='engagement.binding_review_required'`, `entity_type='engagement'` | none |
| E2 | `kind='binding_review_resolved'`, `resolution`, `selected_org_id`, admin notes | `action='engagement.binding_review_resolved.<resolution>'` | already written by D2b |
| E3 | `kind='disputed_being_named'`, `source`, redacted `token_hash` (no raw token) | `action='engagement.disputed'`, `metadata.source` | add per-engagement suppression flag (server-side check in send guard + dispatcher) |
| E4 | `kind='cancelled_email_change'`, `new_email` | `action='engagement.cancelled_email_change'` | none |
| E5 | `kind='email_change_blocked'`, `error_code='EMAIL_CHANGE_REQUIRES_CANCEL_RECREATE'` | not required (client-visible 409) | none |
| E6 | `kind='outreach_blocked'`, `reason='contact_incomplete'` | not required | already written |
| E7 | `kind='outreach_blocked'`, `reason='binding_review_pending'` | not required | already written |
| E8 | `kind='outreach_blocked'`, `reason='disputed_being_named'` | not required | already written |

Every dispatch must additionally write either `notification.dispatched` (success) or `notification_skipped` (with reason) — no silent paths.

---

## 7. Idempotency / duplicate prevention

1. **Admin-action retries** — D2b/D3 endpoints already accept `Idempotency-Key`. D4 dispatchers must **derive** their idempotency key from `(event_type, engagement_id, transition_version)` so a re-issued resolve does not produce a second email.
2. **Edge function retries** — `notification-dispatch` writes the `notification.dispatched` audit row in the same response path; a wrapper can check `audit_logs` for a prior matching `(event_type, entity_id, idempotency_key)` row before dispatching. (Cheap query; falls back to dispatch on race because Resend is itself idempotent on `Idempotency-Key` header for the email API call.)
3. **Replayed `Idempotency-Key`** — covered by `assertNotReplayed` (Webhook Replay Protection memory) for inbound webhooks; for outbound, key the audit-log dedupe on the same value.
4. **Lifecycle scheduler reruns** — digest queries must select rows where `kind='binding_review_required' AND created_at >= digest_window_start AND NOT EXISTS (audit_logs WHERE action='digest.binding_review_required.sent' AND metadata->>'window_start' = ...)`. Mirror the existing breach digest pattern in `lifecycle-scheduler`.

---

## 8. Stop conditions (fail-closed list)

D4 must refuse to dispatch and write `notification_skipped` (with the listed reason) when:

| Condition | Skip reason |
|---|---|
| Recipient missing or null | `no_recipient` |
| Recipient in `suppressed_emails` (bounce / complaint / unsubscribe) | `recipient_suppressed` |
| Recipient is the disputed counterparty for the same engagement | `recipient_suppressed` (extend reason vocabulary if needed: `disputed_counterparty_suppressed`) |
| Engagement still in `binding_review_required` and event is not E1/E2 | `lifecycle_noop` |
| Audit insert fails | **Fail closed (return 500)** — do not dispatch, do not skip-audit silently. Same pattern as progression suppression. |
| `RESEND_API_KEY` or Slack webhook unset | `dispatcher_unavailable` / `slack_not_configured` |
| Email field fails RFC-5321 / `.invalid` TLD check (already enforced in `CancelForEmailChangeDialog`) | `no_recipient` |
| `notification.emailAlerts` toggle off in `admin_settings` | `email_disabled` |

---

## 9. Recommended D4 implementation split

| Phase | Scope | Risk | Stop point |
|---|---|---|---|
| **D4a** | **Audit-only event catalogue.** Define canonical `event_type` strings, extend `engagement_outreach_logs.kind` enum if needed, write the per-engagement disputed-counterparty suppression check in the send guard. **No dispatcher changes.** Add wording-lint script (`scripts/check-d4-wording.mjs`). | Lowest — only audit & guard code | Live-proof harness `d4a-live-proof` covering E1–E8 audit rows |
| **D4b** | **In-app admin surface only.** Wire `notification-dispatch` to fan E1 (digest) + E3 (immediate) into the existing admin alias / Slack. No org-admin emails, no counterparty emails. | Low — uses existing dispatcher and admin alias only | Live-proof + Daniel sign-off on E1/E3 copy |
| **D4c** | **Org-admin emails for E3 only**, neutral wording, with per-engagement disputed-counterparty suppression and `Idempotency-Key` dedupe. Requires Resend transactional template registered through `email_domain--scaffold_transactional_email`. | Medium — first outbound to non-admin recipients | Daniel sign-off on copy + suppression test |
| **D4d** | **Client / demo walkthrough doc** (no DOCX in scope; Markdown only). Update `docs/product-guide.md` and admin runbook with the new states and what notifications they now produce. | Negligible | None |

D4c is the earliest point at which a production email reaches a non-admin. Do not collapse D4b and D4c.

---

## 10. Acceptance criteria (gating tests for D4 close)

Required *before* D4 is declared closed (not before each phase, but for the batch as a whole):

1. **Unit tests** (Vitest)
   - `d4-event-catalogue.test.ts` — every `event_type` string has exactly one definition and one wording entry.
   - `d4-wording-guard.test.ts` — forbidden-word list (section 4) rejects any draft string containing a banned token; runs in `npm run build` like the WaD status drift guard.
   - `d4-disputed-suppression.test.ts` — once E3 fires, any subsequent dispatch attempt to the disputed recipient returns `recipient_suppressed`.
   - `d4-idempotency.test.ts` — replaying the same `Idempotency-Key` writes one `notification.dispatched` row, not two.
2. **Edge function tests** (`d4a-live-proof`, `d4b-live-proof`, `d4c-live-proof`) — same harness pattern as `d2a-live-proof` / `d2b-live-proof`. Each prints PASS/FAIL, run_id, audit row IDs, cleanup confirmation.
3. **Suppression test** — a recipient in `suppressed_emails` cannot receive D4 email; produces `notification_skipped` with `recipient_suppressed`.
4. **Fail-closed test** — forced audit-insert failure aborts dispatch with 500; no Resend call observed.
5. **Regression** — full Vitest suite green; **zero** files changed under `supabase/functions/_shared/` paths exclusive to Batch C; `d2a-live-proof` and `d2b-live-proof` still green.
6. **No rating impact** — counterparty rating signal ledger unchanged; `npm run check:counterparty-rating-drift` (if present) green.
7. **No legacy disputes impact** — `src/tests/uat/journey-3-disputes.test.ts` still green.
8. **No MT-009 named-contact enforcement work** — diff confirms no edits to MT-009 surfaces.
9. **No DOCX, no fixtures, no D4 UI beyond admin queue badges** — diff review.
10. **Wording sign-off** — Daniel records approval of the final E1, E3, E4, E7, E8 copy in writing before D4c ships.

---

## STOP POINT: Awaiting approval before D4 implementation.
