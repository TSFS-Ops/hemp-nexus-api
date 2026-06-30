# Billing navigation usability report

Status: **BILLING_NAVIGATION_READY**

## Goal
Make Billing discoverable from the natural in-app locations without forcing
users to type `/desk/billing` into the address bar. Navigation/usability work
only — no PayFast, Paystack, wallet, ledger, FX, or pricing changes.

## Places inspected
- `src/components/PublicHeader.tsx` (public top nav, logged-in + logged-out states, mobile menu)
- `src/components/desk/DeskSidebar.tsx` (Trade Desk primary nav)
- `src/components/AppSidebar.tsx` (legacy dashboard sidebar)
- `src/components/MobileBottomNav.tsx` (mobile tabs + profile sheet)
- `src/components/TokenBalanceDisplay.tsx` (header wallet badge, full balance card)
- `src/components/dashboard/DashboardBreadcrumbs.tsx`
- `src/components/match/StateProgressionCard.tsx`, `BulkConfirmDialog.tsx` (low-credit CTAs)
- `src/pages/Desk.tsx`, `src/pages/Billing.tsx`, `src/pages/desk/billing/PayfastReturn.tsx`, `PayfastCancel.tsx`
- `src/App.tsx` route table (`/billing`, `/dashboard/billing`, `/desk/billing`)
- `src/lib/constants.ts` (ROUTES.BILLING / DASHBOARD_BILLING)
- `src/lib/post-auth-redirect.ts`

## Pre-existing Billing entry points (verified working)
| Surface | Element | Target |
|---|---|---|
| Trade Desk sidebar (desktop) | "Billing" nav item with `g b` shortcut | `/desk/billing` |
| Token balance badge (header, all authed pages) | Coins badge | `/desk/billing` |
| Token balance full card | "Buy Credits →" link | `/desk/billing` |
| Token balance blocked state | "Buy credits" inline link | `/desk/billing` |
| Match state progression card (low credit) | "Top up credits" | `/billing` → `/desk/billing` |
| Bulk confirm dialog (insufficient credits) | "Purchase more credits" | `/billing` → `/desk/billing` |
| Evidence chain indicator (entitlement error) | navigate fallback | `/billing` |
| Mobile profile sheet | "Credits" tile | `/dashboard/billing` (legacy) |
| Legacy AppSidebar | "Credits" item | `/dashboard/billing` (legacy) |

## Defects found
1. `ROUTES.BILLING` and `ROUTES.DASHBOARD_BILLING` both pointed at
   `/dashboard/billing`, which renders the `LegacyRedirect` banner before
   bouncing to `/desk/billing`. Users following the AppSidebar "Credits"
   item or the mobile profile sheet's "Credits" tile briefly saw a "page
   moved" banner instead of landing cleanly on the canonical page.
2. `TokenBalanceDisplay` (header badge + full card + blocked-state CTA)
   pointed at `/billing`, which is itself a `<Navigate>` redirect. Same
   double-hop UX issue.
3. Labels read "Credits" — accurate but not the wording the brief asked for
   ("Billing & Credits" / "Buy Credits").

## Fixes applied (navigation/presentation only)
- `src/lib/constants.ts`: `ROUTES.BILLING` and `ROUTES.DASHBOARD_BILLING`
  now resolve directly to `/desk/billing`. The `/billing` and
  `/dashboard/billing` routes themselves still exist in `App.tsx` as
  back-compat redirects for any bookmarked URLs.
- `src/components/AppSidebar.tsx`: label changed from "Credits" to
  "Billing & Credits".
- `src/components/MobileBottomNav.tsx`: mobile profile tile label
  changed from "Credits" to "Billing & Credits".
- `src/components/TokenBalanceDisplay.tsx`: all three CTAs
  (compact badge, full-card link, blocked-state inline link) now point at
  `/desk/billing` directly. Full-card link wording updated to "Buy Credits".

No payment, ledger, wallet, FX, pricing, or admin-only surface code was
modified. Auth/role gating on `/desk/billing` (RequireAuth + billing
availability hooks) is unchanged.

## Routes changed
None at the React Router level. Only the in-app `ROUTES` constants now
point at the canonical `/desk/billing`. Legacy URLs (`/billing`,
`/dashboard/billing`) still resolve via existing redirects.

## Tests
Added: `src/tests/billing-navigation-usability.test.ts` — six assertions:
1. `ROUTES.BILLING` and `ROUTES.DASHBOARD_BILLING` both equal `/desk/billing`.
2. Trade Desk sidebar exposes a "Billing" item pointing at `/desk/billing`.
3. Legacy `AppSidebar` exposes "Billing & Credits" via `ROUTES.BILLING`.
4. Mobile profile sheet exposes "Billing & Credits" via `ROUTES.DASHBOARD_BILLING`.
5. Token balance widget links to `/desk/billing` and offers "Buy Credits".
6. Public header does **not** render Billing links to logged-out visitors.

Ran (vitest):
- `src/tests/billing-navigation-usability.test.ts` — **6/6 passed**
- `src/tests/batch-24-desk-shortcuts.test.ts` — **8/8 passed** (Trade Desk sidebar Billing item pinned)
- `src/tests/billing-availability-guard.test.tsx` — passed (unrelated pre-existing mock unhandled rejection from `PendingPurchaseNotice`, not introduced this turn)

## Back-end / front-end consistency
- Back end (PayFast `payfast-itn`, `payfast-checkout-public`, Paystack
  `paystack-webhook`, `atomic_paid_credit_purchase`) unchanged.
- Front end now surfaces the existing `/desk/billing` page through the
  expected nav locations with consistent, user-friendly wording.

## Manual QA
- Logged-in Trade Desk: Billing reachable from sidebar (1 click) and from
  the header wallet badge (1 click). `g b` keyboard shortcut still works.
- Wallet badge in header on every authed page now lands directly on
  `/desk/billing` without showing the legacy-redirect banner.
- Mobile (`< md`): profile sheet shows "Billing & Credits" tile.
- Public header (`/`, `/products/*`, `/solutions/*`, etc.): no Billing
  links exposed to logged-out users; logged-in users still get the
  Dashboard/HQ CTA from which the sidebar Billing item is reachable.
- Admin-only PayFast surfaces (admin refund panel, billing failures panel,
  ITN replay tools) remain gated behind the admin sidebar group; no admin
  test buttons were promoted into the customer Billing nav.

## Confirmations
- ✅ Billing is now easy to find from the Trade Desk sidebar, the wallet
  badge in the header, the mobile profile sheet, and the legacy dashboard
  sidebar — with consistent "Billing & Credits" / "Buy Credits" wording.
- ✅ Payment logic untouched (no edits under `supabase/functions/payfast-*`,
  `paystack-*`, or `src/lib/credit-checkout*.ts`).
- ✅ Paystack flow unchanged.
- ✅ PayFast flow unchanged (checkout, return, cancel, ITN).
- ✅ Admin-only PayFast/ITN/refund controls remain in admin surfaces only.
- ✅ FX code is not revived. No `_shared/fx.ts` imports added.
- ✅ Logged-out users see no Billing links anywhere in the public header.

## Remaining recommendations (none required for rollout)
- Optional: add a small "Billing & Credits" quick-link to the Trade Desk
  Overview header next to the wallet badge for first-time discoverability.
- Optional: replace the wallet badge tooltip "Purchase credits to continue"
  with a button-styled CTA. Not blocking — clicking the badge already
  navigates to Billing.

**Final status: BILLING_NAVIGATION_READY**
