# PR #26 — Execution Validation Package

**Status:** Prepared, NOT executed. No changes were made to the live Lovable Cloud database. No changes were made to the current Lovable workspace tree (which cannot be confirmed as branch `fix/pilot-readiness-checks`).

This package must be run by a human operator (or CI job) in an environment that satisfies **all** of the following preconditions:

- Has git access to the repository and can check out branch `fix/pilot-readiness-checks` / PR #26.
- Has a **disposable** local PostgreSQL 15 database (or a scratch Supabase project) that is not shared with any tenant data.
- Has terminal access with `git`, `node` ≥ 20, `bun` (or `npm`), `psql`, and the Supabase CLI (`supabase` ≥ 1.180) installed.
- Can run the project's full Vitest suite and `tsgo` typecheck.
- Can open the branch's preview build in a browser and authenticate as a seeded pilot user.

If any precondition is not met, **stop** and do not proceed. Do not run any step of this package against the live Lovable Cloud database.

---

## 0. Environment sanity

```bash
git --version
node --version
bun --version   # or: npm --version
psql --version
supabase --version
```

Record the versions in your run log.

---

## 1. Branch checkout (confirm you are on PR #26)

```bash
# From a clean working copy — no local edits.
git fetch origin
git checkout fix/pilot-readiness-checks
git pull --ff-only origin fix/pilot-readiness-checks

# Prove the tree matches PR #26's head:
git log -1 --oneline
git rev-parse HEAD              # capture this SHA in the run log
gh pr view 26 --json headRefOid  # must match the SHA above
git status                      # must report a clean tree
```

**Do not proceed** unless `HEAD` equals PR #26's `headRefOid` and `git status` is clean.

---

## 2. Clean disposable database setup

Pick **one** of the two options below. Do **not** point at the live Lovable Cloud DB.

### 2a. Local Supabase (recommended — mirrors production shape)

```bash
supabase stop || true
rm -rf supabase/.branches supabase/.temp
supabase start
# Capture the local DB URL that `supabase start` prints:
export DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
psql "$DATABASE_URL" -c "select current_database(), inet_server_addr();"
# Confirm 127.0.0.1 — refuse to proceed if this points anywhere else.
```

### 2b. Standalone throwaway Postgres

```bash
createdb pr26_validation
export DATABASE_URL="postgresql://$USER@127.0.0.1:5432/pr26_validation"
# Bootstrap required extensions the project assumes:
psql "$DATABASE_URL" <<'SQL'
create extension if not exists "pgcrypto";
create extension if not exists "uuid-ossp";
SQL
```

---

## 3. Apply all migrations (fresh)

```bash
# Local Supabase route:
supabase db reset --linked=false
# The reset applies every file under supabase/migrations/ in order against the local DB.

# OR, for the standalone Postgres route:
for f in supabase/migrations/*.sql; do
  echo "--- applying $f"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f" || { echo "MIGRATION FAILED: $f"; exit 1; }
done
```

**Expected:** Every migration applies without error. The last line printed must be a success message, not a `MIGRATION FAILED`.

---

## 4. Idempotency proof (re-apply must be a no-op)

```bash
# Local Supabase:
supabase db reset --linked=false   # second reset must succeed identically

# Standalone Postgres — replay only the PR #26 migrations against the already-migrated DB:
git diff --name-only origin/main...HEAD -- supabase/migrations \
  | while read f; do
      echo "--- re-applying $f"
      psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f" || { echo "IDEMPOTENCY FAIL: $f"; exit 1; }
    done
```

**Expected:** Zero errors. Any `CREATE TABLE`/`CREATE POLICY`/`INSERT` in the PR #26 migrations must use `IF NOT EXISTS` / `ON CONFLICT DO NOTHING` / `CREATE OR REPLACE` so a second run is harmless.

---

## 5. Isolation-readiness SQL patch (step 5)

Save the following as `supabase/tests/pr26_isolation_readiness_proof.sql`. **Do not commit it to the current Lovable workspace.** Commit it only on the confirmed `fix/pilot-readiness-checks` branch.

```sql
-- Proves Isolation Test Fund cannot see the demo deal.
-- Fails loudly if any funder_deal_releases row links the demo match to it.
do $$
declare
  v_iso_org uuid;
  v_demo_match uuid;
  v_count int;
begin
  select id into v_iso_org
    from public.organizations
   where name = 'Isolation Test Fund'
   limit 1;
  if v_iso_org is null then
    raise exception 'Isolation Test Fund organisation not seeded';
  end if;

  select match_id into v_demo_match
    from public.funder_deal_releases
   order by created_at asc
   limit 1;
  if v_demo_match is null then
    raise exception 'No demo funder_deal_releases row found to test against';
  end if;

  select count(*) into v_count
    from public.funder_deal_releases
   where match_id = v_demo_match
     and funder_organisation_id = v_iso_org;

  if v_count <> 0 then
    raise exception
      'ISOLATION FAIL: % release row(s) link demo match % to Isolation Test Fund %',
      v_count, v_demo_match, v_iso_org;
  end if;

  raise notice 'ISOLATION OK: demo match % has zero releases to Isolation Test Fund', v_demo_match;
end $$;
```

Run it:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/pr26_isolation_readiness_proof.sql
```

**Expected output:** `NOTICE:  ISOLATION OK: demo match <uuid> has zero releases to Isolation Test Fund`.

---

## 6. Verify every synthetic fixture and relationship

```sql
-- Save as: /tmp/pr26_fixture_checks.sql
\echo === organisations ===
select name, id
  from public.organizations
 where name in ('Demo Trading Co', 'Demo Counterparty Ltd', 'Demo Funder', 'Isolation Test Fund')
 order by name;

\echo === demo match ===
select id, buyer_org_id, seller_org_id, status
  from public.matches
 where id in (select match_id from public.funder_deal_releases)
 order by created_at desc
 limit 5;

\echo === funder org onboarding requests ===
select organisation_name, status
  from public.funder_org_onboarding_requests
 order by created_at desc;

\echo === funder deal releases (should link demo match to Demo Funder only) ===
select r.id, o.name as funder_org, r.match_id, r.status
  from public.funder_deal_releases r
  join public.organizations o on o.id = r.funder_organisation_id
 order by r.created_at desc;

\echo === release consents ===
select release_id, consent_type, granted_by
  from public.funder_release_consents
 order by created_at desc;

\echo === sealed pack versions ===
select id, release_id, version, storage_path is not null as has_path, sha256 is not null as has_hash
  from public.funder_pack_versions
 order by created_at desc;
```

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f /tmp/pr26_fixture_checks.sql
```

**Expected:**
- All four organisations present.
- Exactly one demo match with populated buyer/seller org IDs.
- `funder_deal_releases` links the demo match to **Demo Funder** only — never to Isolation Test Fund.
- Consent rows exist for the release.
- A sealed pack version exists with `has_path=t` and `has_hash=t`.

---

## 7. Readiness RPC

```sql
select * from public.fw_admin_check_pilot_fixtures_v1();
```

**Expected output shape** (single row):

| check_name                          | status | detail                          |
|-------------------------------------|--------|---------------------------------|
| demo_organisations_present          | ok     | 4 organisations found           |
| demo_match_exists                   | ok     | match_id=<uuid>                 |
| demo_funder_onboarding_approved     | ok     | Demo Funder approved            |
| isolation_fund_onboarding_approved  | ok     | Isolation Test Fund approved    |
| demo_release_present                | ok     | release_id=<uuid>               |
| isolation_fund_has_no_release       | ok     | 0 releases linked               |
| sealed_pack_present                 | ok     | version=1, sha256 present       |

If any row is not `ok`, **stop** and record the failing `detail`.

---

## 8. Focused test commands

```bash
bun install --frozen-lockfile

# Batch 6 demo journey + pilot readiness fixes:
bunx vitest run src/tests/funder-workspace-batch6-demo-journey.test.ts
bunx vitest run src/tests/funder-workspace-pilot-readiness-fixes.test.ts
```

**Expected:** Both suites green with 0 failures.

---

## 9. Full Vitest run

```bash
bunx vitest run
```

**Expected:** All non-quarantined suites pass. Note any newly failing suites in the run log — a new failure blocks merge.

---

## 10. TypeScript typecheck

```bash
bunx tsgo --noEmit -p tsconfig.app.json
bunx tsgo --noEmit -p tsconfig.json
```

**Expected:** Zero diagnostics.

---

## 11. Browser validation (branch preview)

Perform against the **branch preview** for PR #26, not the production URL.

1. Sign in as `demo.admin@izenzo.test` (seeded platform admin).
2. Navigate to **Admin → Funder Workspace → Onboarding Requests**. Confirm Demo Funder and Isolation Test Fund appear as **Approved**.
3. Navigate to **Admin → Funder Workspace → Releases**. Confirm the demo release lists **Demo Funder** as the funder and shows the readable deal name (not a bare UUID).
4. Sign out. Sign in as `demo.funder@izenzo.test` (Demo Funder approver).
5. Navigate to **Funder → Workspace → Deals**. Confirm exactly one deal is visible with the readable name.
6. Open the deal, generate/download the sealed pack. Confirm the PDF opens and identifies buyer and seller by name.
7. Sign out. Sign in as `isolation.funder@izenzo.test` (Isolation Test Fund approver).
8. Navigate to **Funder → Workspace → Deals**. Confirm the list is **empty** — no demo deal visible.
9. Attempt direct URL access to the demo release ID from step 3. Confirm a 403/404 denial page.

Capture a screenshot of each step and store under `evidence/pr-26-validation/`.

---

## 12. Non-technical pass/fail checklist

| # | Check                                                                 | Pass? |
|---|-----------------------------------------------------------------------|-------|
| 1 | Branch SHA matches PR #26 head, working tree clean                    | ☐     |
| 2 | Disposable DB used — URL contains `127.0.0.1` or dedicated scratch    | ☐     |
| 3 | Fresh migrations applied with zero errors                             | ☐     |
| 4 | Re-applying migrations produced zero errors (idempotent)              | ☐     |
| 5 | Isolation proof printed `ISOLATION OK`                                | ☐     |
| 6 | All fixture queries returned the expected shape                       | ☐     |
| 7 | `fw_admin_check_pilot_fixtures_v1()` returned all `ok`                | ☐     |
| 8 | Focused Vitest suites (batch 6 + readiness fixes) green               | ☐     |
| 9 | Full Vitest run green                                                 | ☐     |
| 10| `tsgo` typecheck green                                                | ☐     |
| 11| Demo Funder sees the demo deal with readable name and downloadable pack | ☐     |
| 12| Isolation Test Fund sees zero deals and cannot open the demo release  | ☐     |

**All 12 boxes must be ticked before PR #26 may be marked ready for review or merged.**

---

## 13. Cleanup

```bash
# Local Supabase:
supabase stop
rm -rf supabase/.branches supabase/.temp

# Standalone Postgres:
dropdb pr26_validation

# Local branch:
git checkout main
git branch -D fix/pilot-readiness-checks   # optional — only if you no longer need it locally
unset DATABASE_URL
```

Delete any transient files created under `/tmp/pr26_fixture_checks.sql`. Retain the `evidence/pr-26-validation/` screenshots and the run log.

---

## Explicit non-claims

- PR #26 is **NOT** validated by this document. It is validated only after a human/CI operator runs every section above against a disposable database and every checklist item in §12 is ticked.
- No change has been made to the live Lovable Cloud database.
- No change has been made to the current Lovable workspace tree. In particular, the isolation proof in §5 has **not** been committed here — it must be added on the confirmed `fix/pilot-readiness-checks` branch by the operator running this package.

## Who must run this package

This package must be executed by **one of**:

- The CI pipeline attached to PR #26 (preferred — fully automated, reproducible), **or**
- A developer with local checkout of `fix/pilot-readiness-checks`, a disposable Postgres/Supabase instance, and terminal access.

The Lovable agent working in this workspace **cannot** run it, because this workspace cannot be confirmed as PR #26's branch and the only reachable database is the live Lovable Cloud project.

**PR #26 must remain a draft and the manual pilot must remain paused until the operator above returns a fully green §12 checklist.**
