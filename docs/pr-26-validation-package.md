# PR #26 - Execution Validation Package

**Status:** Prepared, NOT executed against any database. No changes have been made to the live Lovable Cloud database.

This package validates PR #26 (branch `fix/pilot-readiness-checks`), which introduces:

- `supabase/migrations/20260713090000_pilot_fixture_and_readiness_rpc.sql` - creates the DEMO/TEST trading fixtures (buyer, seller, canonical match, documents, evidence chain) and reuses the two pre-existing pilot funder-organisation rows.
- `public.fw_admin_check_pilot_fixtures_v1()` - the independent readiness-check RPC. This RPC is a real, intentional deliverable of PR #26. It does not exist on `main` today and will exist only once this PR merges. An earlier draft of this document incorrectly claimed no such RPC exists or should exist; that claim applied only to `main` before this PR, not to PR #26 itself, and is corrected here.

The current Lovable workspace agent cannot run this package: it has no git-branch access, no disposable database, and no authenticated preview browser session. This package must be executed by a human operator or by CI (`.github/workflows/pr26-pilot-readiness-validation.yml`) in an environment that satisfies **all** of the following preconditions:

- git access to the repository, able to check out branch `fix/pilot-readiness-checks` / PR #26.
- a **disposable** local PostgreSQL 15 database (or scratch Supabase project) that shares no data with any tenant.
- terminal access with `git`, `node` >= 20, `bun` (or `npm`), `psql`, and the Supabase CLI (`supabase` >= 1.180) installed.
- ability to run the project's Vitest suite and `tsgo` typecheck.
- ability to open PR #26's branch preview in a browser and authenticate as a seeded pilot user.

If any precondition is not met, **stop**. Do not run any step of this package against the live Lovable Cloud database.

---

## 0. Environment sanity

```bash
git --version
node --version
bun --version # or: npm --version
psql --version
supabase --version
```

Record the versions in the run log.

---

## 1. Branch checkout (confirm you are on PR #26)

```bash
git fetch origin
git checkout fix/pilot-readiness-checks
git pull --ff-only origin fix/pilot-readiness-checks

git log -1 --oneline
git rev-parse HEAD # capture in the run log
gh pr view 26 --json headRefOid # must equal HEAD
git status # must be clean
```

**Do not proceed** unless `HEAD` equals PR #26's `headRefOid` and `git status` is clean.

---

## 2. Clean disposable database setup

Pick **one** of the two options below. Do **not** point at the live Lovable Cloud DB.

### 2a. Local Supabase (recommended - mirrors production shape)

```bash
supabase stop || true
rm -rf supabase/.branches supabase/.temp
supabase start
export DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
psql "$DATABASE_URL" -c "select current_database(), inet_server_addr();"
# Confirm 127.0.0.1 - refuse to proceed otherwise.
```

### 2b. Standalone throwaway Postgres 15

```bash
createdb pr26_validation
export DATABASE_URL="postgresql://$USER@127.0.0.1:5432/pr26_validation"
psql "$DATABASE_URL" -c "create extension if not exists pgcrypto;"
```

Standalone Postgres also needs a minimal Supabase compatibility surface (schemas `auth`, `storage`; roles `anon`, `authenticated`, `service_role`; stub functions for `auth.uid()`, `auth.role()`, `auth.jwt()`). The CI workflow `.github/workflows/pr26-pilot-readiness-validation.yml` bootstraps this same surface and is the reference implementation. This surface does not prove real Supabase Auth, Storage, or RLS behaviour - it only makes the migrations apply and lets the readiness RPC be called outside a real authenticated session.

---

## 3. Apply all migrations (fresh)

```bash
# Local Supabase route:
supabase db reset --linked=false

# Standalone Postgres route:
for f in supabase/migrations/*.sql; do
echo "--- applying $f"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f" || { echo "MIGRATION FAILED: $f"; exit 1; }
done
```

**Expected:** every migration applies without error, including `20260713090000_pilot_fixture_and_readiness_rpc.sql`.

---

## 4. Idempotency proof (drop + reapply must succeed)

```bash
# Local Supabase:
supabase db reset --linked=false

# Standalone Postgres:
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "drop schema public cascade; create schema public; grant all on schema public to postgres, anon, authenticated, service_role;"

for f in supabase/migrations/*.sql; do
echo "--- re-applying $f"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f" || { echo "IDEMPOTENCY FAIL: $f"; exit 1; }
done
```

**Expected:** zero errors. All inserts in `20260713090000_pilot_fixture_and_readiness_rpc.sql` use `ON CONFLICT (id) DO NOTHING` and never overwrite an existing row at a fixed id.

---

## 5. Pilot fixture + readiness RPC verification (the real check, not inline SQL guesses)

`fw_admin_check_pilot_fixtures_v1()` is `SECURITY DEFINER`, requires the caller to pass `public.p5b3_is_platform_admin()`, and returns exactly one row per check as `(check_key, label, status, detail)` with `status` in `Ready` / `Missing` / `Incorrectly linked`. The nine rows it returns are:

| check_key | What it verifies |
|---|---|
| `funder_org_bank` | Pilot Funder Bank (`11111111-1111-1111-1111-111111111111`) exists, active, approved |
| `funder_org_isolation` | Isolation Test Fund (`22222222-2222-2222-2222-222222222222`) exists, active, approved |
| `buyer_org` | DEMO - Acacia Trading Test Pty Ltd exists and is the match's `buyer_org_id` |
| `seller_org` | DEMO - Blue River Exports Test Pty Ltd exists and is the match's `seller_org_id` |
| `demo_match` | The canonical demo match (`00000000-0000-4000-a000-000000000005`) exists with correct buyer/seller linkage |
| `doc_invoice` | DEMO pro-forma invoice is attached to the demo match |
| `doc_bol` | DEMO bill of lading is attached to the demo match |
| `evidence_pack` | The synthetic evidence pack/version chain is correctly linked and `fw_admin_list_eligible_evidence_packs_v1` considers it eligible |
| `isolation_no_release` | Isolation Test Fund has zero `funder_deal_releases` rows linking it to the demo match |

Because the RPC gates on `p5b3_is_platform_admin()` (which reads `auth.uid()`), a disposable database with the stubbed `auth.uid()` returning `NULL` cannot call it successfully as-is - `NULL = NULL` never matches in the underlying role check. The CI workflow works around this, for the disposable database only, by seeding one synthetic `platform_admin` user-role row and redefining `auth.uid()` to return that fixed id for the remainder of the session. This is a CI-only shim; it must never be applied anywhere near a real Supabase project.

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "insert into auth.users (id, email) values ('99999999-9999-9999-9999-999999999999','ci-platform-admin@pr26.invalid') on conflict (id) do nothing;"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "insert into public.user_roles (user_id, role) select '99999999-9999-9999-9999-999999999999'::uuid, 'platform_admin'::public.app_role where not exists (select 1 from public.user_roles where user_id = '99999999-9999-9999-9999-999999999999'::uuid and role = 'platform_admin'::public.app_role);"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "create or replace function auth.uid() returns uuid language sql stable as 'select ''99999999-9999-9999-9999-999999999999''::uuid';"

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "select * from public.fw_admin_check_pilot_fixtures_v1();"
```

**Expected:** all nine rows return `status = 'Ready'`. Any `Missing` means a fixture insert did not happen; any `Incorrectly linked` means a row exists at a fixed id but with wrong relationships (the migration deliberately never repairs this automatically - it is a signal to investigate, not to silently fix).

Pre-release readiness (this section) requires only the source evidence pack chain. It does **not** require, and must not fail on the absence of, a `funder_deal_releases` row, `funder_release_consents` rows, or a `funder_pack_versions` row - those are created later in section 11's manual walkthrough.

---

## 6. Isolation invariant (redundant direct-SQL proof)

The `isolation_no_release` row above is the authoritative check. As defense-in-depth, confirm it directly:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "select count(*) from public.funder_deal_releases where funder_organisation_id = '22222222-2222-2222-2222-222222222222' and match_id = '00000000-0000-4000-a000-000000000005';"
```

**Expected:** `0`. This does not require any release to Pilot Funder Bank to exist first - it only forbids a release pointing at the isolation fixture.

---

## 7. Source pack vs. sealed funder PDF - do not confuse them

Two distinct artefacts, in this order:

1. **Source evidence pack** - a Batch-2 pack on `public.p5_batch2_evidence_packs`, resolved via `public.fw_admin_list_eligible_evidence_packs_v1(match_id)`. This is the pack the admin selects when creating a release. This is what section 5's `evidence_pack` check verifies.
2. **Sealed funder PDF** - a `public.funder_pack_versions` row generated after the admin releases a deal and the pack pipeline seals a PDF for that funder. This does not exist, and is not expected to exist, until section 11 step 4.

---

## 8. Focused test commands

```bash
bun install --frozen-lockfile

bunx vitest run src/tests/funder-workspace-batch6-demo-journey.test.ts src/tests/funder-workspace-pilot-readiness-fixes.test.ts src/tests/funder-workspace-pilot-pack-resolution.test.ts src/tests/funder-workspace-release-state-consistency.test.ts src/tests/funder-workspace-pilot-fixture-migration.test.ts src/tests/funder-workspace-batch3-funder-ui.test.ts src/tests/pr26-pilot-readiness-workflow-conformance.test.ts
```

**Expected:** all suites green.

---

## 9. Full Vitest run

```bash
bunx vitest run
```

**Expected:** all non-quarantined suites pass. Any new failure blocks merge.

---

## 10. TypeScript typecheck

```bash
bunx tsgo --noEmit -p tsconfig.app.json
```

**Expected:** zero diagnostics.

---

## 11. Browser validation (branch preview)

Perform against PR #26's **branch preview**, not production.

1. Sign in as the seeded platform admin used by the pilot (see the workspace admin seeding for the actual email; do not assume a specific address).
2. Admin -> Funder Workspace -> Onboarding Requests: confirm Pilot Funder Bank and Isolation Test Fund appear approved.
3. Admin -> Funder Workspace -> New Release: select the seeded demo canonical deal and confirm the eligible source evidence pack is auto-selected (see `funder-workspace-pilot-pack-resolution.test.ts`).
4. Create the release to Pilot Funder Bank and generate the sealed funder PDF.
5. Sign out and sign in as the Pilot Funder Bank approver. Funder -> Workspace -> Deals: confirm the released deal is visible and the sealed PDF downloads via a signed URL.
6. Sign out and sign in as the Isolation Test Fund approver. Funder -> Workspace -> Deals: confirm the list is empty. Attempt the released deal's direct URL and confirm denial.

Capture a screenshot per step under `evidence/pr-26-validation/`.

---

## 12. Non-technical pass/fail checklist

| # | Check | Pass? |
|---|-----------------------------------------------------------------------|-------|
| 1 | Branch SHA matches PR #26 head, working tree clean | [ ] |
| 2 | Disposable DB used - URL contains `127.0.0.1` or dedicated scratch | [ ] |
| 3 | Fresh migrations applied with zero errors | [ ] |
| 4 | Drop + reapply produced zero errors (idempotent) | [ ] |
| 5 | `fw_admin_check_pilot_fixtures_v1()` returned all nine rows `Ready` | [ ] |
| 6 | Redundant isolation-invariant query returned `0` | [ ] |
| 7 | Focused Vitest suites listed in section 8 all green | [ ] |
| 8 | Full Vitest run green | [ ] |
| 9 | `tsgo` typecheck green | [ ] |
| 10 | Pilot Funder Bank preview journey succeeded end-to-end | [ ] |
| 11 | Isolation Test Fund preview showed zero deals and denied direct URL | [ ] |
| 12 | Screenshots stored under `evidence/pr-26-validation/` | [ ] |

**All 12 boxes must be ticked before PR #26 may be marked ready for review or merged.**

---

## 13. Cleanup

```bash
# Local Supabase:
supabase stop
rm -rf supabase/.branches supabase/.temp

# Standalone Postgres:
dropdb pr26_validation

git checkout main
unset DATABASE_URL
```

Retain the `evidence/pr-26-validation/` screenshots and the run log.

---

## Explicit non-claims

- PR #26 is not validated by this document. It is validated only after a human/CI operator runs every section above against a disposable database and every checklist item in section 12 is ticked.
- No change has been made to the live Lovable Cloud database.
- The current Lovable workspace agent cannot run this package: it has no git-branch access, no disposable database, and no authenticated preview browser session.
- An earlier commit on `main` (26ebbd0, "Prepared PR #26 validation pkg") described this same RPC as fictional and used table/column names that do not match the actual migration. That version was written before PR #26's fixture migration and RPC existed in any reachable branch and is superseded by this document.

## Who must run this package

- CI: the workflow `.github/workflows/pr26-pilot-readiness-validation.yml` executes the automatable portion (sections 3-6, 8-10) against a disposable Postgres 15 service container and enforces a fail-closed final gate.
- Human: sections 1, 2, 11, and 12 require a developer with a checkout of `fix/pilot-readiness-checks`, a disposable Postgres/Supabase instance, and an authenticated PR #26 branch preview.

**PR #26 must remain a draft and the manual pilot must remain paused until both the CI workflow reports green and the human sections return a fully ticked checklist.**
