# Platform admin checklist — Facilitation Phase 2 (destructive flow)

Tick when verified live in a real preview session as a `platform_admin`.
"PASS (live)" requires a corresponding screenshot in `./screenshots/`.

> Use **seeded UAT fixtures only**. Do not run these against live client or production-like
> data, and do not send real outreach to a real counterparty during verification unless
> explicitly authorised.

## Access & navigation

- [x] PASS (live) — Can access `/hq/facilitation` _(screenshot 01)_
- [x] PASS (live) — Can open a case drawer from the queue _(screenshot 02)_
- [x] PASS (live) — Outreach tab is present and renders Candidates + Add candidate _(screenshot 03)_
- [x] PASS (live) — Outreach email templates panel renders below the queue _(screenshot 04)_
- [x] PASS (live) — Do-not-contact rules panel renders below the queue _(screenshot 04)_
- [x] PASS (live) — Case drawer subtitle, Timeline, OwnerPicker, and outcome picker are all plain English (no raw enum codes, no role tokens) _(screenshot 02, re-captured post EMB-6)_

## Template lifecycle

- [ ] OPERATOR-VERIFY — Can approve a draft template
- [ ] OPERATOR-VERIFY — Can archive an approved template
- [ ] OPERATOR-VERIFY — Archived templates do not appear in candidate-send selector

## Candidate + gate

- [ ] OPERATOR-VERIFY — Can add a candidate (clean counterparty) and see a **green** gate result
- [ ] OPERATOR-VERIFY — Gate result for a previously-contacted counterparty renders as **warning** in plain English
- [ ] OPERATOR-VERIFY — Gate result for a DNC-blocked counterparty renders as **block** in plain English

## Send

- [ ] OPERATOR-VERIFY — Cannot send while a warning is unacknowledged
- [ ] OPERATOR-VERIFY — Can send one valid outreach
- [ ] OPERATOR-VERIFY — Duplicate-send guard blocks a second send with the same idempotency key

## Escalation

- [ ] OPERATOR-VERIFY — Can open an escalation
- [ ] OPERATOR-VERIFY — Send is blocked while escalation is open
- [ ] OPERATOR-VERIFY — Resolve/Reopen escalation controls are NOT visible to platform_admin

## DNC

- [ ] OPERATOR-VERIFY — Can add a DNC rule (email / domain / organisation)
- [ ] OPERATOR-VERIFY — Revoke DNC control is NOT visible to platform_admin
