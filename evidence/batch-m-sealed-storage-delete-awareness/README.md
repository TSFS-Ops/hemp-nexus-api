# Batch M — Sealed storage file deletion / bucket delete seal-awareness

**Tracker items:** #11 (underlying sealed document files can be deleted), #70 (storage bucket delete path has no seal awareness).
**Status:** `BATCH_M_SEALED_STORAGE_DELETE_AWARENESS_READY_TO_APPLY_BOTH`
**Mode:** Inspection only — no code, migrations, deploys, RLS/grants/policies/schema, storage policies, buckets, triggers, cron, payments, refunds, ledger, email, legal-hold, or data mutations.

---

## 1. Buckets inspected

Match-document-linked buckets (from `supabase/functions/storage-orphan-cleanup/index.ts:14-19` and prior migrations):

| Bucket | Public | Purpose | DB table (path source) |
| --- | --- | --- | --- |
| `match-documents` | private | Sealed evidence documents referenced by WaD bundles | `match_documents.storage_path` |
| `match-challenge-evidence` | private | Challenge evidence | `match_challenge_evidence.storage_path` |
| `kyc-documents` | private | KYC uploads | `kyc_documents.storage_path` |

Only `match-documents` is in-scope for sealed-WaD linkage; `is_match_document_sealed(_doc_id uuid)` (Batch J2) operates on `match_documents.id`.

**Path shape confirmed** (`supabase/functions/finalise-match-document-upload/index.ts:133`):
`{org_id}/{match_id}/{kind}/{doc_id}` — the final segment IS the `match_documents.id`, so mapping `(bucket_id, object_name) → match_documents.id` is trivial and does not require a JOIN through `storage_path` (though `storage_path` lookup also works).

## 2. Storage policies inspected

`supabase/migrations/20260408181338_308d92bb-cf69-411d-908a-4698401aa7ce.sql` (lines 41-54) — current `match-documents` DELETE policy:

```sql
CREATE POLICY "Org members can delete own match documents"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'match-documents'
  AND (
    (storage.foldername(name))[1] IN (
      SELECT p.org_id::text FROM public.profiles p WHERE p.id = auth.uid()
    )
    OR public.has_role(auth.uid(), 'platform_admin'::public.app_role)
  )
);
```

No `is_match_document_sealed(...)` check. **Any org member (or platform_admin) can `storage.from('match-documents').remove([...])` a file that is referenced by a sealed, non-revoked WaD** even though the `match_documents` row itself is frozen by J2's `match_documents_sealed_immutability_trg`.

The `match-documents` UPDATE policy (lines 27-39) has the same shape and same gap, though UPDATE on `storage.objects` is not the sealed-file exposure path #11/#70 target.

Same missing seal check exists on `kyc-documents` DELETE (lines 71-83) — out of scope for #11/#70 (KYC files are not WaD-bundle-referenced), noted for completeness only.

## 3. Application delete paths inspected

Grep on `.remove(` and `storage.from(` under `supabase/functions` and `src`:

| Path | Deletes storage object? | Seal check? | Verdict |
| --- | --- | --- | --- |
| `finalise-match-document-upload/index.ts:72` — `admin.storage.from("match-documents").remove([body.storage_path])` inside `cleanup()` | Yes, service-role | No | **Safe:** only runs when the finaliser INSERT fails, i.e. before any `match_documents` row exists (therefore not sealed). |
| `storage-orphan-cleanup/index.ts:176` — `adminClient.storage.from(cfg.bucket).remove([file.path])` | Yes, service-role | Implicit | **Safe:** the sweeper only removes files whose path has **no** corresponding DB row (`existsIn(..., "match_documents", "storage_path", p)` filter). A sealed file always has its `match_documents` row present (row frozen by J2), so it is never classified as orphan. |
| `storage-retention-cleanup/index.ts:100-108` — `supabase.storage.from(item.bucket_id).remove([item.file_path])` for every due `storage_deletion_queue` row | Yes, service-role | **No** | **Exposed (defence-in-depth gap):** the queue is populated by `enqueue-storage-cleanup`, which today refuses paths with a live DB row (`has_db_row` check). That relies on the enqueuer being correct; the deleter itself performs no `is_match_document_sealed` check and no cross-reference to `match_documents` before removing. Any future bug/race that lands a sealed-doc path in the queue would silently delete the sealed file. |
| `document-revoke/index.ts`, `document-share/index.ts`, `document-review/index.ts`, `document-download/index.ts` | No `.remove(` calls | n/a | Safe — metadata-only paths; J2 already prevents sealed-row mutation. |
| `data-retention/index.ts:68` | `match_documents: "quarantine"` — no storage deletion | n/a | Safe. |
| `delete-account/index.ts` | No `match-documents` `.remove` | n/a | Safe (does not touch sealed evidence bucket). |
| `enqueue-storage-cleanup/index.ts:37-44` | Enqueues only, refuses paths with existing DB row | Indirect | Enqueue-side guard is present, but it is not a **seal** guard — it is a "has any row" guard. |
| Client `src/lib/upload-cleanup.ts`, `src/components/match/MatchDocuments.tsx`, `src/components/match/GovernanceDocSubmit.tsx` | Direct `supabase.storage.from(...).remove([...])` on failed uploads only | No | Safe: run before finaliser writes a row; storage RLS DELETE policy (see §2) is the actual gate — and that gate is what is missing the seal check. |

## 4. Existing J2 / C10 protection confirmation

- **J2** — `match_documents_sealed_immutability_trg` (`supabase/migrations/20260701213053_*.sql`) blocks UPDATE/DELETE on the `match_documents` **metadata row** when linked to a sealed, non-revoked WaD. Confirmed via `is_match_document_sealed(_doc_id uuid)` helper and static guard `scripts/check-batch-j2-sealed-match-document-freeze.mjs`.
- **C10** — `wads_seal_immutability_trg` freezes `wads.evidence_bundle` post-seal (revocation allowlist does not include the bundle).
- **Storage layer:** no existing policy calls `is_match_document_sealed(...)` or any equivalent. The J2/C10 immutability freezes the *pointer* (metadata row and bundle reference) but **not the pointed-to storage object**.

## 5. Direct-storage-delete exposure

**Confirmed exposed.** With a session for any user whose `profiles.org_id` matches the first folder segment (or any `platform_admin`), a plain `supabase.storage.from('match-documents').remove([path])` will succeed and silently delete the byte content of a sealed-WaD-referenced file. Signed URLs, hashes, and audit trails would then point at nothing.

## 6. Service-role cleanup exposure

**Marginally exposed (defence-in-depth).** The only service-role delete path that could touch a sealed file is `storage-retention-cleanup`, which trusts the enqueuer. It does not itself verify:
1. that `bucket_id = 'match-documents'` and last-segment doc id is not sealed; or
2. that no `match_documents` row currently references `file_path`.

`storage-orphan-cleanup` and `finalise-match-document-upload` cleanup are structurally safe as documented above.

## 7. Classification

**D — Needs both** a storage-policy seal guard AND a service-role cleanup guard.

## 8. Recommended smallest safe fix (NOT applied)

Two narrow changes, no file movement, no historical deletion, no WaD mutation, legal-hold behaviour untouched:

**(a) DB — new helper + tightened storage DELETE policy for `match-documents`**

```sql
-- Helper: resolve (bucket, object name) → sealed status.
-- Uses the confirmed path shape `{org}/{match}/{kind}/{doc_id}`.
CREATE OR REPLACE FUNCTION public.is_storage_object_sealed_match_document(
  _bucket_id text,
  _object_name text
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN _bucket_id <> 'match-documents' THEN false
    ELSE public.is_match_document_sealed(
      NULLIF(split_part(_object_name, '/', 4), '')::uuid
    )
  END;
$$;

DROP POLICY "Org members can delete own match documents" ON storage.objects;
CREATE POLICY "Org members can delete own match documents"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'match-documents'
  AND NOT public.is_storage_object_sealed_match_document(bucket_id, name)
  AND (
    (storage.foldername(name))[1] IN (
      SELECT p.org_id::text FROM public.profiles p WHERE p.id = auth.uid()
    )
    OR public.has_role(auth.uid(), 'platform_admin'::public.app_role)
  )
);
```

Optional mirror on the UPDATE policy for the same bucket (J2 already blocks the metadata side, but symmetry is cheap).

**(b) Code — service-role cleanup guard in `storage-retention-cleanup`**

Before `supabase.storage.from(item.bucket_id).remove([item.file_path])`:

```ts
if (item.bucket_id === "match-documents") {
  const docId = item.file_path.split("/")[3];
  if (docId) {
    const { data: sealed } = await supabase.rpc("is_match_document_sealed", { _doc_id: docId });
    if (sealed === true) {
      await supabase.from("storage_deletion_queue")
        .update({ status: "skipped_sealed", error_message: "sealed_storage_delete_blocked" })
        .eq("id", item.id);
      continue;
    }
  }
}
```

Emit an `audit_logs` row with `action = 'sealed_storage_delete_blocked'` for observability. Legal-hold checks remain unchanged and run first.

## 9. Confirmation — no changes applied

No files edited. No migrations authored. No edge functions deployed. No RLS/grants/policies/schema/storage-policies/buckets/triggers/cron/payments/refunds/token ledger/email/legal-hold changes. No data mutated, no files removed, no providers called, no notifications sent. Only `rg` and `code--view` reads under `supabase/`, `src/`, and this evidence directory.

## Final status

`BATCH_M_SEALED_STORAGE_DELETE_AWARENESS_READY_TO_APPLY_BOTH`
