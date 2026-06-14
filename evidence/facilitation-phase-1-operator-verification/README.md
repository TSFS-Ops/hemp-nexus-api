# Facilitation Phase 1 — Org A / Org B Headless Verification Pack

- Run 1: 2026-06-13T17:49:08Z — 14/15 (storage upload 503)
- Run 2: 2026-06-13T18:01:18Z — 14/15 (storage upload still 503; recursion identified)
- Run 3: 2026-06-13T18:31:32Z — 15/16 PASS, 1 FAIL (storage upload green; cross-org SELECT leak surfaced)
- Run 4: 2026-06-13T18:45:01Z — **17/17 PASS** (RESTRICTIVE conversion closes the cross-org leak)
- Harness: `supabase/functions/uat-facilitation-phase-1/index.ts`
- Raw run-4 output: `run-4-headless-after-restrictive-fix.json`

## Verdict

**PHASE_1_CLIENT_UAT_READY** — closed 2026-06-14.

- Headless pack: **PASS** (17/17, Run 4 2026-06-13T18:45:01Z)
- Storage / RLS corrective fixes: **PASS** (3 migrations; see Corrective fixes below)
- `platform_admin` manual leg: **PASS** (operator-attested by Josh Kruger 2026-06-14; see `platform-admin/attestation.md`)
- Negative controls: **PASS** (no writes to pois/wads/matches/token_ledger/token_purchases/notification_dispatches/email_send_log/poi_engagements/non-facilitation audit_logs in the negative-control window)
- No outreach / no send path: **PASS** (`check-facilitation-no-send-path.mjs` prebuild guard)

Known Phase 1 UX gap (non-blocking): the **Assign owner** field is a freehand UUID input. Backend gate is correct (Zod `uuid()` validation); a member picker scoped to `platform_admin` / `compliance_analyst` should be added before customer-facing GA.

Phase 2 (approved-email outreach + duplicate checks + do-not-contact checks + compliance escalation, still no SLA/reporting dashboard) is **NOT STARTED** and is gated on this closeout.

## Client UAT Note (Phase 1)

Please verify the following end-to-end as a non-admin trader signed in as a normal organisation user, and then re-verify the admin steps as a `platform_admin`:

1. **As a trader:** create a facilitation request from a trade request (counterparty cannot be found on platform).
2. **As a `platform_admin`:** confirm the request appears in **HQ → Facilitation Queue**.
3. **As a `platform_admin`:** open the case drawer and **assign an owner** (UUID input in Phase 1; expect success toast + `facilitation_case.assigned` event in timeline).
4. **As a `platform_admin`:** **change status** via an allowed transition; expect `facilitation_case.status_changed` event.
5. **As a `platform_admin`:** **add an internal note**; expect `facilitation_case.note_added` event.
6. **As the requesting trader:** confirm the requester milestone view **updates** to reflect the new status.
7. **As the requesting trader:** confirm the requester **cannot see** internal admin notes or the internal event log (only milestone-level state, no admin payload fields).

Do NOT expect any of the following in Phase 1 (deliberately deferred to Phase 2): outbound email, notification dispatch, SLA timers, reporting dashboards, POI / WaD / match / token / credit / payment effects.


## Corrective fixes applied (cumulative)

1. **`20260613180059_facilitation_case_visible_helper`** — SECURITY DEFINER helper for `fevd_select`/`fevd_insert` on `facilitation-evidence`.
2. **`20260613183111_match_document_visible_helper`** — SECURITY DEFINER helpers `public.match_document_visible` and `public.document_access_visible` break the recursive chain between `match_documents` and `document_access` SELECT policies (pre-existing platform RLS recursion).
3. **`20260613184415_storage_permissive_to_restrictive`** (this pass) — converts two broad PERMISSIVE storage.objects policies to RESTRICTIVE so they constrain rather than permit.

## Corrective fix #3 — RESTRICTIVE conversion

```sql
DROP POLICY IF EXISTS "Deny anon/auth on evidence-waiver-packets" ON storage.objects;
CREATE POLICY "Deny anon/auth on evidence-waiver-packets"
  ON storage.objects AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (bucket_id <> 'evidence-waiver-packets')
  WITH CHECK (bucket_id <> 'evidence-waiver-packets');

DROP POLICY IF EXISTS "No authenticated access to archived records" ON storage.objects;
CREATE POLICY "No authenticated access to archived records"
  ON storage.objects AS RESTRICTIVE FOR ALL TO authenticated
  USING (bucket_id <> 'archived-records')
  WITH CHECK (bucket_id <> 'archived-records');
```

**Why this works.** Postgres OR-combines PERMISSIVE policies. The two policies above were authored as PERMISSIVE with `USING (bucket_id <> '<denied>')`, intending to deny on a single bucket — but as PERMISSIVE they instead acted as broad ALLOW rules for every *other* bucket, OR-ing past stricter per-bucket policies (including `fevd_select` on `facilitation-evidence`). RESTRICTIVE policies are AND-combined, so the same predicate now constrains access to the named buckets without granting anything on other buckets. Access to every other bucket must then come from an explicit per-bucket PERMISSIVE allow policy, which is the documented intent.

### Before / After

| Check | Run 3 (before fix) | Run 4 (after fix) |
|---|---|---|
| `orgB.storage_download_denied` | **FAIL — 200** with body `uat probe 2026-06-13T18:31:32.334Z` | **PASS — 404 `Object not found`** |
| `orgA.storage_upload` | PASS — 200 | PASS — 200 (unchanged) |
| `orgA.register_evidence` | PASS — 201 | PASS — 201 (unchanged) |
| `orgB.get_case_denied` | PASS — 404 | PASS — 404 (unchanged) |
| `orgB.list_excludes_a` | PASS — total=0, leaked=false | PASS — total=0, leaked=false |
| `orgB.rls_cases_empty` / `_events_empty` / `_evidence_empty` | PASS — 0 / 0 / 0 | PASS — 0 / 0 / 0 |

No widened cross-org access. No facilitation business-logic change. No POI/WaD/match/token/credit/payment/notification/email/engagement mutation.

### Negative controls — clean

Window `2026-06-13T18:45:01Z → 18:45:16Z`:
`pois=0, wads=0, matches=0, token_ledger=0, token_purchases=0, notification_dispatches=0, email_send_log=0, poi_engagements=0, audit_logs(actor∈test users)=0`.

## Outstanding

1. `platform_admin` manual leg — see `platform-admin-manual-checklist.md`. Fresh fixture for that leg:
   - Case ID: `174eef8c-6c81-417b-9517-929ced10376a`
   - Case number: `FAC-2026-000006`
   - Requesting org (Org A): `06f34183-1807-49a0-910e-a13e6fef6bd6`
   - (Case was closed by harness cleanup — reseed or filter by `closed_admin`, or re-run the harness immediately before the manual pass to seed a fresh `new` case.)

Verdict remains **PHASE_1_PARTIAL — NOT CLIENT_UAT_READY** until the manual leg is attached.
