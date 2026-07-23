# Dependency audit plan — 2026-07-23

Branch: `triage/repo-ci-debt-2026-07-23`. No dependency changes are included in this branch; a
separate `hardening/dependency-audit-plan-2026-07-23` branch was not created because no changes
are being applied here (per instructions, that branch is only needed if changes are actually
made).

## Command and current findings

`npm audit --omit=dev --audit-level=high` reports 13 vulnerabilities (2 moderate, 10 high, 1
critical):

| Package | Severity | Vulnerable range | Direct or transitive |
|---|---|---|---|
| brace-expansion | high | 2.0.0 - 2.1.1 | transitive (via glob) |
| esbuild | moderate | <=0.24.2 \|\| 0.27.3 - 0.28.0 | transitive (via vite/vitest) |
| glob | high | 10.2.0 - 10.4.5 | transitive |
| minimatch | high | 9.0.0 - 9.0.6 | transitive (via glob) |
| picomatch | high | <=2.3.1 \|\| 4.0.0 - 4.0.3 | transitive |
| postcss | high | <=8.5.11 | direct (`package.json` dependencies, `^8.5.6`) |
| react-router | high | 7.0.0 - 7.15.0 | transitive (via react-router-dom) |
| react-router-dom | high | 7.0.0-pre.0 - 7.14.1 | direct (`package.json` dependencies, `^7.18.1`) |
| undici | high | 7.0.0 - 7.27.2 | transitive |
| vite | high | <=6.4.2 \|\| 7.0.0 - 7.3.3 | both: direct devDependency (`^5.4.19`) and a separate nested copy required by `vitest` |
| vitest | critical | >=4.0.0 <4.1.0 | direct (`package.json` **dependencies**, `^4.1.9` - see note below) |
| ws | high | 8.0.0 - 8.20.1 | transitive |
| yaml | moderate | 2.0.0 - 2.8.2 | transitive |

Note on `vitest`: it is declared under `"dependencies"` (production), not `"devDependencies"`,
in `package.json` (line 102), which is why a `--omit=dev` audit sees it and its internal `vite`
copy at all. `vite` itself is correctly a devDependency (line 126), but because `vitest` is
(apparently mis-classified as) a production dependency, `vitest`'s own nested `vite` requirement
is pulled into the "production" audit surface. This classification looks like an oversight
worth a follow-up (moving `vitest` to `devDependencies`), but reclassifying it is a separate,
deliberate change with its own blast radius (it changes what `npm install --omit=dev` installs)
and is out of scope for this security-focused pass - flagged here for awareness only, not
changed.

## Attempted fix and why it was reverted

`npm audit fix --omit=dev` (no `--force`) was run to see whether all 13 vulnerabilities could be
resolved without semver-major bumps:

- Result: `package.json` was **not** modified at all (confirmed via `git diff package.json` -
  zero output). `package-lock.json` changed significantly ("added 7 packages, removed 128
  packages, changed 75 packages"). Re-running `npm audit --omit=dev --audit-level=high`
  afterward reported "found 0 vulnerabilities".
- On the surface this looked like exactly the safe, in-range, patch/minor-only fix the task asks
  for. However, running the actual test suite afterward immediately failed:
  ```
  Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@vitejs/plugin-react-swc' imported from
  /workspaces/hemp-nexus-api/node_modules/.vite-temp/vitest.config.ts...
  ```
  every single test file failed to even load, not just PayFast-related ones (confirmed with
  `src/tests/role-confirmation.test.ts`, an unrelated file). Root cause: `npm audit fix` deduped
  the nested `vite` copy required by `vitest` up to `vite@8.1.5`, which is incompatible with the
  `@vitejs/plugin-react-swc` devDependency that the vitest config relies on; npm's tree
  restructuring silently dropped/orphaned that plugin's resolution.
- This is a concrete demonstration that `fixAvailable: true` and "no `package.json` changes" are
  not sufficient proof that a fix is safe - nested/peer dependency relationships can still break
  invisibly. Per instructions ("if major/breaking changes are required, do not apply"), this was
  treated as unsafe and fully reverted:
  - `git checkout -- package.json package-lock.json`
  - `npm install` to restore working `node_modules`
  - Re-ran `npx vitest run src/tests/role-confirmation.test.ts` -> 1 passed (8 tests), confirming
    the revert restored a working state.
- No dependency files are changed on this branch. `git status --short package.json
  package-lock.json` is clean.

## Secondary finding (unrelated to the vulnerabilities, noted for completeness)

`npm ci` fails against the currently-committed `package-lock.json` on `main`, independent of any
of the above:
```
npm error Invalid: lock file's @supabase/auth-js@2.75.0 does not satisfy @supabase/auth-js@2.110.8
```
(and the same for `@supabase/functions-js`, `@supabase/postgrest-js`, `@supabase/realtime-js`,
`@supabase/storage-js`). This means CI's install step must be using `npm install` (or `bun
install`) rather than a strict `npm ci`, and the lockfile has pre-existing internal drift for the
`@supabase/*` packages, unrelated to the security vulnerabilities above. This is separate,
pre-existing repo debt worth a follow-up but was not touched here.

## Recommended plan (not executed)

1. Do not run a blind `npm audit fix` (demonstrated unsafe above).
2. Regenerate the lockfile cleanly first (`rm -rf node_modules package-lock.json && npm install`)
   to resolve the pre-existing `@supabase/*` drift, on its own reviewed branch, with a full
   test/build run before touching any vulnerable package.
3. Address the transitive-only packages (`brace-expansion`, `esbuild`, `glob`, `minimatch`,
   `picomatch`, `undici`, `ws`, `yaml`) one at a time, ideally via targeted `overrides` in
   `package.json` pinned to the fixed versions, re-running the full test suite and a production
   build after each single change, rather than letting npm restructure the whole tree at once.
4. For the two direct dependencies (`postcss`, `react-router-dom`), bump within the already
   satisfied caret range first (confirm via `npm ls`) before considering any range change in
   `package.json`.
5. Treat `vite`/`vitest` as the highest-risk item: the critical `vitest` advisory
   (`GHSA-5xrq-8626-4rwp`, arbitrary file read/execute when the Vitest UI server is listening) is
   a devDependency-only, non-production exposure - the Vitest UI is not started by any of this
   repo's CI jobs or scripts, so real-world exploitability in this repo's context is very low.
   Recommend fixing this last and only via a deliberate, isolated `vitest`/`vite`/
   `@vitejs/plugin-react-swc` upgrade set that is version-matched together and fully regression
   tested, not via automatic tooling.
6. Consider, separately, moving `vitest` from `dependencies` to `devDependencies` in
   `package.json` (likely a classification bug) - as its own tiny, reviewed change, not bundled
   with the security work.

## Final status

DEPENDENCY_AUDIT_PLAN_ONLY
