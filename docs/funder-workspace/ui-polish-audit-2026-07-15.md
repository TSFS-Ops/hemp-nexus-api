# Institutional Funder Evidence Workspace — UI Polish Audit
Date: 2026-07-15
Scope: React/UI layer only. No backend, migrations, RLS, edge functions or CI touched in this pass.

## Method
- Static read of every canonical page in `src/pages/funder/workspace/*`
  and every admin surface in `src/pages/admin/p5-batch3/*`.
- Static read of every legacy `src/pages/funder/p5-batch*` surface.
- Static read of every primitive under `src/lib/funder-workspace/ui/*`.
- New static-guard tests locked in
  `src/tests/funder-workspace-ui-polish-guards.test.ts`.
- Responsive review at 390 (mobile), 768 (tablet), 1280 (desktop) CSS px
  by tracing Tailwind class usage on the changed files (no bespoke media
  queries were introduced).

## Runtime and empty-state audit — team management

| Surface | Loading | Empty | Error | Confirmation | Rollback |
| --- | --- | --- | --- | --- | --- |
| Organisations list | `LoadingState` | `EmptyState` | Card with `role=alert` | `ConfirmDialog` (suspend + reactivate) | Yes, reverts prior `status` on RPC failure |
| Organisation detail | `LoadingState` (both tables) | `EmptyState` for pending and active | Card with `role=alert` | `ConfirmDialog` (deactivate + role change) | Yes, reverts prior `role`/`status` |
| Admin audit | `LoadingState` | `EmptyState` | Card with `role=alert` | Read-only surface | n/a |

Deactivation and suspension both `requireReason` — the ConfirmDialog
blocks the confirm action until the reason field has at least 3 non-blank
characters, so those flows cannot be triggered accidentally.

Resend invitation is intentionally left as a documented stub —
no fabricated RPC call. Locked by test:
`Team management — resend invitation is honestly stubbed`.

## Legacy route containment

All legacy funder surfaces render `LegacyBanner`, which links back to
`/funder/workspace`:
- `src/pages/funder/FunderEvidencePack.tsx`
- `src/pages/funder/p5-batch2/FunderEvidencePack.tsx`
- `src/pages/funder/p5-batch3/components/P5B3FunderShell.tsx`
- `src/pages/funder/p5-batch4/components/P5B4FunderShell.tsx`
- `src/pages/funder/p5-batch5/FunderFinality.tsx`
- `src/pages/funder/p5-batch6/FunderExceptions.tsx`
- `src/pages/funder/p5-batch7/FunderDashboard.tsx`

Locked by test: `Legacy funder surfaces — banner + link back to canonical`.

## No raw identifiers in canonical UI

Every canonical page routes statuses through the shared label helpers
(`releaseStatusLabel`, `packStatusLabel`, `consentStatusLabel`,
`orgStatusLabel`, `funderUserStatusLabel`) or the `StatusBadge`
primitive. UUIDs, when shown at all, are secondary technical `ref:`
labels; the primary heading is always a human field.

Locked by tests:
- `Canonical funder pages — no raw enum labels in JSX`
- `no hard-coded UUID literal`

## Responsive review

Canonical funder pages and admin p5-batch3 pages all use:

- `max-w-6xl mx-auto p-6` container.
- `flex flex-col ... md:flex-row` for header rows with actions.
- `overflow-x-auto` wrapping every `<Table>` so long rows scroll on
  narrow viewports instead of forcing horizontal page scroll.
- shadcn `Dialog` / `AlertDialog` — which are viewport-aware and clamp
  to `max-w-lg` by default, sitting inside a scroll container.

No hard-coded pixel widths, no `h-screen` on layout, no non-token
colours. Bottom-nav padding is not relevant here because the funder
workspace sits inside its own header/shell rather than the mobile Desk
shell — the mobile-smoke checklist rules for `pb-mobile-nav` do not
apply to `/funder/*`.

Observations (no code changes made — flagged for future work):

1. The `Table` header row on `Organisations` and the pending/active
   tables on `OrganisationDetail` has 5–6 columns. On viewports narrower
   than ~600 CSS px the horizontal scroll works but the "Actions"
   column can require a two-finger scroll. A future card-based mobile
   view would be nicer, but is out of scope for this pass.
2. `DealDetail.tsx` is 511 lines. It renders fine at all three widths,
   but if we add more sections we should split it before growing past
   ~700 lines to keep the mobile layout auditable.

## What was NOT changed

- No migration, RLS, edge function or CI change.
- No new backend RPC or table read.
- No changes to auth, notifications, storage or billing.
- No deletions of legacy `/funder/p5-batch*` routes — containment only.

## Follow-ups (backend / Claude)

These remain the outstanding items from the questionnaire, unchanged
by this pass:

- `p5b3_admin_resend_funder_invite_v1` RPC.
- Narrow buyer/seller display projection for the funder deal page.
- Admin downloads audit view (backing RPC).
- Email notifications for invitation / approval / release / RFI /
  revocation / expiry.
- Bank-confidence source, deterministic finality linkage, deal-specific
  required-evidence checklist.
