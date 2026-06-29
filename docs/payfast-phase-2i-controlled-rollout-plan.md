# PayFast Phase 2I — Controlled Rollout Plan

Status: **PAYFAST_PHASE_2I_READY_FOR_CUSTOMER_ROLLOUT_DECISION**

PayFast live has passed end-to-end verification (see `payfast-phase-2h-live-payment-report.md`). This document covers (1) the earlier failed R5 live payment, (2) current live-payment controls, and (3) the recommended path to customer rollout. No code mutations are proposed in this report — it is a decision document.

---

## 1. Earlier failed live R5 payment — safe resolution recommendation

**Transaction**
- `provider_reference`: `izpf_live_mqzswxtv_8cb3pel2`
- PayFast ID: `310955465`
- Amount: R5.00 ZAR
- State: PayFast charged it successfully; Izenzo did **not** credit because the ITN was rejected on the IP allowlist (live IP/ITN setup not yet complete at the time).

**Options**

| Option | Description | Risk | Audit cleanliness |
|---|---|---|---|
| A. Ask PayFast support to resend the ITN | Operator triggers a resend from the PayFast merchant dashboard (or via support). The standard `payfast-itn` flow runs: signature + post-back + IP + idempotency. Credits 1 token via the normal code path. | Very low — same code path that just passed for `izpf_live_mqzu2114_ly0374gk`. Idempotent on `provider_reference`. | ✅ Cleanest — credit comes from a verified live ITN, full audit trail. |
| B. Admin-approved manual credit adjustment with full audit reason | A platform admin issues a one-off credit with an explicit `reason: payfast_itn_recovery_310955465` linked to the original `token_purchases` row. | Medium — bypasses ITN verification; requires sign-off + linked audit row. | ⚠️ Acceptable only if A is impossible. Breaks the rule that credit must come from a verified ITN. |
| C. Treat as failed-test cost (refund or write-off) | Refund R5 to the cardholder via PayFast (or accept it as a test cost) and leave the `token_purchases` row in `pending` / mark `cancelled` with audit reason. | Very low. | ✅ Clean. No credit issued. |

**Recommendation: Option A — resend the ITN from PayFast.**
- Same verified live code path that already passed.
- Idempotency on `provider_reference` prevents double-credit.
- No manual ledger mutation; full audit trail.
- If PayFast cannot resend, fall back to Option C (refund / write-off) rather than Option B.

**Not actioned yet** — awaiting explicit approval.

---

## 2. Current live PayFast controls

Verified from source:

| Control | State | Evidence |
|---|---|---|
| Live PayFast button is admin-only | ✅ Yes | `src/components/desk/billing/PayfastLiveSmokeTestButton.tsx:71` — `if (!isAdmin) return null;` |
| Hidden from non-admin users | ✅ Yes | Same gate; component returns `null` for non-admins. `BillingOverview.tsx:489` and `Billing.tsx:726` comments confirm "never a customer surface". |
| `PAYFAST_LIVE_SMOKE_ENABLED` still required | ✅ Yes | Server-side guard in `payfast-checkout-live` edge function; button additionally renders to null when the flag is off. |
| PayFast not customer-facing | ✅ Yes | Only the live **smoke test** button exists, and only for `platform_admin`. No customer payment-method picker has been added. |
| Paystack unchanged | ✅ Yes | No edits this session. |

**Recommendation for now: leave admin-only PayFast enabled** (option 1).
- Keeps the verified live path available for monitoring and one-off operator tests.
- Zero exposure to customers.
- Do **not** disable the temporary live smoke button — it is the only currently-verified live PayFast surface, and it remains gated by `isAdmin` + `PAYFAST_LIVE_SMOKE_ENABLED`.
- Do **not** prepare customer rollout yet — that needs an explicit decision (see §3).

---

## 3. Customer rollout plan (Phase 2J — proposed, not yet built)

A short next-phase blueprint for exposing PayFast to normal customers. Nothing here is implemented yet.

### 3.1 UI changes required
- Replace the admin-only smoke button with a real customer purchase flow on `/desk/billing`:
  - Package picker (existing) → **payment method picker** (Paystack / PayFast) → checkout.
  - Per-method "Pay with …" CTA, brand-marked, with currency clearly labelled (USD billing; PayFast settles in ZAR via FX **handled by PayFast**, not by us — no FX code in Izenzo).
- Add a PayFast result landing route(s) for return / cancel / notify:
  - `/desk/billing/payfast/return` — "Payment received, awaiting confirmation" until ITN credits.
  - `/desk/billing/payfast/cancel` — "Payment cancelled, no charge" with retry CTA.
- Update `PurchasesList` to show provider badge (`Paystack` / `PayFast`) and provider reference.
- Keep the admin-only live smoke button behind `isAdmin && PAYFAST_LIVE_SMOKE_ENABLED` as an operator tool.

### 3.2 PayFast vs Paystack
**Recommendation: PayFast sits alongside Paystack, not as a replacement.**
- Paystack remains the default for non-ZAR cards and existing customers.
- PayFast is added as an additional method, primarily for ZA customers who prefer it (EFT, Instant EFT, SnapScan, etc.).
- Both providers credit through the same `token_ledger.credit_purchase` shape with `provider` distinguishing them — already true today.

### 3.3 How users choose payment method
- On the package confirm screen, show two cards: **Paystack** (default highlighted) and **PayFast**.
- Persist last-used choice per user as a soft preference (not security-relevant).
- Disable PayFast card with tooltip when `PAYFAST_PUBLIC_ENABLED` (new flag, separate from `PAYFAST_LIVE_SMOKE_ENABLED`) is false.

### 3.4 Failed / cancelled / returned payments
- **Cancelled** (user aborts at PayFast): land on cancel route, `token_purchases` stays `pending`, auto-expire to `cancelled` after N minutes via existing reconciliation cron.
- **Failed** (PayFast rejects): ITN with `payment_status != COMPLETE` → mark `token_purchases.status = failed`, audit row, no credit.
- **Returned** (refunded by PayFast post-credit): handled in §3.5.
- All three display in `PurchasesList` with clear status badges (existing pattern, reused from Paystack).

### 3.5 Refunds / disputes
- Refunds initiated from PayFast merchant dashboard → PayFast posts a refund ITN.
- New handler branch in `payfast-itn` for refund notifications: insert a `token_ledger` `credit_refund` (negative) row keyed by `provider_reference + refund_id`, write audit row, optionally place wallet on `disputed_credit_holds` per existing policy.
- No manual ledger mutation. Mirrors existing Paystack refund handling.

### 3.6 Final tests before public release
1. End-to-end real customer purchase (non-admin user, real card, R-denominated package).
2. Cancel flow round-trip (user aborts at PayFast hosted page).
3. Failed payment ITN handled correctly (declined card).
4. Refund ITN handled correctly (refund from merchant dashboard → ledger reversal + audit).
5. Concurrent ITN delivery (replay): only one credit row written.
6. Mixed cart smoke: same user buys via Paystack then PayFast — both credits attributed correctly.
7. Paystack regression suite still green (`payments-paystack-no-regression-phase1.test.ts` etc.).
8. No FX modules touched (grep guard in CI).

---

## Final status

- [x] **PAYFAST_PHASE_2I_READY_FOR_CUSTOMER_ROLLOUT_DECISION**
- [ ] PAYFAST_PHASE_2I_READY_FOR_ADMIN_ONLY_USE *(already in effect — admin-only PayFast is live and verified; this status is satisfied by current state)*
- [ ] PAYFAST_PHASE_2I_BLOCKED

PayFast is **production-verified and admin-only**. Awaiting explicit decision on:
1. Resolution of the orphaned R5 (recommend: ask PayFast to resend ITN).
2. Whether to begin Phase 2J customer rollout as scoped above.
