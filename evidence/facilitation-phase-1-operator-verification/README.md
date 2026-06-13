# Facilitation Phase 1 — Org A / Org B Headless Verification Pack

- First run: 2026-06-13T17:49:08Z (14/15)
- Re-run after corrective fix: 2026-06-13T18:01:18Z (14/15)
- Harness: `supabase/functions/uat-facilitation-phase-1/index.ts`

## Verdict

**PHASE_1_PARTIAL — NOT CLIENT_UAT_READY**

14 / 15 checks pass. The corrective storage-policy helper migration is in place and verified, but `orgA.storage_upload` still fails — root cause has been re-identified as a **pre-existing RLS recursion defect outside the facilitation surface**, documented below. Verdict remains PARTIAL until that defect is fixed (with explicit authorisation) and the platform_admin manual leg is attached.

## Corrective fix applied

Migration `20260613180059_facilitation_case_visible_helper`:

```sql
CREATE OR REPLACE FUNCTION public.facilitation_case_visible(_user uuid, _case uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.facilitation_cases fc
    WHERE fc.id = _case
      AND ( fc.requesting_org_id IN (SELECT p.org_id FROM public.profiles p WHERE p.id = _user)
         OR fc.case_owner_id = _user
         OR public.is_admin(_user)
         OR public.has_role(_user, 'compliance_analyst'::public.app_role) )
  );
$$;
REVOKE ALL ON FUNCTION public.facilitation_case_visible(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.facilitation_case_visible(uuid, uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS fevd_select ON storage.objects;
DROP POLICY IF EXISTS fevd_insert ON storage.objects;
CREATE POLICY fevd_select ON storage.objects FOR SELECT
  USING ( bucket_id = 'facilitation-evidence'
          AND public.facilitation_case_visible(auth.uid(), NULLIF(split_part(name,'/',1),'')::uuid) );
CREATE POLICY fevd_insert ON storage.objects FOR INSERT
  WITH CHECK ( bucket_id = 'facilitation-evidence'
          AND public.facilitation_case_visible(auth.uid(), NULLIF(split_part(name,'/',1),'')::uuid) );
```

Verified post-migration:
- Helper returns `t` for Org A user + their case_id.
- `fevd_select` (polcmd `r`) and `fevd_insert` (polcmd `a`) registered on `storage.objects`.
- Same access boundary — no widening, no narrowing.

## Re-run results (15 checks)

All 14 prior PASSes remain PASS (provision A/B, distinct orgs, trade-request seed, create case, created-event row, get case, Org B 404 / list excludes A / RLS zero-rows on cases+events+evidence, negative controls all zero, cleanup).

| ID | Before fix | After fix |
|---|---|---|
| orgA.storage_upload | FAIL (400 / 503 DatabaseInvalidObjectDefinition) | FAIL (400 / 503 DatabaseInvalidObjectDefinition) |

Negative controls remain clean: 0 new rows across pois, wads, matches, token_ledger, token_purchases, poi_engagements, notification_dispatches, email_send_log, audit_logs (for the test users) in the run window 2026-06-13T18:01:18Z → 18:01:27Z.

## Root cause re-identified (revised)

The previous summary attributed the storage failure to the `fevd_*` policies' chained EXISTS. The helper fix resolved that shape, but the failure persists with an identical 503 body. Postgres logs (`postgres_logs`, timestamp 2026-06-13T18:01:26Z, mid-run):

> `infinite recursion detected in policy for relation "document_access"`

Confirmed cycle (`pg_get_expr` extracts):

1. `storage.objects` SELECT policy **"View match documents based on visibility"** subqueries `public.match_documents`.
2. `public.match_documents` SELECT policy **"Document visibility based on ownership and sharing"** subqueries `public.document_access`.
3. `public.document_access` SELECT policy **"Users can view access grants for their documents"** subqueries `public.match_documents` → **loop**.

Because Supabase Storage evaluates the full `storage.objects` policy set on any upload (planner side), this recursion breaks every authenticated INSERT into the bucket — including ours. **This defect is pre-existing and unrelated to the facilitation feature**: the same 503 was present before the helper migration with the same body.

## Smallest safe fix proposal (NOT YET APPLIED — awaiting authorisation)

Add one SECURITY DEFINER helper and rewrite both recursive policies to call it:

```sql
CREATE OR REPLACE FUNCTION public.match_document_visible(_user uuid, _document_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.match_documents md
    WHERE md.id = _document_id
      AND ( md.uploader_org_id IN (SELECT p.org_id FROM public.profiles p WHERE p.id = _user)
         OR md.id IN (
              SELECT da.document_id FROM public.document_access da
              WHERE da.revoked_at IS NULL
                AND ( da.granted_to_org_id IN (SELECT p.org_id FROM public.profiles p WHERE p.id = _user)
                   OR da.granted_to_user_id = _user )
            )
         OR public.is_admin(_user) )
  );
$$;
```

This is corrective only — same access boundary as today, removes the cycle by terminating the policy chain inside SECURITY DEFINER. **It is outside the originally authorised facilitation-helper scope and therefore not applied.**

## Outstanding

- Authorisation decision on the `match_documents` ↔ `document_access` corrective helper.
- platform_admin manual leg (see `platform-admin-manual-checklist.md`).

Verdict remains **PHASE_1_PARTIAL — NOT CLIENT_UAT_READY**.
