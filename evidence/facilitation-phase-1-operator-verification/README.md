# Facilitation Phase 1 — Org A / Org B Headless Verification Pack

- Run 1: 2026-06-13T17:49:08Z — 14/15 (storage upload 503)
- Run 2: 2026-06-13T18:01:18Z — 14/15 (storage upload still 503; recursion identified)
- Run 3: 2026-06-13T18:31:32Z — **15/16 PASS, 1 FAIL** (storage upload now green; cross-org SELECT leak surfaced)
- Harness: `supabase/functions/uat-facilitation-phase-1/index.ts`

## Verdict

**PHASE_1_PARTIAL — NOT CLIENT_UAT_READY**

The approved recursion fix is in place and verified. A separate, pre-existing platform-wide storage RLS misconfiguration is now the sole remaining blocker. It is out of facilitation scope and not auto-fixed during this verification pass — awaiting explicit authorisation.

## Corrective fix #2 applied (this pass)

Migration `20260613183111_match_document_visible_helper`:

```sql
CREATE OR REPLACE FUNCTION public.match_document_visible(_user uuid, _document_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.match_documents md
    WHERE md.id = _document_id
      AND ( md.uploader_org_id IN (SELECT p.org_id FROM public.profiles p WHERE p.id = _user)
         OR md.id IN (
              SELECT da.document_id FROM public.document_access da
              WHERE da.granted_to_org_id IN (SELECT p.org_id FROM public.profiles p WHERE p.id = _user)
                 OR da.granted_to_user_id = _user)
         OR public.is_admin(_user) )
  );
$$;
REVOKE ALL ON FUNCTION public.match_document_visible(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_document_visible(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.document_access_visible(_user uuid, _document_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.match_documents md
    WHERE md.id = _document_id
      AND md.uploader_org_id IN (SELECT p.org_id FROM public.profiles p WHERE p.id = _user))
  OR EXISTS (SELECT 1 FROM public.document_access da
    WHERE da.document_id = _document_id
      AND (da.granted_to_org_id IN (SELECT p.org_id FROM public.profiles p WHERE p.id = _user)
        OR da.granted_to_user_id = _user))
  OR public.is_admin(_user);
$$;
REVOKE ALL ON FUNCTION public.document_access_visible(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.document_access_visible(uuid, uuid) TO authenticated, service_role;

DROP POLICY "Document visibility based on ownership and sharing" ON public.match_documents;
CREATE POLICY "Document visibility based on ownership and sharing"
  ON public.match_documents FOR SELECT
  USING (public.match_document_visible(auth.uid(), id));

DROP POLICY "Users can view access grants for their documents" ON public.document_access;
CREATE POLICY "Users can view access grants for their documents"
  ON public.document_access FOR SELECT
  USING (public.document_access_visible(auth.uid(), document_id));
```

### Before / After

| Check | Run 2 (before fix) | Run 3 (after fix) |
|---|---|---|
| `orgA.storage_upload` | FAIL — 503 `DatabaseInvalidObjectDefinition` ("infinite recursion detected in policy for relation \"document_access\"") | **PASS — 200** |
| `orgA.register_evidence` | not reached | **PASS — 201** |

Access boundary preserved: no widening, no change to ownership/upload rules, no change to POI/WaD/match/token/credit/payment/notification/email/facilitation case behaviour.

### Negative controls — clean

`pois=0, wads=0, matches=0, token_ledger=0, token_purchases=0, notification_dispatches=0, email_send_log=0, poi_engagements=0, audit_logs(actor∈test users)=0` for the run window `2026-06-13T18:31:32Z → 18:31:38Z`. Confirmed across both runs.

## Remaining blocker — separate platform defect

`orgB.storage_download_denied` failed: Org B was able to GET Org A's facilitation evidence object with HTTP 200.

The `fevd_select` policy itself is correct — `facilitation_case_visible(B.user_id, A.case_id)` returns false. The actual leak comes from two **permissive** storage.objects policies whose USING clauses are written as `bucket_id <> '<denied-bucket>'`:

| Policy | polpermissive | Roles | USING |
|---|---|---|---|
| `Deny anon/auth on evidence-waiver-packets` | **true** | anon, authenticated | `bucket_id <> 'evidence-waiver-packets'` |
| `No authenticated access to archived records` | **true** | authenticated | `bucket_id <> 'archived-records'` |

Because they are PERMISSIVE (not RESTRICTIVE), they act as broad allow-rules for every other bucket. Postgres OR's permissive policies, so any authenticated user passes the SELECT check on facilitation-evidence (and every other private bucket whose per-bucket policy is stricter).

**This is platform-wide. It pre-dates Phase 1 and is not part of the facilitation feature surface.**

### Smallest safe fix proposal (NOT APPLIED — awaiting authorisation)

Convert both policies to `AS RESTRICTIVE`:

```sql
DROP POLICY "Deny anon/auth on evidence-waiver-packets" ON storage.objects;
CREATE POLICY "Deny anon/auth on evidence-waiver-packets"
  ON storage.objects AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (bucket_id <> 'evidence-waiver-packets')
  WITH CHECK (bucket_id <> 'evidence-waiver-packets');

DROP POLICY "No authenticated access to archived records" ON storage.objects;
CREATE POLICY "No authenticated access to archived records"
  ON storage.objects AS RESTRICTIVE FOR ALL TO authenticated
  USING (bucket_id <> 'archived-records')
  WITH CHECK (bucket_id <> 'archived-records');
```

After this, only buckets with an explicit permissive allow remain reachable — which is the documented intent (kyc-documents, match-documents, match-challenge-evidence, user-exports, admin-exports, facilitation-evidence via `fevd_select`).

**This is a platform-wide RLS change. It is out of facilitation scope and not auto-applied. Awaiting explicit approval.**

## Outstanding

1. Authorisation decision on the storage RESTRICTIVE-policy fix above.
2. platform_admin manual leg (see `platform-admin-manual-checklist.md`).

Verdict remains **PHASE_1_PARTIAL — NOT CLIENT_UAT_READY**.
