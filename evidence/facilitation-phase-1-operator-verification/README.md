# Facilitation Phase 1 — Org A / Org B Headless Verification Pack

Run timestamp: 2026-06-13T17:49:08Z
Harness: `supabase/functions/uat-facilitation-phase-1/index.ts` (gated on platform_admin JWT or INTERNAL_CRON_KEY; uses INTERNAL_CRON_KEY internally to call provision-test-user; no schema or role changes for verification).

## Verdict

**PHASE_1_PARTIAL — NOT CLIENT_UAT_READY**

14 / 15 checks pass. One blocking defect was found and fixed during the pass (missing GRANTs). One residual storage-policy compile defect remains and is documented below with the smallest safe fix. The platform_admin leg has not yet been completed in preview.

## Checks (Org A positive)

| ID | Result | Detail |
|---|---|---|
| provision.org_a | PASS | user `86571568…bd25`, org `06f34183…6bd6` |
| provision.org_b | PASS | user `b7aee33b…4898`, org `d3301c2f…483e` |
| provision.distinct_orgs | PASS | distinct org_ids |
| seed.trade_request | PASS | `4c26e6ed-6a0e-4d87-86ff-0a5f37128f5a` |
| orgA.create_case | PASS | status 201, case `1c2ca2f0…0c5b`, FAC-2026-000003 |
| orgA.created_event_present | PASS | action=`facilitation_case.created`, from_status=`null`, to_status=`new`, actor=Org A user |
| orgA.get_case | PASS | status 200 |

## Checks (Org B denial)

| ID | Result | Detail |
|---|---|---|
| orgB.get_case_denied | PASS | status 404 (clean RLS denial, not 500) |
| orgB.list_excludes_a | PASS | status 200, total 0, no leak |
| orgB.rls_cases_empty | PASS | 0 rows via JWT-bound client |
| orgB.rls_events_empty | PASS | 0 rows |
| orgB.rls_evidence_empty | PASS | 0 rows |

## Negative-control (no side-effects in run window 17:49:08–17:49:12Z)

| Table | New rows scoped to test orgs/users |
|---|---|
| pois | 0 |
| wads | 0 |
| matches | 0 |
| token_ledger | 0 |
| token_purchases | 0 |
| poi_engagements | 0 |
| notification_dispatches | 0 |
| email_send_log | 0 |
| audit_logs (actor in test users) | 0 |

## Defect found and fixed during the pass

`facilitation_cases`, `facilitation_case_events`, `facilitation_case_evidence` had **zero `GRANT`s** to `authenticated` / `service_role` — confirmed via `information_schema.role_table_grants` returning 0 rows. This violates the project's "every public-schema table must have GRANTs in the same migration" rule and was preventing the storage RLS policies (which subquery `facilitation_cases`) from compiling.

Migration applied:

```sql
GRANT SELECT, INSERT, UPDATE ON public.facilitation_cases TO authenticated;
GRANT ALL ON public.facilitation_cases TO service_role;
GRANT SELECT, INSERT ON public.facilitation_case_events TO authenticated;
GRANT ALL ON public.facilitation_case_events TO service_role;
GRANT SELECT, INSERT ON public.facilitation_case_evidence TO authenticated;
GRANT ALL ON public.facilitation_case_evidence TO service_role;
```

Privileges verified post-migration via `has_table_privilege('authenticated', …)` and `has_function_privilege('authenticated', 'public.has_role(uuid, public.app_role)', 'EXECUTE')` — all `true`.

## Remaining failure (1 / 15)

**`orgA.storage_upload`** — Supabase Storage returns:

```
status 400
{ "statusCode": "503", "error": "DatabaseInvalidObjectDefinition",
  "message": "The database schema is invalid or incompatible." }
```

Even with table grants in place, the storage planner is rejecting the `fevd_insert` / `fevd_select` policy bodies. Most likely the chained `EXISTS … is_admin(...) OR has_role(…, 'compliance_analyst'::app_role)` subquery is being rejected at compile time when invoked from `storage.objects` RLS evaluation.

Smallest safe fix (Phase 1 scope, no feature change, no send path):

1. Add a single SECURITY DEFINER helper:
   ```sql
   CREATE OR REPLACE FUNCTION public.facilitation_case_visible(_user uuid, _case uuid)
   RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
     SELECT EXISTS (
       SELECT 1 FROM public.facilitation_cases fc
       WHERE fc.id = _case
         AND ( fc.requesting_org_id IN (SELECT org_id FROM public.profiles WHERE id = _user)
            OR fc.case_owner_id = _user
            OR public.is_admin(_user)
            OR public.has_role(_user, 'compliance_analyst'::app_role) )
     );
   $$;
   GRANT EXECUTE ON FUNCTION public.facilitation_case_visible(uuid, uuid) TO authenticated;
   ```
2. Replace `fevd_select` / `fevd_insert` policies with a single call to `public.facilitation_case_visible(auth.uid(), split_part(objects.name, '/', 1)::uuid)`.

This is a one-migration fix and stays inside Phase 1 scope. No code, no UI, no send path, no POI/WaD/token/credit/payment behaviour changes.

## Cleanup quirk (non-blocking)

The harness's own cleanup attempted `final_outcome = 'out_of_scope'`, which failed the `facilitation_cases_final_outcome_check` constraint. This is a harness-only issue — it does **not** affect the production code paths and the case was still set to `internal_status='closed_admin'`. Will be tightened on the next run.

## Outstanding (platform_admin leg)

The platform_admin steps still need to be executed manually in the preview by an authorised platform_admin operator — see `platform-admin-manual-checklist.md`. Verdict stays at PHASE_1_PARTIAL until that evidence is attached.
