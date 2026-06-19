# Batch 10 — Automatic Invite-Aging Trigger (Evidence Pack)

**Final status:** `BATCH_10_AGED_INVITE_TRIGGER_ACCEPTED_EXISTING_IMPLEMENTATION`

This batch is satisfied by the existing **facilitation-invite-unopened-detector**
implementation (originally shipped as Batch 11 in the facilitation track). No new
code was written for Batch 10; this evidence pack documents and verifies the
existing artefacts against the Batch 10 specification.

---

## 1. Existing implementation (artefact inventory)

| Concern | Artefact | Lines |
|---|---|---|
| Edge function (detector) | `supabase/functions/facilitation-invite-unopened-detector/index.ts` | 250 |
| Pure shared helpers (decision + payload) | `supabase/functions/_shared/facilitation-invite-unopened.ts` | 148 |
| Contract guard (prebuild) | `scripts/check-invite-unopened-detector-contract.mjs` | 125 |
| Vitest unit suite | `src/tests/facilitation-batch11-invite-unopened-detector.test.ts` | 159 |
| Audit-name SSOT (Deno) | `supabase/functions/_shared/facilitation-case-state.ts:178` | — |
| Audit-name SSOT (browser) | `src/lib/facilitation-case-state.ts:299` | — |
| Next-step kind SSOT (Deno) | `supabase/functions/_shared/facilitation-case-state.ts:184` | — |
| Next-step kind SSOT (browser) | `src/lib/facilitation-case-state.ts:304` | — |

Canonical audit name pinned in **both** SSOTs:
`facilitation_case.invite_unopened_flagged`

Canonical next-step kind pinned in **both** SSOTs:
`invite_unopened_3bd`

---

## 2. Business rule — confirmed

The detector implements the Batch 10 / questionnaire rule:

- [x] Invite sent **at least 3 business days ago**
  (`INVITE_UNOPENED_BUSINESS_DAYS_THRESHOLD = 3`)
- [x] Invite **unopened or unaccepted** (engaged statuses `opened`, `clicked`,
  `replied`, `responded` are skipped via `ENGAGED_SEND_STATUSES`)
- [x] Threshold = **3 business days** (constant exported and unit-tested)
- [x] **Weekend-aware business-day helper** (`businessDaysBetween` skips UTC
  Saturday/Sunday — unit test "(9b) Fri→Mon = 1 business day" proves it)
- [x] **No public-holiday calendar** — none exists on the platform yet; matches
  the Batch 7 SLA helper convention. Recorded as "business-day helper, no
  public-holiday calendar yet".
- [x] **Accepted / engaged invites skipped** — `decideFlag` returns
  `{action:"skip", reason:"engaged"}`
- [x] **Failed / bounced / suppressed / rejected sends skipped** —
  `FAILED_SEND_STATUSES` → `reason:"delivery_failed"`
- [x] **Terminal parent case skipped** — `reason:"terminal_case"` (uses
  `TERMINAL_STATUSES` SSOT)
- [x] **Already-flagged sends skipped** — `reason:"already_flagged"` driven by
  pre-query for existing `next_step_type = "invite_unopened_3bd"` rows
- [x] **SLA-reminder-covered cases skipped** — `reason:"sla_reminder_covered"`
  using `SLA_REMINDER_COVERING_REASONS` (`first_outreach_overdue`,
  `follow_up_outreach_overdue`) so we never double-flag
- [x] **Never-sent skipped** — `reason:"never_sent"`
- [x] **Too-recent skipped** — `reason:"too_recent"` when `bd < 3`
- [x] **Duplicate case creation avoided** — detector writes a *next-step row*
  against the existing parent case rather than creating a new case; the
  contract guard explicitly forbids `facilitation_cases.update(...)` and
  there is no `facilitation_cases.insert(...)` path

---

## 3. Safety model — confirmed

Verified by re-reading the edge function and re-running the contract guard
(`node scripts/check-invite-unopened-detector-contract.mjs` → `OK`).

- [x] **`INTERNAL_CRON_KEY` gate** present (`gateInternalCronKey()` call enforced
  by the contract guard)
- [x] **Dry-run by default** — `const live = body.live === true` enforced by the
  contract guard (regex match required)
- [x] **Idempotency** — `already_flagged` short-circuit prevents a second row
  for the same `outreach_send_id`; re-running the detector is a no-op once a
  row exists
- [x] **No status mutation** on `facilitation_cases` — contract guard rejects
  any `from("facilitation_cases")…update(` pattern
- [x] **No outreach resend / no email / no SMS / WhatsApp / Slack / webhooks** —
  contract guard's `FORBIDDEN` list blocks `send-transactional-email`,
  `notification-dispatch`, `resend.emails.send`, `api.resend.com`,
  `smtp.|sendgrid|twilio`, `slack.com/api`, `whatsapp`, `\bsms\b`,
  `webhook[-_ ]?dispatch`
- [x] **No POI creation** — blocks `atomic_generate_poi` and
  `pois…insert(`
- [x] **No WaD mutation** — blocks `wads…insert(`
- [x] **No match mutation** — blocks `matches…insert(`,
  `atomic_engagement_transition`, `atomic_accept_bind`
- [x] **No token / payment / refund mutation** — blocks
  `atomic_token_burn`, `atomic_token_credit`, `token_ledger…insert(`,
  `token_purchases…insert(`, `payments?…insert(`, `refunds?…insert(`

The detector's only write is an **insert into the next-step queue** (an internal
admin task row) with the canonical kind `invite_unopened_3bd` and the audit
event `facilitation_case.invite_unopened_flagged`, both gated behind
`live === true`.

---

## 4. Tests and guards

### 4.1 Vitest unit suite

`src/tests/facilitation-batch11-invite-unopened-detector.test.ts` — **16/16
passing** (5 `businessDaysBetween` cases + 8 `decideFlag` cases + 3 SSOT /
payload / forbidden-import cases). Coverage map:

| # | Case |
|---|---|
| 1 | exactly 3 business days unopened qualifies |
| 2 | <3 business days does not qualify (`too_recent`) |
| 3a | opened send skipped (`engaged`) |
| 3b | replied send skipped (`engaged`) |
| 4 | terminal parent case skipped (`terminal_case`) |
| 5 | already-flagged send skipped (`already_flagged`) |
| 6 | SLA-reminder-covered case skipped (`sla_reminder_covered`) |
| 7 | delivery-failed send skipped (`delivery_failed`) |
| 8 | never-sent send skipped (`never_sent`) |
| 9a | Mon→Thu = 3 business days |
| 9b | Fri→Mon = 1 business day (weekends excluded) |
| 9c | same day = 0 |
| 9d | reversed range = 0 |
| 10 | canonical audit name + kind pinned in browser SSOT |
| 11 | detector module imports no forbidden side-effect paths |
| 12 | `buildNextStepRow` yields the canonical payload shape |

### 4.2 Contract guard

`scripts/check-invite-unopened-detector-contract.mjs` — runs in the prebuild
chain. Fails the build if any of these regress:

1. detector edge function file or shared helper missing
2. `INTERNAL_CRON_KEY` gate or `gateInternalCronKey()` call missing
3. dry-run default removed
4. `invite_unopened_3bd` kind not pinned in shared module, detector, or either SSOT
5. `facilitation_case.invite_unopened_flagged` not pinned in both SSOTs
6. detector references any forbidden side-effect path (full list in §3)
7. detector attempts to `update(...)` `facilitation_cases`

### 4.3 Audit name SSOT

`facilitation_case.invite_unopened_flagged` is listed in both the Deno SSOT
(`supabase/functions/_shared/facilitation-case-state.ts:178`) and the browser
SSOT (`src/lib/facilitation-case-state.ts:299`), and Test #10 asserts the
pinning.

### 4.4 Prebuild guard status

`node scripts/check-invite-unopened-detector-contract.mjs` →
`[check-invite-unopened-detector-contract] OK` at the time of evidence capture.

---

## 5. Evidence outcome

**`BATCH_10_AGED_INVITE_TRIGGER_ACCEPTED_EXISTING_IMPLEMENTATION`**

The existing facilitation-invite-unopened-detector satisfies every Batch 10
requirement (intake source, aging rule, idempotency, duplicate prevention,
admin-visible source via `next_step_type = "invite_unopened_3bd"` + audit name,
requester privacy by virtue of next-step rows being admin-only, negative
controls enforced by contract guard, and a 16-case unit suite).

## 6. Caveat (non-blocking)

**Operational caveat:** There is no admin-facing "Run aged invite detection"
button in the UI in this pass. The detector currently runs through the
protected edge function `facilitation-invite-unopened-detector`, gated by
`INTERNAL_CRON_KEY` and dry-run-by-default, callable by the internal scheduled
path or by an operator invoking the function with the cron key and
`{"live": true}`.

This is **not** treated as a blocker because a safe operational path exists
(the gated edge function). If a visible admin button is required later, it can
be added as a thin wrapper that POSTs to the same edge function — no detector
logic change required.

---

_Evidence captured against the live working tree; contract guard and vitest
suite both green at capture time._
