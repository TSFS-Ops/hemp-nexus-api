# Release Gate - 15-Minute Pre-Ship Checklist

> Run this before every production publish. A single ❌ in **Blockers** halts the release.

---

## 1. Automated Checks (~2 min)

```bash
# Must all exit 0
npm run test:regression    # vitest run on src/tests/batch-*.test.ts (batch proof suite)
npm run build              # TypeScript + Vite compilation (runs all prebuild guards below)
npm run check:drift        # Layout/footer/back-button drift guard
npx vitest run             # Full unit + integration sweep
node scripts/closeout-snapshot.mjs   # Writes dated artefact under docs/closeout/ when DB env present
```

After the snapshot script runs against the live DB tier, confirm the
HealthBoard **Closeout Drift** tile is green (`closeout_drift_summary()`
returns zero critical drift) and review
`docs/deferred-policy-register.md` for any items still requiring client
sign-off.

Prebuild guards enforced automatically by `npm run build`:

- `check-routes.mjs` — route registry vs source drift
- `check-edge-function-paths.mjs` — edge invoke paths exist
- `check-no-inline-subject-truncate.mjs` — email subject clamping
- `check-docs-no-zar-billing.mjs` / `check-docs-staleness.mjs` — docs hygiene
- `check-operational-visual-tokens.mjs` — design token usage
- `check-match-lifecycle-mirror.mjs` — lifecycle helper drift
- `check-legacy-admin-rls.mjs` — legacy `admin` role RLS guard
- `check-webhook-callsite-idempotency.mjs` — webhook idempotency
- `check-fx-no-importers.mjs` — FX layer not re-introduced
- `check-bypass-callsites.mjs` — test-mode bypass audit coverage
- `check-public-page-imports.mjs` — public pages don't import auth code
- `check-edge-function-rpc-coverage.mjs` — edge RPCs are migration-backed (Batch U)
- `check-csv-export-audit.mjs` — sensitive CSV exports are audited (Batch U)
- `check-batch-suite-presence.mjs` — every closeout-report batch row has a matching test (Batch W)
- `check-release-gate-sync.mjs` — prebuild scripts + critical cron jobs are documented (Batch W)

Closeout & handover artefacts (must be reviewed before client sign-off):

- `docs/closeout-report.md` — batch A–V completion table with test pins
- `docs/deferred-policy-register.md` — client-owned policy decisions
- `docs/launch-runbook.md` — go-live procedure, cron heartbeats, Sentry, demo exclusion, seeders refused in prod, rollback, sign-off matrix
- `docs/handover.md` — non-technical client summary

**Blocker:** Any command exits non-zero.

---

## 2. Auth & Permissions (~3 min)

| Check | Route | Expected |
|-------|-------|----------|
| Unauthenticated landing | `/` | Landing page renders, no console errors |
| Sign-in flow | `/auth` | Email/password login succeeds, redirects to `/dashboard` |
| Dashboard guard | `/dashboard` (logged out) | Shows "Please sign in" prompt, not a flash of dashboard |
| Admin guard | `/admin` (non-admin user) | Redirects to `/dashboard`, no admin UI flicker |
| Sign-out | Sidebar → Sign Out | Clears session, returns to landing |
| Session expiry | Close tab, wait 5 min, reopen `/dashboard` | Either restores session or shows sign-in cleanly |

**Blocker:** Admin content visible to non-admin. Dashboard visible without auth.

---

## 3. Critical Flows (~4 min)

### Trading Partner Search
1. `/dashboard/search` → enter a known entity name → results appear
2. Click a result → detail loads without error

### Match Lifecycle
1. `/dashboard/matches` → list loads (or shows empty state if none)
2. Click a match → `/dashboard/matches/:id` → tabs render (Documents, Notes, Deal Terms)
3. Upload a document → verify file appears in list (test with `.pdf` and reject a `.exe` renamed to `.pdf`)

### Settings & Account
1. `/dashboard/settings` → all tabs render
2. `/dashboard/account` → profile form loads, org details visible

### Admin (requires admin account)
1. `/admin` → Overview tab loads with stats
2. Switch to Entities, Matches, Audit tabs → data loads or shows empty state
3. Checkpoint verification -> "DD Only" mode completes without errors

**Blocker:** Search returns unhandled error. Match detail crashes. File upload bypasses validation.

---

## 4. Loading / Error / Empty States (~2 min)

| Scenario | How to test | Expected |
|----------|-------------|----------|
| Slow load | Throttle to "Slow 3G" in DevTools → `/dashboard` | `FullPageLoader` spinner, no layout shift |
| API failure | Block `*supabase*` in DevTools Network → reload `/dashboard/matches` | `ErrorState` card with retry button |
| Empty data | New account with no matches → `/dashboard/matches` | "No matches yet" empty state, not a blank page |
| Edge function down | `/dashboard/search` with backend offline | Inline error with retry, not silent failure |

**Blocker:** Blank page on any failure. Silent data loss.

---

## 5. Visual & Responsive (~2 min)

### Desktop (1280px+)
- [ ] Landing hero layout intact, no overflow
- [ ] Dashboard sidebar collapses/expands correctly
- [ ] Admin tables don't horizontally overflow

### Mobile (390px)
- [ ] Landing page scrollable, CTA visible without horizontal scroll
- [ ] Dashboard sidebar becomes sheet/drawer
- [ ] Match detail tabs stack or scroll horizontally
- [ ] All modals/dialogs fit viewport

### Dark Mode
- [ ] Toggle theme → no white flashes, text remains readable
- [ ] Cards and badges maintain contrast

**Blocker:** Content unreachable on mobile. Unreadable text in either theme.

---

## 6. Console & Network Hygiene (~1 min)

- [ ] No `console.error` on initial load of `/`, `/dashboard`, `/admin`
- [ ] No failed network requests (red in DevTools) on happy path
- [ ] No `401` responses when authenticated
- [ ] No secrets/tokens visible in client-side source or network payloads

**Blocker:** Leaked secrets. Auth errors on valid session.

---

## 7. Drift & Consistency (~1 min)

- [ ] `npm run check:drift` passes (no raw footers, no inline back-buttons)
- [ ] All page titles use `<PageContainer>` (spot-check 3 pages)
- [ ] All authenticated pages use `RequireAuth` or `useAuth` guard

**Blocker:** Drift violations detected.

---

## Release Blocker Summary

A release is **blocked** if any of these are true:

1. `npm run build` fails
2. `npm run check:drift` fails
3. Any test suite fails
4. Admin UI visible to non-admin users
5. Dashboard accessible without authentication
6. Blank page on any error/loading/empty state
7. Content unreachable on mobile viewport
8. Secrets exposed in client bundle or network
9. File upload accepts spoofed MIME types
10. Silent data loss (form submission fails without user feedback)

---

## Post-Publish Verification

After clicking **Publish → Update**:

1. Visit published URL → landing loads
2. Sign in → dashboard loads
3. Open browser console → no errors
4. Test on actual mobile device if possible

> **Estimated time:** 12–15 minutes for full pass.
