# PR #26 - Execution Validation Package

Status: corrected draft. This replaces an earlier version of this file that
was committed directly to `main` (commit 26ebbd0, "Prepared PR #26
validation pkg") instead of to `fix/pilot-readiness-checks`, and that
referenced fixtures, tables and an RPC output shape that do not match this
migration. That version should be treated as void. This version lives on
the actual PR branch and has been checked line-by-line against:

- `supabase/migrations/20260713090000_pilot_fixture_and_readiness_rpc.sql`
- `src/pages/admin/funder-workspace/PilotConsole.tsx`
- `src/pages/funder/workspace/DealDetail.tsx`
- `src/pages/admin/funder-workspace/NewRelease.tsx`
- `src/tests/funder-workspace-batch3-funder-ui.test.ts`
- `src/tests/funder-workspace-pilot-fixture-migration.test.ts`
- `supabase/functions/fw-pilot-seed/index.ts` (pre-existing, unchanged by this PR)

No change has been made to the live Lovable Cloud database. No migration has
been executed. This document does not itself validate PR #26 - it is only a
correct, unambiguous set of steps for someone with a disposable database and
a terminal to run.

---

## Preconditions

Do not proceed unless all of the following are true:

- You have git access and can check out branch `fix/pilot-readiness-checks`.
- You have a disposable Postgres/Supabase instance that holds no tenant data.
- You have `git`, `node` >= 20, `bun` (the project's package manager per
  `.github/workflows/ci.yml`), `psql`, and the Supabase CLI installed.
  - You are not pointed at the live Lovable Cloud project's database.

  If any of these is false, stop. Do not run any step below against the live
  Lovable Cloud database.

  ---

  ## A. Automated source validation (no database required)

  ```bash
  git fetch origin
  git checkout fix/pilot-readiness-checks
  git pull --ff-only origin fix/pilot-readiness-checks
  git rev-parse HEAD
  gh pr view 26 --json headRefOid   # must equal the SHA above
  ```

  Install and run the focused and full suites:

  ```bash
  bun install --frozen-lockfile

  # Focused: the tests this PR added/touched.
  bunx vitest run src/tests/funder-workspace-pilot-fixture-migration.test.ts
  bunx vitest run src/tests/funder-workspace-batch3-funder-ui.test.ts
  bunx vitest run src/tests/funder-workspace-pilot-pack-resolution.test.ts

  # Full suite.
  bunx vitest run

  # Typecheck (this project uses plain tsc, not tsgo; there is no
  # "typecheck" package.json script, so invoke tsc directly against the
  # same config the existing CI workflow uses):
  bunx tsc --noEmit
  ```

  Expected: all listed suites pass with zero failures, and `tsc --noEmit`
  reports zero diagnostics. Record the actual pass/fail counts in your run log
  - do not summarize as "passed" without the numbers.

  Note: the repository's existing `CI / Lint -> Typecheck -> Test -> Build`
  workflow currently fails on this PR at the `bun run lint` step, before it
  reaches typecheck or tests. Confirmed by inspection of the failing job: all
  6 ESLint errors are in files this PR does not touch (`src/pages/admin/
  funder-workspace/Releases.tsx`, `src/pages/funder/workspace/components/
  FunderBadges.tsx`, `src/tests/funder-workspace-batch1-foundation.test.ts`,
  `src/tests/funder-workspace-batch6-notifications.test.ts`). The `CI /
  Schema drift check` and `CI / Dependency audit` jobs also fail for reasons
  unrelated to this PR (stale public-page footer/back-button lint rules;
  pre-existing npm dependency CVEs). The `CI / E2E - POI mint soft-route` job
  fails only because `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` and
  `SUPABASE_SERVICE_ROLE_KEY` are not configured as repo secrets. None of
  these four pre-existing failures block validating this PR's own diff; do
  not let them get attributed to PR #26 in a run log.

  ---

  ## B. Disposable database validation

  Do not point any of this at the live Lovable Cloud project.

  ### B1. Fresh migration apply

  ```bash
  supabase stop || true
  supabase start
  # supabase start prints the local Postgres URL, normally:
  export DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
  psql "$DATABASE_URL" -c "select inet_server_addr();"   # must show 127.0.0.1 or be local
  supabase db reset --no-linked
  ```

  Expected: every file under `supabase/migrations/` applies without error,
  including `20260713090000_pilot_fixture_and_readiness_rpc.sql`.

  ### B2. Idempotency proof (second reset)

  ```bash
  supabase db reset --no-linked
  ```

  Expected: identical success, zero errors, zero duplicate-key violations.

  ### B3. Fixture and relationship queries

  Run against the local database. These use the exact fixed ids and table
  names from the migration - not placeholder names.

  ```sql
  -- Funder organisations: pre-existing ids, reused (not newly created).
  select id, name, status, approval_status
  from public.p5_batch3_funder_organisations
  where id in (
    '11111111-1111-1111-1111-111111111111',
      '22222222-2222-2222-2222-222222222222'
      )
      order by name;
      -- Expect: 'Pilot Funder Bank' (11111111...) and 'Isolation Test Fund'
      -- (22222222...), both status = active.

      -- Demo trading organisations.
      select id, name, status
      from public.organizations
      where id in (
        '00000000-0000-4000-a000-000000000003',
          '00000000-0000-4000-a000-000000000004'
          )
          order by name;
          -- Expect: 'DEMO - Acacia Trading Test Pty Ltd' and
          -- 'DEMO - Blue River Exports Test Pty Ltd'.

          -- Canonical demo match.
          select id, buyer_org_id, seller_org_id, buyer_name, seller_name, hash
          from public.matches
          where id = '00000000-0000-4000-a000-000000000005';
          -- Expect: buyer_org_id = ...0003, seller_org_id = ...0004,
          -- hash = 'DEMO-ACACIA-BLUERIVER-PILOT-TRADE'.

          -- Demo documents.
          select id, match_id, doc_type, status
          from public.match_documents
          where id in (
            '00000000-0000-4000-a000-000000000006',
              '00000000-0000-4000-a000-000000000007'
              )
              order by doc_type;
              -- Expect: both rows have match_id = ...0005 and status = 'accepted'.

              -- Evidence chain.
              select id, current_version_id
              from public.p5_batch2_evidence_items
              where id = '00000000-0000-4000-a000-000000000009';
              -- Expect: current_version_id = '00000000-0000-4000-a000-00000000000a'.

              select ep.id as pack_id, epi.id as pack_item_id, epi.evidence_item_id, epi.version_id
              from public.p5_batch2_evidence_packs ep
              join public.p5_batch2_evidence_pack_items epi on epi.pack_id = ep.id
              where ep.id = '00000000-0000-4000-a000-00000000000b';
              -- Expect: one row, evidence_item_id = ...0009, version_id = ...000a.
              ```

              ### B4. Readiness RPC

              Call this as a platform_admin user (via the Supabase SQL editor authenticated
              as a service-role/admin session, or via `psql` with a role that satisfies
              `p5b3_is_platform_admin()`):

              ```sql
              select * from public.fw_admin_check_pilot_fixtures_v1();
              ```

              Expected output shape: 9 rows, columns `check_key, label, status, detail`,
              with `status` taking only the values `Ready`, `Missing`, or `Incorrectly
              linked` (never `ok`). Immediately after a fresh migration apply, before any
              release exists, expect all 9 rows to read `Ready`, including
              `isolation_no_release` (a zero-row count is a Ready result, not a Missing
              one - it does not require a release to already exist).

              ### B5. Isolation proof

              The RPC's 9th row already proves this, but to check it independently:

              ```sql
              select count(*) as releases_to_isolation_fund
              from public.funder_deal_releases
              where match_id = '00000000-0000-4000-a000-000000000005'
                and funder_organisation_id = '22222222-2222-2222-2222-222222222222';
                ```

                Expected: `0`, both before any release exists and after a release has been
                correctly made to Pilot Funder Bank instead.

                ### B6. Cleanup

                ```bash
                supabase stop
                unset DATABASE_URL
                ```

                ---

                ## C. Manual browser validation (deployed preview only)

                Perform this against the branch preview, signed in with real credentials
                you hold - do not paste or share passwords in any report.

                1. Sign in as the seeded platform admin: `izenzo-admin+pilot@izenzo.test`
                   (seeded by `supabase/functions/fw-pilot-seed`, unchanged by this PR).
                   2. Open Pilot Console. Confirm Step 1 (fixture readiness) shows all 9 rows
                      as Ready. If any row is not Ready, stop - do not proceed to Step 2.
                      3. Run "Prepare pilot logins" (Step 2). Copy the credentials shown.
                      4. Open "New deal release". Confirm the deal selector finds `DEMO -
                         Acacia-Blue River Pilot Trade` by search, and that no evidence-pack UUID
                            or version has to be typed - the eligible pack auto-fills once the deal
                               is selected.
                               5. Select funder organisation "Pilot Funder Bank" (verify there is exactly
                                  one funder org with that name in the dropdown - if two appear, stop and
                                     report it, since that would indicate the id fix in this document was not
                                        applied to the running database).
                                        6. Record buyer and seller consent as granted, leave raw-document and
                                           unmasked-detail permissions off, set an expiry at least 30 days out, and
                                              save the release.
                                              7. Sign out. Sign in as `pilot-funder-viewer@pilotfunderbank.test` (or any
                                                 of the other `@pilotfunderbank.test` role accounts seeded in Step 3).
                                                    Confirm the demo deal is visible and the stale "PDF generation comes in
                                                       the next build batch" wording is absent.
                                                       8. As `pilot-funder-admin@pilotfunderbank.test`, `pilot-funder-
                                                          reviewer@pilotfunderbank.test` or `pilot-funder-
                                                             approver@pilotfunderbank.test`, post an RFI. Confirm
                                                                `pilot-funder-viewer@pilotfunderbank.test` cannot create one. Confirm
                                                                   only the Approver account can record a formal decision.
                                                                   9. Sign out. Sign in as `isolation-viewer@isolationtestfund.test`. Confirm
                                                                      the assigned-deals list is empty and the demo deal is not visible or
                                                                         directly reachable by its URL.

                                                                         ---

                                                                         ## Non-technical pass/fail checklist

                                                                         | # | Check                                                              | Pass? |
                                                                         |---|---------------------------------------------------------------------|-------|
                                                                         | 1 | Branch checked out at PR #26's actual head SHA, tree clean          |       |
                                                                         | 2 | Focused + full Vitest suites green                                  |       |
                                                                         | 3 | `tsc --noEmit` clean                                                |       |
                                                                         | 4 | Fresh migration apply: zero errors                                  |       |
                                                                         | 5 | Second reset (idempotency): zero errors                             |       |
                                                                         | 6 | Fixture/relationship queries match section B3 exactly               |       |
                                                                         | 7 | `fw_admin_check_pilot_fixtures_v1()` returns 9 rows, all Ready pre-release |  |
                                                                         | 8 | Isolation query in B5 returns 0                                     |       |
                                                                         | 9 | Only one "Pilot Funder Bank" appears in the release funder picker   |       |
                                                                         | 10| Funder pilot users see the released demo deal with sealed pack     |       |
                                                                         | 11| Isolation Test Fund viewer sees zero deals                          |       |

                                                                         All 11 rows must be ticked before PR #26 is marked ready for review.

                                                                         ---

                                                                         ## Explicit non-claims

                                                                         - This document has not itself been executed. It has been checked for
                                                                           internal consistency against the actual migration, RPC, Pilot Console,
                                                                             and pilot seed function source on this branch - not run against a
                                                                               database or test runner.
                                                                               - The earlier `docs/pr-26-validation-package.md` committed to `main`
                                                                                 (commit 26ebbd0) referenced fixture names ("Demo Trading Co", "Demo
                                                                                   Counterparty Ltd", "Demo Funder") that do not exist anywhere in this
                                                                                     migration, queried `public.organizations` for the funder organisations
                                                                                       (they live in `public.p5_batch3_funder_organisations`), selected "the
                                                                                         first release ever created" instead of the fixed demo match, assumed a
                                                                                           release/consents/sealed pack already existed before the manual release
                                                                                             step, and used a `check_name`/`status = 'ok'` shape that does not match
                                                                                               `fw_admin_check_pilot_fixtures_v1()`'s actual `check_key/label/status/
                                                                                                 detail` with `Ready/Missing/Incorrectly linked`. That file should not be
                                                                                                   used, and ideally should be removed or corrected on `main` directly by a
                                                                                                     maintainer - this PR does not touch `main`.
                                                                                                     
