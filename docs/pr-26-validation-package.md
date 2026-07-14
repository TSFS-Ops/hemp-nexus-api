# PR #26 - Execution Validation Package

**Status:** Prepared, NOT executed. No changes have been made to the live Lovable Cloud database. This document lives in the current Lovable workspace, which cannot be confirmed as branch `fix/pilot-readiness-checks`; do not treat its presence here as evidence that PR #26 has been validated.

The current Lovable workspace agent cannot run this package: it has no git-branch access, no disposable database, and no authenticated preview browser session. This package must be executed by a human operator (or CI job) in an environment that satisfies **all** of the following preconditions:

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
bun --version   # or: npm --version
psql --version
supabase --version
```

Record the versions in the run log.

---

## 1. Branch checkout (confirm you are on PR #26)

```bash
# From a clean working copy - no local edits.
git fetch origin
git checkout fix/pilot-readiness-checks
git pull --ff-only origin fix/pilot-readiness-checks

git log -1 --oneline
git rev-parse HEAD               # capture in the run log
gh pr view 26 --json headRefOid  # must equal HEAD
git status                       # must be clean
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
psql "$DATABASE_URL" <<'SQL'
create extension if not exists "pgcrypto";
create extension if not exists "uuid-ossp";
SQL
```

Standalone Postgres also needs the minimal Supabase compatibility surface (schemas `auth`, `storage`, `extensions`; roles `anon`, `authenticated`, `service_role`; stubs for `auth.uid()`, `auth.jwt()`, `auth.role()`, `storage.foldername()`, `storage.filename()`, `storage.extension()`). The CI workflow `.github/workflows/pr26-pilot-readiness-validation.yml` bootstraps this same surface and is the reference implementation. This surface does not prove real Supabase Auth, Storage, or RLS behaviour - it only makes the migrations apply.

---

## 3. Apply all migrations (fresh)

```bash
# Local Supabase route:
supabase db reset --linked=false

# Standalone Postgres route:
for f in supabase/migrations/*.sql; do
  echo "--- applying $f"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f" \
    || { echo "MIGRATION FAILED: $f"; exit 1; }
done
```

**Expected:** every migration applies without error.

---

## 4. Idempotency proof (drop + reapply must succeed)

```bash
# Local Supabase:
supabase db reset --linked=false

# Standalone Postgres:
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO postgres, anon, authenticated, service_role;
SQL

for f in supabase/migrations/*.sql; do
  echo "--- re-applying $f"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f" \
    || { echo "IDEMPOTENCY FAIL: $f"; exit 1; }
done
```

**Expected:** zero errors. Any `CREATE TABLE`, `CREATE POLICY`, or seed `INSERT` in PR #26 migrations must use `IF NOT EXISTS`, `ON CONFLICT DO NOTHING`, or `CREATE OR REPLACE`.

---

## 5. Pilot fixture verification (use the actual fixed IDs)

The pilot-readiness migration (`supabase/migrations/20260712174259_*.sql`) updates two rows on `public.p5_batch3_funder_organisations`:

| Role                | Fixed ID                                     | Table                                       |
|---------------------|----------------------------------------------|---------------------------------------------|
| Pilot Funder Bank   | `11111111-1111-1111-1111-111111111111`       | `public.p5_batch3_funder_organisations`     |
| Isolation Test Fund | `22222222-2222-2222-2222-222222222222`       | `public.p5_batch3_funder_organisations`     |

There is **no** funder-org row on `public.organizations` for these fixtures, and there is **no** dedicated readiness RPC for the pilot fixtures in the current workspace migrations. Any earlier draft of this document that assumed such an RPC was incorrect; the checks below are inline SQL against the tables above.

Run:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
DECLARE v_pfb int; v_itf int;
BEGIN
  SELECT count(*) INTO v_pfb
    FROM public.p5_batch3_funder_organisations
   WHERE id = '11111111-1111-1111-1111-111111111111'
     AND jurisdiction IS NOT NULL
     AND registration_number IS NOT NULL;
  IF v_pfb <> 1 THEN
    RAISE EXCEPTION 'FIXTURE_FAIL: Pilot Funder Bank missing or lacks corrected fields';
  END IF;

  SELECT count(*) INTO v_itf
    FROM public.p5_batch3_funder_organisations
   WHERE id = '22222222-2222-2222-2222-222222222222'
     AND jurisdiction IS NOT NULL
     AND registration_number IS NOT NULL;
  IF v_itf <> 1 THEN
    RAISE EXCEPTION 'FIXTURE_FAIL: Isolation Test Fund missing or lacks corrected fields';
  END IF;

  RAISE NOTICE 'FIXTURES_OK';
END $$;
SQL
```

**Expected:** `NOTICE:  FIXTURES_OK`.

---

## 6. Isolation invariant

The isolation invariant is a **negative** check: no `funder_deal_releases` row may point at the Isolation Test Fund. It does **not** require a legitimate release to Pilot Funder Bank to exist first.

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
DECLARE v_bad int;
BEGIN
  SELECT count(*) INTO v_bad
    FROM public.funder_deal_releases
   WHERE funder_organisation_id = '22222222-2222-2222-2222-222222222222';
  IF v_bad <> 0 THEN
    RAISE EXCEPTION 'ISOLATION_FAIL: % release(s) linked to Isolation Test Fund', v_bad;
  END IF;
  RAISE NOTICE 'ISOLATION_OK';
END $$;
SQL
```

**Expected:** `NOTICE:  ISOLATION_OK`.

---

## 7. Source pack vs. sealed funder PDF - do not confuse them

Two distinct artefacts, in this order:

1. **Source evidence pack** - a Batch-2 pack on `public.p5_batch2_evidence_packs`, resolved via `public.fw_admin_list_eligible_evidence_packs_v1(match_id)`. This is the pack the admin selects when *creating* a release.
2. **Sealed funder PDF** - a `public.funder_pack_versions` row generated **after** the admin releases a deal and the pack pipeline seals a PDF for that funder.

Pre-release readiness (steps 5-6 above) requires only the source pack. A missing `funder_pack_versions` row before the admin manually creates the release is normal and must not fail readiness.

---

## 8. Focused test commands

```bash
bun install --frozen-lockfile

bunx vitest run \
  src/tests/funder-workspace-batch6-demo-journey.test.ts \
  src/tests/funder-workspace-pilot-readiness-fixes.test.ts \
  src/tests/funder-workspace-pilot-pack-resolution.test.ts \
  src/tests/funder-workspace-release-state-consistency.test.ts \
  src/tests/pr26-pilot-readiness-workflow-conformance.test.ts
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
2. Admin -> Funder Workspace -> Onboarding Requests: confirm Pilot Funder Bank and Isolation Test Fund appear with the corrected jurisdiction and registration number labels (no dash-only placeholder).
3. Admin -> Funder Workspace -> New Release: select the seeded demo canonical deal and confirm the eligible source evidence pack is auto-selected (see `funder-workspace-pilot-pack-resolution.test.ts`).
4. Create the release to Pilot Funder Bank and generate the sealed funder PDF.
5. Sign out and sign in as the Pilot Funder Bank approver. Funder -> Workspace -> Deals: confirm the released deal is visible and the sealed PDF downloads via a signed URL.
6. Sign out and sign in as the Isolation Test Fund approver. Funder -> Workspace -> Deals: confirm the list is empty. Attempt the released deal's direct URL and confirm denial.

Capture a screenshot per step under `evidence/pr-26-validation/`.

---

## 12. Non-technical pass/fail checklist

| # | Check                                                                 | Pass? |
|---|-----------------------------------------------------------------------|-------|
| 1 | Branch SHA matches PR #26 head, working tree clean                    | [ ]   |
| 2 | Disposable DB used - URL contains `127.0.0.1` or dedicated scratch    | [ ]   |
| 3 | Fresh migrations applied with zero errors                             | [ ]   |
| 4 | Drop + reapply produced zero errors (idempotent)                      | [ ]   |
| 5 | Fixture check printed `FIXTURES_OK`                                   | [ ]   |
| 6 | Isolation check printed `ISOLATION_OK`                                | [ ]   |
| 7 | Focused Vitest suites listed in section 8 all green                   | [ ]   |
| 8 | Full Vitest run green                                                 | [ ]   |
| 9 | `tsgo` typecheck green                                                | [ ]   |
| 10| Pilot Funder Bank preview journey succeeded end-to-end                | [ ]   |
| 11| Isolation Test Fund preview showed zero deals and denied direct URL   | [ ]   |
| 12| Screenshots stored under `evidence/pr-26-validation/`                 | [ ]   |

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

- PR #26 is **not** validated by this document. It is validated only after a human/CI operator runs every section above against a disposable database and every checklist item in section 12 is ticked.
- No change has been made to the live Lovable Cloud database.
- The current Lovable workspace cannot execute this package: it has no git-branch access, no disposable database, and no authenticated preview browser session.

## Who must run this package

- CI: the workflow `.github/workflows/pr26-pilot-readiness-validation.yml` executes the automatable portion (sections 3-6, 8-10) against a disposable Postgres 15 service container and enforces a fail-closed final gate.
- Human: sections 1, 2, 11, and 12 require a developer with a checkout of `fix/pilot-readiness-checks`, a disposable Postgres/Supabase instance, and an authenticated PR #26 branch preview.

**PR #26 must remain a draft and the manual pilot must remain paused until both the CI workflow reports green and the human sections return a fully ticked checklist.**
