# PayFast Admin Reconciliation Console — UI/UX & Implementation-Mapping Audit

Status: **PAYFAST_ADMIN_RECONCILIATION_UI_AUDIT_READY**
Author: Lovable (read-only audit)
Scope: UI/UX design + implementation mapping only. No code shipped.

---

## 1. Executive Summary

Izenzo already has a functional PayFast **payment** loop (customer checkout → PayFast confirmation → wallet credit → purchase history → revenue reporting). The missing enterprise-grade layer is **operational settlement/reconciliation visibility** — i.e. proving to Finance that funds PayFast confirmed have actually **landed in Izenzo's bank account**.

Today, Finance/Admin operators cannot answer, in one place:

- Which PayFast payments are **paid but not yet settled**?
- Which are **overdue / delayed**?
- Which need a **bank reference** captured?
- Which have **wallet-crediting anomalies**, refunds or disputes attached?

The recommendation is a **new dedicated admin console** — the *PayFast Reconciliation Console* — that:

- **Reads** from the confirmed payment ledger (`token_purchases`, `audit_logs` credits.*, `refund_requests`).
- **Writes only** to a new operational settlement-tracking layer (owned by Claude's backend work) — never mutates payment or wallet state.
- Sits inside `/hq` as a first-class sub-tab under Revenue, and is gated to `platform_admin`, `finance_admin` (new operator role) and read-only `auditor`.

Every admin action is audited via `admin_audit_logs`. No admin action ever re-credits a wallet or edits PayFast confirmation data.

---

## 2. Current Surface Inventory (what already exists)

| Area | File | Purpose | Reuse in Console |
|---|---|---|---|
| Revenue dashboard | `src/components/admin/AdminRevenuePanel.tsx` | USD-native settlement events from `audit_logs.credits.purchased` merged with `token_ledger` | **Data source + link source**. Add "Open in Reconciliation Console" affordance. |
| Billing review | `src/components/admin/AdminBillingReviewPanel.tsx` | Admin billing exception surface | Reuse pattern; extend for settlement exceptions. |
| Disputes | `src/components/admin/AdminDisputesPanel.tsx` | Match-level disputes | **Cross-link only** — do NOT merge. |
| Refunds | `src/components/desk/billing/RefundRequestDialog.tsx`, `refund_requests` table already carries `provider_settlement_status / _actor / _notes / _settled_at / _refund_reference` | Refund settlement fields | **Direct reuse** — the provider-settlement pattern used for refunds is the exact model to extend to purchases. |
| Risk queue | `src/components/admin/AdminRiskAlarmsPanel.tsx` | admin_risk_items | **Cross-link** — settlement exception can raise a risk item. |
| PayFast pricing | `src/components/desk/billing/AdminPayfastPricingReview.tsx` | USD/ZAR rate admin | Adjacent, not merged. |
| Revenue notifications | `src/components/admin/AdminRevenueNotificationsPanel.tsx` | Alerting on revenue events | Extend to fire on `settlement_overdue`. |
| Purchases (customer) | `src/components/desk/billing/PurchasesList.tsx` | Customer view | **Do NOT touch** — settlement fields must never render for customers. |
| Purchase table | `token_purchases` (provider, provider_reference, amount_usd, metadata JSON — snapshotted ZAR/rate) | Payment record | **Read-only** for the console. |
| Nav host | `src/pages/HQ.tsx` (Tabs shell) | `/hq` sub-tabs | Insert the new tab here. |

### 2.1 What is intentionally NOT present today

- No `payfast_settlements` (or equivalent) operational table.
- No "expected settlement date" derivation.
- No bank-reference field on purchases.
- No settlement exception queue.
- No settlement CSV export separate from raw revenue export.

These are Claude's backend deliverables (§14) — this UI **must not** create them.

---

## 3. Recommended Route / Page

- **Route:** `/hq/revenue/reconciliation`
- **Alternate deep-links:**
  - `/hq/revenue/reconciliation?status=overdue`
  - `/hq/revenue/reconciliation/:purchaseId` (drawer open)
- **Page title:** *PayFast Reconciliation Console*
- **Breadcrumb:** HQ → Revenue → Reconciliation
- **File placement (when built):**
  - `src/pages/hq/revenue/ReconciliationConsole.tsx` (page shell)
  - `src/components/admin/reconciliation/*` (table, filters, drawer, cards)
  - `src/lib/reconciliation/*` (types, client, status derivation — pure)

---

## 4. Navigation Placement

Inside `/hq`, the *Revenue* top tab currently renders `AdminRevenuePanel`. Convert Revenue into a two-child sub-tab group:

```
HQ ▸ Revenue
  ├── Overview          (existing AdminRevenuePanel — untouched)
  └── Reconciliation    (NEW — this console)
```

Do **not** promote Reconciliation to a top-level HQ tab; it is a Revenue-adjacent operational view and belongs under Revenue for finance mental-model consistency.

Add a small unread badge on the Reconciliation sub-tab whenever `count(status ∈ {overdue, exception, needs_bank_ref}) > 0`.

---

## 5. User Roles

| Role | Read | Filter/Export | Mark settled/delayed/exception | Add bank ref / note |
|---|---|---|---|---|
| `platform_admin` | ✅ | ✅ | ✅ | ✅ |
| `finance_admin` (new operator role, backend) | ✅ | ✅ | ✅ | ✅ |
| `auditor` (read-only) | ✅ | ✅ | ❌ | ❌ |
| Everyone else | ❌ (404 via `RequireAuth` role guard) | — | — | — |

Enforcement is server-side (RLS + edge-function role check). The UI hides action buttons for `auditor`.

**Customers, funders, api-clients and normal org users must never see this route** — even accidentally deep-linking must 404.

---

## 6. Wireframe (Screen Layout)

```text
┌───────────────────────────────────────────────────────────────────────────────┐
│ HQ ▸ Revenue ▸ Reconciliation                          [ Export CSV ] [ ↻ ] │
├───────────────────────────────────────────────────────────────────────────────┤
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────┐ │
│ │Reconciled│ │Awaiting  │ │ Overdue  │ │Exception │ │Needs Bank│ │Refunds │ │
│ │  $12,430 │ │Settlement│ │  3 items │ │ 1 item   │ │ Ref      │ │/Disp.  │ │
│ │  128 pmts│ │ $2,180   │ │ $310     │ │ $120     │ │ 4 items  │ │ 2      │ │
│ └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘ └────────┘ │
├───────────────────────────────────────────────────────────────────────────────┤
│ Status: [All ▾]  Range: [Last 30d ▾]  Org: [any ▾]  Bank ref: [ any ▾ ]     │
│ Search: [ provider ref / purchase id / org name / bank ref ]                  │
├───────────────────────────────────────────────────────────────────────────────┤
│ Prov  Provider Ref     Org / Customer     USD    ZAR    FX    Paid At   ... │
│ ───── ───────────────  ────────────────   ─────  ─────  ────  ────────  ─── │
│ [PF]  pf_txn_92831…    Acme (Pty)        $100   R1,825 18.25 12:04 UTC  ✅  │
│ [PF]  pf_txn_92835…    Beta Co           $10    R182   18.20 13:11 UTC  ⏳  │
│ [PF]  pf_txn_92840…    Delta Ltd         $500   R9,100 18.20 08:30 UTC  ⚠  │
│ …                                                                            │
│                                                       [ 200 rows • Load more]│
└───────────────────────────────────────────────────────────────────────────────┘
        (Row click → right-side Audit / Detail drawer)
```

**Density:** Table follows the same visual grammar as `AdminRevenuePanel` (shadcn `Table`, 1px `#E2E8F0` borders, 6px radii, muted-institutional-green primary, Inter body, JetBrains Mono for reference/amount cells).

---

## 7. Summary Cards (top strip)

All amounts in **USD** (with ZAR under tooltip). Counts + amount per card.

1. **Reconciled** — `payment confirmed ∧ wallet credited ∧ settlement confirmed`.
2. **Awaiting Settlement** — `payment confirmed ∧ wallet credited ∧ expected_settlement_at ≥ today`.
3. **Overdue** — `expected_settlement_at < today ∧ settlement_status ∉ {confirmed, exception}`.
4. **Exception** — operator-marked `exception` OR wallet-crediting anomaly (paid but not credited within N minutes).
5. **Needs Bank Reference** — settlement confirmed but `bank_reference IS NULL`.
6. **Refunds / Disputes attached** — count of purchases with a linked `refund_requests` row or open dispute.

Each card is a filter shortcut (click → sets the table filter).

---

## 8. Table Columns

| Col | Source | Notes |
|---|---|---|
| Provider badge | `token_purchases.provider` | `[PF]` PayFast (green); `[PS]` Paystack (**muted grey, "Legacy/internal"**) — Paystack rows only appear if a platform_admin toggles "Include legacy providers". |
| Provider Ref | `token_purchases.provider_reference` (fallback `paystack_reference`) | Monospace. Copy-on-click. |
| Purchase ID | `token_purchases.id` | Hidden by default column toggle. |
| Org / Customer | `organizations.name` + user email if solo | Links to org drawer. |
| USD | `amount_usd` | Right-aligned monospace. |
| ZAR | `metadata.amount_zar` (snapshotted at checkout) | From `credit-checkout-payfast` snapshot. |
| FX rate | `metadata.usd_zar_rate` | Small subtle text. |
| Payment Confirmed At | `audit_logs.credits.purchased.created_at` | ISO + relative tooltip. |
| Wallet Credited At | `token_ledger.action_type='credit_purchase'.created_at` | Highlight red if > payment+5min. |
| Expected Settlement | (backend-derived, see §14) | Business-day arithmetic on payment date. |
| Settlement Status | new `payfast_settlements.status` | Badge (see §9). |
| Bank Reference | new `payfast_settlements.bank_reference` | Editable via row action; monospace. |
| Exception Reason | new `payfast_settlements.exception_reason` | Truncated + tooltip. |
| Refund / Dispute | join `refund_requests` + disputes | Icon indicator + count. |
| Actions | — | Kebab menu. |

Sensible defaults: sort by *Payment Confirmed At desc*. Sticky header. Row height ≥ 44px. Truncation banner if server caps result set.

---

## 9. Status Badges

- `reconciled` — solid muted green.
- `awaiting_settlement` — slate outline.
- `settlement_delayed` — amber outline.
- `overdue` — amber solid.
- `exception` — red solid.
- `needs_bank_reference` — slate solid.
- `refund_open` / `dispute_open` — small pill appended.
- `wallet_anomaly` — red outline (paid but not credited within N minutes).

Never re-color from PayFast's own status — this is Izenzo operational status only.

---

## 10. Filters

- **Status** (multi-select): all reconciliation statuses above.
- **Date range**: Today / 7d / 30d / 90d / Custom (payment-confirmed date).
- **Org / Customer**: async combobox.
- **Provider**: default = PayFast. Optional "Include legacy (Paystack)" for platform_admin only.
- **Has bank reference**: yes / no / any.
- **Has refund/dispute**: yes / no / any.
- **Free text search**: provider ref, purchase id, org name, bank reference.

Filters are URL-state (deep-linkable via `useUrlSearchParams`). Applied filters render as removable chips above the table.

---

## 11. Row Actions (kebab per row)

1. **View audit trail** (opens drawer, §14).
2. **Mark settlement confirmed** (requires bank_reference; opens confirm dialog with reason field).
3. **Mark settlement delayed** (requires new ETA + reason).
4. **Mark settlement exception** (requires reason enum + free text ≥ 10 chars; optionally raises `admin_risk_items` row).
5. **Add/edit bank reference** (inline dialog; validates non-empty; disabled once status = `reconciled` unless platform_admin override).
6. **Add internal note** (audited note on the settlement row; visible in drawer).
7. **Copy provider reference**.
8. **Open in Revenue panel** (context switch back to `AdminRevenuePanel` filtered by ref).
9. **Open linked refund/dispute** (if any).

**Every action** goes through an edge function that writes to `payfast_settlements` and to `admin_audit_logs` in the same transaction. Wallet balance, `token_purchases` and PayFast confirmation data are **read-only**.

Bulk actions (checkbox column): *Mark settlement confirmed* and *Export selection* only. Bulk destructive/exception moves are intentionally disallowed for safety.

---

## 12. States

### 12.1 Empty
- **No purchases in range** → EmptyStateCard: "No PayFast purchases matched your filters." + button *Reset filters*.
- **Everything reconciled** → celebratory but restrained: "All PayFast payments in this window are reconciled." + link *View last 90d*.

### 12.2 Loading
- Skeleton rows (6) matching column widths.
- Summary cards render skeleton pills — never `0` while loading (misleading finance signal).

### 12.3 Error
- Reuse `RouteErrorBoundary` styling. Show `error.message` + Retry. On action failure, `sonner` toast with server code + reason (never a raw stack).

### 12.4 Permission-denied deep-link
- `RequireAuth` returns 404 (not 403) to avoid enumeration of an admin surface.

### 12.5 Stale
- If backend `expected_settlement_at` is missing (feature not yet enabled), render an amber banner: *Settlement dates unavailable — awaiting finance backend rollout.* Table still functions read-only.

---

## 13. Audit / Detail Drawer

Right-side drawer (600px), opens on row click or *View audit trail*.

Sections:

1. **Header**: provider badge, provider ref (copy), status badge, org name, USD/ZAR/FX.
2. **Timeline** (vertical, event-sourced):
   - Customer initiated (`credits.purchase_initiated`).
   - PayFast confirmed (`credits.purchased` from ITN handler).
   - Wallet credited (`token_ledger` entry).
   - Expected settlement (derived).
   - Bank settlement confirmed (admin action).
   - Any *delayed/exception/reference-added/note-added* admin action.
   - Refund/dispute events (if any).
   Each event: actor (system vs admin email), timestamp, source table, and a "View raw" affordance opening a JSON preview modal.
3. **Bank reconciliation panel**: bank_reference (editable), expected date, actual settled_at, delta days.
4. **Internal notes**: append-only list.
5. **Linked records**: refund row, dispute row, risk item, revenue row.

Drawer never mutates wallet balance and never re-confirms PayFast. All writes go through §11 actions.

---

## 14. Export Behaviour

- Button: **Export CSV** (top-right).
- Respects the currently applied filters and column visibility.
- Uses existing `auditedDownloadCSVRaw` + `recordExportAudit` (from `src/lib/export-audit.ts`), so:
  - **Purpose** is required — enum: `billing_or_payment_reconciliation` (default) or `audit_or_regulatory_review`.
  - **Reason** is required — min 10 chars, prompted via `promptExportReason`.
- Export rows carry: provider, ref, purchase_id, org_id, org_name, usd, zar, fx_rate, paid_at, credited_at, expected_settlement_at, settlement_status, bank_reference, exception_reason, refund_status, dispute_status.
- **No wallet balances, no PII beyond org name, no card data.**
- Hard cap: 10,000 rows per export. If more, prompt to narrow filters.

---

## 15. Interaction with AdminRevenuePanel

- Revenue = *what happened* (USD-native settlement events, historical totals).
- Reconciliation = *did the money land, and is it clean*.
- The Overview sub-tab is unchanged. Each Overview table row grows a small *"Reconciliation → "* chevron that deep-links to the console filtered by that provider reference.
- Reconciliation console also reads Revenue's *Pending settlement* signal (audit-log-only purchases missing a ledger row) and surfaces those as `wallet_anomaly`.

---

## 16. Interaction with Refunds / Disputes

- **Refunds**: `refund_requests` already has `provider_settlement_status / _actor / _notes / _settled_at / _refund_reference`. The console must display the refund settlement side-by-side with the original purchase settlement so operators see net position. A refund cannot be filed from this console — that stays in `RefundRequestDialog` / `AdminBillingReviewPanel`.
- **Disputes**: `AdminDisputesPanel` is match-level. The console links to the dispute row only when a dispute exists whose payment reference matches this purchase.
- **Never** does the console alter refund state, dispute state or wallet.

---

## 17. Interaction with Admin Risk Items / Exceptions

- Marking an item *exception* offers an opt-in checkbox: *Raise admin risk item* → posts to `admin_risk_items` with category `payfast_settlement`, severity operator-selected.
- Existing `AdminRiskAlarmsPanel` gets a filter chip *PayFast settlement* which deep-links back to the console.

---

## 18. Reuse vs New Components

### Reuse
- `Tabs`, `Table`, `Badge`, `Card`, `Select`, `Dialog`, `Sheet` (shadcn).
- `EmptyStateCard`, `TruncationBanner`, `RouteErrorBoundary`.
- `useUrlSearchParams`, `useDebounce`, `useDataFetch`.
- `auditedDownloadCSVRaw`, `recordExportAudit`.
- Money/USD formatters already used by `AdminRevenuePanel`.
- `BackButton`, `DashboardBreadcrumbs`.

### New (thin, single-purpose)
- `ReconciliationConsole.tsx` — page shell.
- `ReconciliationSummaryCards.tsx` — 6-card strip.
- `ReconciliationFiltersBar.tsx` — chips + filters.
- `ReconciliationTable.tsx` — column config, sort, bulk-select.
- `ReconciliationRowActions.tsx` — kebab menu + confirm dialogs.
- `ReconciliationDetailDrawer.tsx` — timeline + notes + linked records.
- `ReconciliationStatusBadge.tsx` — one source of truth for status → color.
- `lib/reconciliation/{types,client,status,derive-expected}.ts` — pure logic + typed client wrappers.

---

## 19. Backend Data Required from Claude (contract)

The UI is unblocked only when the backend provides:

1. **Table `payfast_settlements`** (owned by Claude), 1:1 with `token_purchases` for `provider='payfast'`:
   - `id`, `token_purchase_id` (FK), `org_id`.
   - `expected_settlement_at timestamptz not null`.
   - `settled_at timestamptz null`.
   - `settlement_status text` — enum: `awaiting_settlement | settlement_delayed | reconciled | exception | needs_bank_reference | wallet_anomaly`.
   - `bank_reference text null`.
   - `exception_reason text null`, `exception_code text null`.
   - `notes jsonb default '[]'` (append-only via RPC).
   - Standard `created_at / updated_at / created_by / updated_by`.
   - RLS: only `platform_admin`, `finance_admin`, `auditor` may `select`. Only `platform_admin`, `finance_admin` may `update` via SECURITY DEFINER RPC.
2. **RPC `payfast_reconciliation_list_v1(filters jsonb)`** returning the joined view (purchase × settlement × refund × dispute) with server-side filter/pagination.
3. **RPC `payfast_settlement_mark_v1(purchase_id, action, payload)`** — atomic status transition + `admin_audit_logs` insert.
4. **RPC `payfast_settlement_add_note_v1(purchase_id, note)`** — append-only.
5. **Backfill job**: for existing PayFast purchases, create `payfast_settlements` rows with derived `expected_settlement_at` (business-day rule) and `settlement_status = awaiting_settlement` (or `reconciled` if outside window).
6. **Cron**: nightly reclassifier for `awaiting_settlement → overdue`.
7. **Wallet-anomaly detector**: any `credits.purchase_initiated` older than N minutes without a matching `credits.purchased` OR without a `token_ledger` row → mark `wallet_anomaly`.

Until (1)–(3) exist, the console renders **read-only** with the amber "settlement backend not yet enabled" banner (§12.5).

---

## 20. What Should NOT Be Built

- No customer-facing settlement view. `PurchasesList.tsx` must remain untouched.
- No Paystack-facing operator surface beyond a passive legacy badge.
- No wallet re-credit action, no "resend to PayFast", no PayFast confirmation override.
- No auto-status changes from the client — all transitions are server-authored.
- No CSV export path that bypasses `recordExportAudit`.
- No side-panel merge with Disputes or Refunds — link only.
- No new top-level HQ tab.

---

## 21. Implementation Phases

**Phase 0 — this document.** Locked.

**Phase 1 — Backend (Claude):** §19 items 1–5. UI unblocked at the end.

**Phase 2 — UI shell (Lovable):**
- Add `/hq/revenue/reconciliation` route + sub-tab.
- Read-only table + summary cards + filters + drawer, wired to `payfast_reconciliation_list_v1`.
- Export CSV (audited).
- Role gate + 404-on-deny.

**Phase 3 — UI write actions:**
- Row actions 2–6 wired to `payfast_settlement_mark_v1` / `_add_note_v1`.
- Bulk *Mark settlement confirmed*.
- Optimistic UI with rollback + toast on failure.

**Phase 4 — Cross-linking:**
- Deep-links from `AdminRevenuePanel` rows.
- Chips on `AdminRiskAlarmsPanel` / `AdminDisputesPanel`.
- Revenue Notifications: fire on `settlement_overdue` and `wallet_anomaly`.

**Phase 5 — Hardening:**
- Playwright role-negative tests (`e2e/role-negative/route-access.spec.ts` extension).
- Vitest for status derivation + export payload shape.
- Load test 10k rows.

---

## 22. Acceptance Criteria

- [ ] `/hq/revenue/reconciliation` is reachable **only** by `platform_admin`, `finance_admin`, `auditor`. Anyone else gets 404.
- [ ] Summary cards match the sum of rows under equivalent filters (invariant test).
- [ ] Every row action writes an `admin_audit_logs` row with actor, before/after, reason.
- [ ] No UI code path mutates `token_purchases`, `token_ledger`, `token_wallets` or PayFast ITN records.
- [ ] CSV export refuses to run without an `ExportPurpose` and ≥10-char reason.
- [ ] Customers (`PurchasesList.tsx`) still see no settlement fields.
- [ ] Paystack never appears to non-admin operators; when shown to admins, it renders as *Legacy/internal*.
- [ ] Reconciliation status labels/colors come from a single source (`ReconciliationStatusBadge.tsx`).
- [ ] Drawer timeline reconstructs cleanly from event sources (audit_logs + token_ledger + payfast_settlements notes + refund_requests + disputes).
- [ ] Amber degraded banner renders when the settlement backend is unavailable, and no write actions are exposed in that state.
- [ ] Deep-link filters (`?status=overdue`) survive refresh via `useUrlSearchParams`.

---

## 23. Final Status

**PAYFAST_ADMIN_RECONCILIATION_UI_AUDIT_READY**
