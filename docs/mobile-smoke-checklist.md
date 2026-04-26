# Mobile Smoke Checklist

Run this before shipping any change that touches layout, navigation, dialogs,
or auth on the Desk surface. Test at **390×844** (iPhone 12/13/14) and
**360×800** (low-end Android). Tap-targets must be ≥44px.

## 1. Navigation reachability
- [ ] `/desk` — bottom nav visible, all 5 icons tappable, no overlap with content
- [ ] Last row of any list is **not** hidden behind the bottom nav
- [ ] Sticky page headers do not overlap the OS status bar (safe-area-top respected)
- [ ] Breadcrumbs wrap cleanly on narrow widths (no horizontal scroll)

## 2. Sign-out path
- [ ] `/desk` → tap **Menu** (5th icon) → sheet opens
- [ ] Sheet body scrolls if overflow
- [ ] **Sign out** button is visible without scrolling AND remains pinned at the bottom
- [ ] Tapping Sign out clears session and redirects to `/auth`

## 3. Dialog reachability (use `<ScrollableAlertDialog>` pattern)
- [ ] `StateProgressionCard` POI confirmation: scroll body, footer buttons stay visible
- [ ] `BulkConfirmDialog`: long pricing breakdown does not push Confirm/Cancel off-screen
- [ ] Cancel/Close buttons reachable with one thumb

## 4. Auth resilience
- [ ] Cold-start an edge function call after >1h idle — should NOT show "Session expired"
  if the server still considers the JWT valid (`edge-invoke.ts` verifies via `getUser()`)
- [ ] Genuine logout (clear cookies) → next edge call DOES show the modal

## 5. Forms & inputs
- [ ] All text inputs render at ≥16px on mobile (no iOS zoom-on-focus)
- [ ] Form submit buttons have visible disabled-state validation feedback

## 6. Bottom-padding token
- [ ] Pages inside `DashboardLayout` and `DeskLayout` use `pb-mobile-nav`
      (NOT hard-coded `pb-20`/`pb-24`) so safe-area insets are respected
