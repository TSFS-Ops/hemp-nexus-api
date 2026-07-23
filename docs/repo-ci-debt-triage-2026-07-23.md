# Repo-wide CI debt triage — 2026-07-23

Branch: `triage/repo-ci-debt-2026-07-23` (from `main`). Investigation only in this section; see
`docs/repo-ci-debt-repair-2026-07-23.md` for the two low-risk fixes actually applied, and
`docs/dependency-audit-plan-2026-07-23.md` for the dependency-audit findings.

Scope: the 4 CI checks that fail on `main`, on PR #28, and on PR #29 identically:
`Lint -> Typecheck -> Test -> Build`, `Schema drift check`, `E2E - POI mint soft-route (422 -> 202)`,
`Dependency audit (HIGH/CRITICAL gate)`. Confirmed via the latest main CI run (commit `1f187e4`,
CI #2141) that all four fail there too, so none of this is introduced by either open PR.

## 1. Lint failures

Failing command: `bun run lint` (`eslint .`). Exact errors (688 problems total, but only 4 are
errors; the rest are pre-existing warnings that do not fail the gate):

- `src/tests/funder-workspace-batch1-foundation.test.ts:123:30/124:30/125:30` -
  `no-regex-spaces`: three regex literals used 2-4 literal spaces instead of a `{n}` quantifier.
- `src/tests/funder-workspace-batch6-notifications.test.ts:217:18` -
  `@typescript-eslint/no-require-imports`: a `require("node:fs").statSync(p)` call inside a test
  helper, even though the file already does `import { readFileSync, readdirSync } from "node:fs"`
  at the top.

Root cause: stale test-file style, no behavioural issue. Both files are test-only; no production
code involved.

Safe to fix: **yes**, mechanically, with zero behaviour change. Fixed in this session - see the
repair doc.

## 2. Schema drift / UI guard failures

Failing command: `node scripts/check-drift.mjs` (`bun run check:drift`). The guard fails a page
file if it contains raw `<footer>` markup (must use `<PageFooter />` / `<PublicPageLayout />`) or
a duplicated inline "ArrowLeft icon + Back to..." pattern (must use `<BackButton />`).

Violations:
- `src/pages/Auth.tsx:638` - `no-inline-back-button`
- `src/pages/Landing.tsx:49` - `no-raw-footer`
- `src/pages/Trust.tsx:161` - `no-raw-footer`
- `src/pages/products/ComplianceEngine.tsx:186` - `no-raw-footer`
- `src/pages/products/TradeDesk.tsx:111` - `no-raw-footer`
- `src/pages/solutions/Traders.tsx:96` - `no-raw-footer`

Investigation findings (why this is NOT a safe mechanical fix):

- The raw `<footer>` blocks are not identical copies of the shared `PageFooter` component. For
  example `Landing.tsx` renders company-registration copy ("Izenzo is the trading name of
  Starfair162 (Pty) Ltd Reg: 2018/331720/07...") while the shared `src/components/PageFooter.tsx`
  renders different, generic copy ("No VAT charged - supplier not VAT registered in South
  Africa."). Swapping the raw markup for `<PageFooter />` would silently delete or replace
  customer-facing legal/company text on public marketing pages - this is exactly the kind of
  "customer-facing product copy rewrite beyond the exact guard requirement" this engagement is
  not permitted to do without a product decision.
- The `Auth.tsx` violation is a `<button onClick={onBack}>` where `onBack` is a caller-supplied
  callback used to toggle local form state (e.g. moving from the "reset password" view back to
  "sign in" inside the same page), with a custom icon size and className. The shared
  `BackButton` component (`src/components/*BackButton.tsx`) does not accept a custom `onClick`;
  internally it always does `navigate(-1)` or `navigate(fallback)` (browser-history / router
  navigation). Swapping would change actual behaviour (leaving the page instead of switching
  the in-page form view) - a functional regression risk, and `BackButton` is a shared component
  used elsewhere, so widening its API is a broader change than "the smallest safe fix".

Fix safety: **not safe** for an unattended mechanical fix. Recommendation: keep as documented
repo debt; resolve via a dedicated, reviewed PR where a human confirms (a) the intended final
footer copy per page (or explicitly accepts consolidating to the shared copy) and (b) whether
`BackButton` should gain an optional `onClick` override, before any page is touched. No fix
applied in this session.

## 3. E2E - POI mint soft-route (422 -> 202)

Failing step: "Verify required secrets are present" (runs before the actual e2e test).
Exact errors:
```
Error: Required secret VITE_SUPABASE_URL is not configured on this repo.
Error: Required secret VITE_SUPABASE_PUBLISHABLE_KEY is not configured on this repo.
Error: Required secret SUPABASE_SERVICE_ROLE_KEY is not configured on this repo.
Error: Aborting: the e2e soft-route test cannot run without all three secrets.
```

Root cause: this is a missing-CI-secrets/environment issue, not a code defect. The three
secrets are not configured for this workflow context (consistent with a deliberate scoping
decision to keep them out of PR-triggered runs). The neighbouring "Staging smoke A-D (skips if
secrets missing)" job already demonstrates the intended pattern: skip cleanly instead of failing
when secrets are absent.

Fix safety: no code fix is applicable or safe. Do not hardcode secrets; do not weaken the secret
check. The only real fixes are either (a) an org/repo admin adds
`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` as repo/
environment secrets available to this workflow, or (b) a deliberate, reviewed decision to change
this job from "fail" to "skip when secrets are missing" (mirroring the smoke-test job) - which is
a CI policy change, not a code defect fix, and is left for the repo owner to decide since it
changes what "red" vs "green" means for this gate. No change applied in this session.

## 4. Dependency audit (HIGH/CRITICAL gate)

Failing command: `npm audit --omit=dev --audit-level=high`. 13 vulnerabilities (2 moderate, 10
high, 1 critical) across `brace-expansion`, `esbuild`, `glob`, `minimatch`, `picomatch`,
`postcss`, `react-router`, `react-router-dom`, `undici`, `vite`, `vitest`, `ws`, `yaml` - all
transitive/nested except `postcss`, `react-router-dom`, and `vitest`, which are direct
dependencies. Full detail, the attempted fix, why it was reverted, and the recommended plan are
in `docs/dependency-audit-plan-2026-07-23.md`. Summary: an `npm audit fix --omit=dev` attempt
looked safe (zero `package.json` changes, "found 0 vulnerabilities") but actually broke test
execution (`ERR_MODULE_NOT_FOUND` for `@vitejs/plugin-react-swc`) due to nested dependency-tree
restructuring. It was fully reverted; no dependency changes are included in this branch.

## Recommended order of repair

1. Lint errors - lowest risk, already fixed (see repair doc).
2. Dependency audit - needs a careful, isolated, one-package-at-a-time approach (or vetted
   `overrides` in `package.json`) with full test/build validation after each step; do not use a
   blind `npm audit fix`. Medium/variable risk depending on approach; see the dedicated plan doc.
3. Schema drift (footer / back-button) - needs a product/design decision on footer copy and a
   decision on whether to extend `BackButton`'s API; low security risk, medium product-copy risk
   if rushed.
4. E2E missing secrets - pure ops decision (add secrets, or change fail-to-skip); zero code risk
   either way.

## Final status

REPO_CI_DEBT_TRIAGED
