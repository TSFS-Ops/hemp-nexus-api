# PayFast Enterprise Operations Runbook

**Audience:** platform admins, finance/admin operators, support operators, auditors, developer on-call.
**Scope:** operational handling of PayFast on Izenzo once the settlement-tracking layer is live.
**Status:** operational reference — no code, no config, no wallet/ledger mutations.

> PayFast is the only customer-facing payment provider on Izenzo. Paystack remains admin-only / internal / legacy and must never be surfaced to customers.

---

## 1. Purpose of the runbook

PayFast on Izenzo operates in **two distinct layers** that must never be conflated:

1. **Payment confirmation layer** — PayFast tells Izenzo "the customer has paid." This is delivered by the PayFast ITN (Instant Transaction Notification). On successful ITN, the customer's Izenzo wallet is credited and a `token_purchases` record is written.
2. **Bank settlement layer** — the actual funds land in Izenzo's Nedbank account, on PayFast's settlement cycle, net of fees. This is a separate downstream event.

**Wallet crediting ≠ bank settlement.** A customer can hold credits before PayFast has settled the underlying money to Izenzo. Finance's job is to close that gap and record evidence. Nothing in this runbook allows anyone to move money between the two layers manually.

This runbook explains: what to check, where to check, what statuses mean, what to do when things go wrong, when to escalate, what not to touch, and what evidence to retain.

---

## 2. Roles and responsibilities

| Role | Can do | Must not do |
|---|---|---|
| **platform_admin** | Full access to reconciliation console. Can mark settlement `confirmed`, `delayed`, `exception`, `cancelled`. Can add bank refs and notes. Approves emergency disable and secret rotation. | Never manually adjusts wallet balances. Never edits `token_purchases` or `token_ledger`. |
| **finance/admin operator** (finance_admin if provisioned — see §16) | Daily/weekly reconciliation. Adds bank references. Marks `confirmed` when bank evidence exists. Marks `delayed` / `exception` with notes. Exports reports. | Never credits wallets. Never marks `confirmed` without a bank statement line. Never edits historical PayFast or ledger rows. |
| **auditor** | Read-only across reconciliation console, `token_purchases`, `token_ledger`, `payment_settlements`, `audit_logs`, `refund_requests`, `admin_risk_items`. Can export. | Never writes. Never edits notes. |
| **support operator** | Reads customer's purchase history and payment status. Uses approved customer-facing wording (§13). Raises risk items when a customer reports a payment issue. | Never discusses settlement status with customers. Never quotes internal ZAR/FX mechanics. Never touches wallet, ledger, or settlement records. Never mentions Paystack. |
| **developer / on-call** | Investigates logs and edge-function traces per §15. May redeploy edge functions per change control. | Never edits `token_purchases`, `token_ledger`, or `payment_settlements` rows to "fix" a customer. Fixes go through migrations and audited RPCs. |
| **PayFast external contact** | Provider-side reference lookup, ITN replay, settlement schedule questions, secret rotation coordination. | N/A — external. |

**Golden rule:** only `platform_admin` and (once provisioned) `finance_admin` may set a settlement to `confirmed`, and only with a matching bank statement reference recorded in the note.

---

## 3. Normal daily operating procedure

Run once per business day, ideally after Nedbank statement refresh.

1. Open **PayFast Reconciliation Console** (`/hq/revenue/reconciliation`).
2. Review **Awaiting Settlement** — purchases where PayFast has confirmed but bank settlement is still within expected window.
3. Review **Overdue / Delayed** — items past the expected settlement date (see §16 threshold). Mark `delayed` with a note if still within tolerance; escalate per §8 otherwise.
4. Review **Exceptions** — anything already flagged; work each to closure or hand-off.
5. Pull the latest Nedbank statement lines for the day. Match PayFast batch/settlement references to statement narrations.
6. For each matched line, **add the bank reference** to the settlement row.
7. Only after a bank reference is attached, **mark `confirmed`**.
8. Export the day's confirmed and outstanding lists if required by finance policy.
9. Check **Refund Requests** and **Disputes** panels — action per §9.
10. Check **Admin Risk Items** for any PayFast-tagged items opened by support in the last 24h.
11. Record notes on any row that required judgement. Notes are the operator's audit trail.

---

## 4. Weekly finance reconciliation procedure

Run once per week (recommended: Monday, covering the prior Mon–Sun).

Reconcile the following six views and confirm they agree within tolerance:

1. **PayFast confirmed payments** (provider dashboard export for the period).
2. **Izenzo `token_purchases`** where PayFast status = success (via admin revenue export).
3. **Izenzo wallet credits** (`token_ledger` credit entries tied to those purchases).
4. **`payment_settlements`** rows for the period, grouped by status.
5. **Nedbank statement** settlement lines from PayFast.
6. **Refunds / disputes** issued or opened in the period.

**Source-of-truth hierarchy (highest to lowest):**

1. **Nedbank bank statement** — the only proof that money reached Izenzo.
2. **PayFast provider dashboard / settlement report** — provider's system of record for what they collected and paid out.
3. **Izenzo `payment_settlements`** — Izenzo's operational tracking record.
4. **Izenzo `token_purchases`** — proof of a confirmed customer payment intent.
5. **Izenzo `token_ledger`** — proof credits were issued to the customer wallet.

If layers disagree, trust the higher layer and open a risk item; never rewrite a lower layer to match a higher one manually.

Produce a weekly reconciliation pack: totals per source, list of unmatched items, list of exceptions still open, sign-off by finance lead.

---

## 5. Live smoke-test procedure

A **controlled small-value live PayFast test** proves the full pipeline including bank settlement. Do this after any material change to PayFast configuration, secret rotation, or edge-function redeploy touching payments.

**Before test:**
- Confirm no active PayFast incident on the status page.
- Confirm sandbox test already passed (§6).
- Approver: `platform_admin` (finance lead informed).
- Amount: smallest amount agreed with finance (see §16 — placeholder pending confirmation, e.g. R10–R25 equivalent).
- Tester uses a real Izenzo account clearly tagged internally (e.g. `qa-payments@izenzo.co.za`).

**During test:**
1. Initiate a normal checkout in production.
2. Complete payment on PayFast with a real card.
3. Capture the PayFast provider reference from the confirmation screen.
4. Confirm redirect back to Izenzo and success UI.

**Verification checks:**
5. ITN received → `token_purchases` row shows success.
6. Wallet credit visible in the tester's purchase history and balance.
7. `payment_settlements` row exists with status `expected` and correct expected-settlement date.
8. On the actual settlement date, Nedbank line appears; match reference and mark `confirmed`.

**Recording the test:**
- Add a note on the settlement row: `LIVE SMOKE TEST — approver <name>, date, reason`.
- Log the test in the ops journal with the PayFast reference, purchase id, settlement id, and bank reference.
- Do **not** refund into the customer wallet or delete the row. The credits stay on the internal QA account. Finance excludes tagged internal QA accounts from revenue reporting.

---

## 6. Sandbox test procedure

Use sandbox for:
- Verifying checkout flow after a UI change.
- Verifying ITN handler behaviour after an edge-function redeploy.
- Verifying secret/config wiring before a live rotation.

Sandbox **proves**: checkout initiation, PayFast redirect, ITN receipt, `token_purchases` write, wallet credit path.

Sandbox **does not prove**: real bank settlement, real fee deduction, real settlement timing, real dispute handling.

**Sandbox records must never be used as live settlement evidence** and must never appear in a finance reconciliation pack. If a sandbox row leaks into production data, flag it and open a risk item — do not delete it.

---

## 7. Settlement statuses

The `payment_settlements` layer uses the following operational statuses:

### `expected`
- **Meaning:** PayFast has confirmed the payment; funds are within the expected settlement window and have not yet landed in Nedbank.
- **Who sets it:** system, on ITN success.
- **Evidence needed:** none beyond the linked `token_purchases` row.
- **Allowed next steps:** → `confirmed` (once bank ref attached), → `delayed`, → `exception`, → `cancelled` (only if PayFast reverses).
- **Do not:** mark `confirmed` before bank evidence exists.

### `confirmed`
- **Meaning:** Funds have landed in Nedbank and a bank reference has been recorded on the row.
- **Who sets it:** `platform_admin` or `finance_admin` (see §16).
- **Evidence needed:** Nedbank statement line reference, matched amount, matched date.
- **Allowed next steps:** terminal for the happy path. Only a refund or dispute can supersede.
- **Do not:** un-confirm to "clean up." Corrections happen via a new note plus a risk item.

### `delayed`
- **Meaning:** Past expected settlement date but within operational tolerance; awaiting bank line.
- **Who sets it:** `platform_admin` / `finance_admin`.
- **Evidence needed:** operator note stating expected vs actual delay and any PayFast-side confirmation.
- **Allowed next steps:** → `confirmed` when funds land, → `exception` if it breaches the escalation threshold.
- **Do not:** leave `delayed` older than the escalation threshold without escalating.

### `exception`
- **Meaning:** Something is wrong: amount mismatch, missing funds beyond tolerance, provider-side error, reference conflict.
- **Who sets it:** `platform_admin` / `finance_admin`.
- **Evidence needed:** note describing the exception category (§8), operator name, timestamp, and any linked risk item / PayFast ticket id.
- **Allowed next steps:** → `confirmed` (after resolution and bank evidence), → `cancelled` (only if PayFast reverses the payment).
- **Do not:** self-resolve by mutating wallet, ledger, or `token_purchases`.

### `cancelled`
- **Meaning:** PayFast reversed or voided the payment before settlement; funds will not arrive.
- **Who sets it:** `platform_admin` (with PayFast reversal evidence).
- **Evidence needed:** PayFast reversal reference, provider communication, note on customer impact.
- **Allowed next steps:** terminal. If the customer's wallet was credited, follow the refund/dispute path in §9 to handle credit exposure — do not debit the wallet directly.
- **Do not:** mark `cancelled` for internal convenience.

---

## 8. Exception types and actions

For each exception: **likely meaning → immediate action → owner → escalation → customer wording (if applicable) → evidence to retain.**

1. **PayFast paid but no settlement record**
    - Likely: ITN succeeded but the settlement row wasn't created (system gap) or PayFast dashboard shows the payment differently.
    - Immediate: verify `token_purchases` for the reference; open risk item.
    - Owner: finance operator → developer on-call.
    - Escalation: developer if row genuinely missing.
    - Customer: "Your payment has been received and your credits are available. Our internal finance reconciliation is in progress."
    - Evidence: PayFast ref, purchase id, ITN log id.

2. **Settlement expected but overdue**
    - Likely: PayFast batch delayed or bank processing lag.
    - Immediate: mark `delayed` with note; check PayFast dashboard for batch status.
    - Owner: finance operator.
    - Escalation: if past threshold (§16), escalate to platform_admin and PayFast contact.
    - Evidence: expected date, actual date, PayFast batch reference.

3. **Settlement marked exception**
    - Immediate: read the note; act per the specific sub-category below.
    - Owner: whoever set it, until closed.
    - Escalation: platform_admin if unresolved within 1 business day.

4. **Bank reference missing**
    - Likely: operator hasn't matched the Nedbank line yet.
    - Immediate: match and attach; do not mark `confirmed` without it.
    - Owner: finance operator.

5. **Amount mismatch (bank vs PayFast net)**
    - Likely: fee variance, batch aggregation, partial refund.
    - Immediate: mark `exception`, note both amounts, do not mark `confirmed`.
    - Owner: finance operator → platform_admin.
    - Escalation: PayFast contact if unexplained.
    - Evidence: bank line, PayFast settlement report line, fee statement.

6. **PayFast reference mismatch**
    - Likely: batch/settlement reference on the bank line doesn't match any known PayFast batch.
    - Immediate: hold, do not confirm anything; request clarification from PayFast.
    - Owner: platform_admin.
    - Evidence: bank narration screenshot, PayFast response.

7. **Wallet credited but settlement not confirmed** (normal state — timing gap)
    - Immediate: none until settlement date passes; then follow §8.2.
    - Customer wording: see §13 "credits received".

8. **PayFast confirmed but wallet not credited**
    - Likely: ITN processing failure or wallet-crediting path error.
    - Immediate: **do not manually credit.** Open risk item and page developer on-call.
    - Owner: developer on-call.
    - Escalation: platform_admin.
    - Evidence: PayFast ref, ITN log id, `token_purchases` state.

9. **Duplicate ITN attempt**
    - Likely: PayFast retry; system should de-dupe.
    - Immediate: verify only one `token_purchases` row and one wallet credit exist for the reference.
    - Owner: developer on-call if duplication occurred.

10. **Refund open**
    - Route to §9. Do not touch settlement until refund is decided.

11. **Dispute open**
    - Route to §9. Freeze operator actions on that settlement row beyond adding notes.

12. **Customer asks why they received credits but finance has not confirmed bank settlement**
    - Customer wording: "Your credits are available and your payment is confirmed. Internal finance reconciliation is a separate process and doesn't affect your account."
    - Do not explain the settlement layer to the customer.

13. **PayFast checkout abandoned**
    - Likely: user closed the window; no ITN.
    - Immediate: none. No `token_purchases` row should exist.
    - Customer wording: see §13 "payment cancelled".

14. **PayFast ITN delayed or missing**
    - Likely: provider delay or handler outage.
    - Immediate: check ITN handler logs; check PayFast dashboard for the payment.
    - Owner: developer on-call.
    - Escalation: platform_admin, PayFast contact.

15. **PayFast secret / config suspected broken**
    - Likely: recent rotation misapplied, wrong environment, or provider-side change.
    - Immediate: pause new smoke tests; do not disable PayFast without approval (§10).
    - Owner: developer on-call → platform_admin.
    - Confirm current operational toggle with engineering before any disable.
    - Evidence: failing ITN samples, last rotation date, environment.

---

## 9. Refund and dispute procedure

**Refunds** are linked to an original PayFast payment and therefore to an original settlement row.

Before approving/settling a refund:
- Confirm the original `token_purchases` row exists and is not itself in dispute.
- Confirm the original `payment_settlements` row's status (`expected`, `confirmed`, `exception`, `cancelled`) — a refund on an unconfirmed settlement needs platform_admin approval.
- Confirm spent-credit exposure: if the customer has already spent part of the credited amount, follow product policy for partial refund handling. **Do not debit the wallet manually** to reconcile — raise a risk item and route to platform_admin.
- Record the PayFast refund reference on the refund request row.

**Spent credits operationally:**
- Treat as an accounting exposure, not an operator-editable field.
- Log a note; escalate if the exposure exceeds the finance-defined threshold (see §16).

**Disputes:**
- Track under `refund_requests` / disputes surface with the PayFast dispute reference.
- Escalate to developer if any system-side anomaly is suspected (missing ITN, duplicate credit).
- Escalate to PayFast for provider-side clarification or evidence submission.

**Audit notes must record:** who reviewed, decision, evidence links (PayFast ref, bank line if applicable, risk item id), timestamp.

---

## 10. Emergency disable procedure

Signs that disablement may be needed:
- Sustained ITN failures.
- Provider-side outage confirmed by PayFast.
- Suspected compromised secret.
- Systemic amount or reference mismatch across multiple payments.

Procedure:
1. Approver: `platform_admin` only, with developer on-call informed.
2. **Confirm the current operational toggle with engineering** — do not assume a specific switch. This runbook does not define code switches.
3. Communicate internally: `#ops`, finance lead, support lead, on-call.
4. Users should see a clear message that new purchases are temporarily unavailable. Existing wallets and credits are unaffected. Do not expose internal cause.
5. Before re-enabling:
   - Root cause understood and documented.
   - Sandbox test passes (§6).
   - Live small-value smoke test passes (§5).
   - Bank settlement of the smoke test confirmed on the next cycle.
6. **Wallet and ledger records must not be edited during or after an incident.** All corrections happen through audited RPCs, migrations, or documented refund flows.

---

## 11. Secret rotation procedure

For PayFast passphrases / merchant credentials.

1. **Approval:** platform_admin + developer on-call. Notify finance lead and support lead.
2. **Timing:** low-traffic window; never mid-settlement-cycle if avoidable.
3. **Staging/sandbox first:** rotate sandbox equivalents, run §6 sandbox test to green.
4. **Live change window:** apply rotation. Do not include or share real secret values in tickets, chats, screenshots, or this runbook.
5. **Validation payment:** perform §5 live smoke test at minimum agreed amount.
6. **Rollback plan:** previous secret retained by engineering in secure storage until validation completes and one full settlement cycle has cleared post-rotation.
7. **Evidence retention:** rotation date, approver, on-call, validation payment PayFast ref, settlement confirmation date. Not the secret itself.
8. **Notify:** platform_admin, finance lead, support lead on completion.

---

## 12. Audit evidence checklist

For each material payment event, retain (linked / referenced, not duplicated):

- PayFast provider reference
- Izenzo `token_purchases` id
- Organisation / customer id
- USD amount
- ZAR amount
- FX rate snapshot at time of purchase
- PayFast confirmation timestamp (ITN)
- Wallet credit timestamp (`token_ledger` entry)
- Expected settlement date
- Bank settlement reference (Nedbank narration / line id)
- Settlement `confirmed_by` operator id and timestamp
- Admin notes on the settlement row
- Refund / dispute id if any
- Admin risk item id if any
- Audit log id(s) covering status transitions

---

## 13. Customer-support guidance

Approved short, safe wording. Support may adapt tone but not disclose internal mechanics.

- **Payment successful:** "Your payment was successful and your credits are now available."
- **Payment pending:** "Your payment is being processed. This normally completes within a few minutes."
- **Payment failed:** "Your payment didn't go through. No credits have been added and no charge should appear. Please try again or use a different card."
- **PayFast checkout cancelled:** "It looks like the checkout was cancelled before completion. No payment was taken."
- **Credits received:** "Your credits are available on your account and ready to use."
- **Refund under review:** "Your refund request has been received and is being reviewed by our finance team."
- **Dispute under review:** "This payment is currently under review with our payment provider. We'll be in touch once we have an update."
- **Settlement status is internal:** support must not discuss settlement status with customers. If pressed: "Internal finance reconciliation is a separate process and doesn't affect your account or credits."

Do **not** expose: security mechanics, bank account details, provider secrets, ZAR/FX internal mechanics (unless already approved by product policy), Paystack.

---

## 14. Do-not-do list

**These are hard rules. Violations are audit-reportable.**

- Do **not** manually credit wallets because settlement is late.
- Do **not** mark settlement `confirmed` without a matching bank statement reference.
- Do **not** edit `token_purchases`.
- Do **not** edit `token_ledger`.
- Do **not** bypass or delete audit log entries.
- Do **not** expose Paystack to customers, ever.
- Do **not** expose ZAR / internal FX mechanics to customers unless already approved by product policy.
- Do **not** treat a PayFast ITN as proof of bank settlement.
- Do **not** treat sandbox records as live settlement evidence.
- Do **not** debit a wallet to "reverse" a refund; use the refund flow.
- Do **not** share real PayFast secrets in tickets, chats, or documents.

---

## 15. Developer / on-call escalation checklist

When paged, inspect in this order. Read-only unless a documented, audited fix path applies.

- PayFast checkout initiation logs.
- ITN handler edge-function logs and recent deployments.
- `provider_reference` search across `token_purchases`, `payment_settlements`, `audit_logs`.
- `token_purchases` row: status, timestamps, org, amounts.
- `audit_logs` for the purchase and settlement ids.
- `token_ledger` entries linked to the purchase.
- `payment_settlements` row: status, expected/actual dates, bank ref, notes.
- `admin_risk_items` tagged PayFast or with the provider reference.
- `refund_requests` linked to the purchase.
- Sentry / backend error logs for the ITN handler and reconciliation RPCs.
- GitHub deployment status for any recent change to payments-related edge functions or migrations.
- Environment / secret binding status (without reading secret values).

Escalate to platform_admin if: data inconsistency across sources, suspected secret issue, or any change that would require a migration or RPC to correct.

---

## 16. Open questions / placeholders

Confirm each before this runbook is treated as final operationally:

- **PayFast settlement cycle** — exact business-day cadence for Izenzo's merchant account (T+?).
- **PayFast settlement export/feed/API** — whether an automated feed exists or reconciliation is dashboard/CSV only.
- **Expected settlement delay threshold** — hours/days past expected date before an item auto-moves to `delayed` and before it must be escalated as `exception`.
- **Bank reference format** — the Nedbank narration pattern for PayFast batches, for reliable matching.
- **Settlement sign-off authority** — named finance role/individual who signs off weekly reconciliation packs.
- **`finance_admin` role** — whether to add a dedicated role separate from `platform_admin`, or continue using `platform_admin` for settlement actions.
- **Official customer-support wording** — sign-off from product/legal on §13 phrasing.
- **Live smoke-test amount** — agreed minimum ZAR amount and internal QA account convention.
- **Emergency disable switch** — confirm current operational toggle with engineering; do not document a specific switch until confirmed.
- **Spent-credit refund policy threshold** — finance-defined exposure limit that requires platform_admin approval.

---

## 17. Acceptance criteria

This runbook is considered complete and ready for operational use when:

- Finance can reconcile a normal PayFast payment end-to-end without a developer.
- Support can answer basic customer questions using only §13 wording, without exposing internals.
- Developers know exactly when to escalate and what to inspect (§15).
- Auditors can locate the evidence set for any material payment event (§12).
- No operator is instructed anywhere to mutate wallet, ledger, or payment rows manually.
- PayFast payment confirmation and bank settlement are clearly and consistently separated throughout.

---

**Final status:** `PAYFAST_ENTERPRISE_OPERATIONS_RUNBOOK_READY`
