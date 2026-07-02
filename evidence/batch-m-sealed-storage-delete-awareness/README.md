# Batch M — Sealed storage file delete awareness (tracker #11, #70)

**Status:** `BATCH_M_SEALED_STORAGE_DELETE_AWARENESS_DEPLOYED_PENDING_VERIFICATION`

## Scope
Prevent physical `storage.objects` deletion for files whose `match_documents`
row is referenced by a sealed, non-revoked WaD evidence bundle (Batch J2
protects the metadata row; C10 protects the WaD; neither previously
protected the storage object).

## In scope
- Bucket: `match-documents` (private).
- Path shape: `{org}/{match}/{kind}/{doc_id}` — final segment = `match_documents.id`.

## Migration
`supabase/migrations/20260702105905_a0f3362e-94bc-40bd-96d4-821f9096b021.sql`

### Helper
`public.is_storage_object_sealed_match_document(_bucket_id text, _object_name text) RETURNS boolean`
- `LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, storage`
- Returns `false` unless `_bucket_id = 'match-documents'`.
- Parses final `/`-segment of `_object_name`, strips optional extension,
  casts to `uuid`. Non-UUID / malformed / empty → returns `false`
  (never raises).
- Delegates to `public.is_match_document_sealed(_doc_id)` (Batch J2 helper).
- Never uses filename, hash, match-level, or org-folder inference.

### Storage DELETE policy rewrite
Policy: `"Org members can delete own match documents"` on `storage.objects`.

Existing allowed deleters preserved verbatim:
- Org member whose profile `org_id` matches the first path segment.
- `platform_admin`.

Added seal guard:
```
AND NOT public.is_storage_object_sealed_match_document(bucket_id, name)
```

No other bucket policies (`kyc-documents`, others) touched. No `SELECT` /
`INSERT` / `UPDATE` policies touched. No grants changed.

## Service-role cleanup guard
`supabase/functions/storage-retention-cleanup/index.ts`

Before removing a queued file, when `item.bucket_id === "match-documents"`:
1. Split `file_path` on `/`, take last segment, strip extension.
2. UUID-validate; if not a UUID → fall through (non-canonical path).
3. Call `supabase.rpc("is_match_document_sealed", { _doc_id })`.
4. If `sealed === true`: **do not delete**; mark queue row `failed` with
   `error_message = 'sealed_storage_delete_blocked'`, log
   `sealed_storage_delete_blocked` marker, increment `failed`, `continue`.
5. If seal RPC errors: **do not delete** (defensive); mark row `failed` with
   `sealed_storage_delete_blocked:seal_check_failed:...`, log, `continue`.
6. Any exception around the guard: **do not delete**; mark row `failed`
   with `sealed_storage_delete_blocked:guard_error:...`, log, `continue`.

Existing legal-hold batch + per-file assertions retained. Non-`match-documents`
paths unchanged.

## Tests / guards run
- `scripts/check-batch-m-sealed-storage-delete-awareness.mjs` — **PASS**
  - helper signature, SECURITY DEFINER, `search_path = public, storage`
  - bucket-gated on `'match-documents'`
  - final segment cast `::uuid`
  - delegates to `is_match_document_sealed`
  - helper block does not use sha256 or match_id shortcuts
  - old DELETE policy dropped and recreated with seal guard
  - seal guard clause present: `AND NOT public.is_storage_object_sealed_match_document(bucket_id, name)`
  - org-folder + platform_admin allow-list preserved
  - migration does not touch other buckets or non-DELETE ops
  - cleanup calls `is_match_document_sealed`, emits `sealed_storage_delete_blocked`
  - cleanup retains legal-hold logic
  - cleanup guard region does not reference providers/email/payments/tokens/poi/wad
- `scripts/check-batch-j2-sealed-match-document-freeze.mjs` — **PASS** (J2 regression)

## Live proof status
- Static guard: PASS.
- Live storage DELETE proof against the seal-guarded policy requires an
  authenticated role and privileges to insert/seal a WaD referencing a
  storage object, which the sandbox roles do not have. Marked
  **pending privileged verification**, consistent with J2's proof posture.
- Migration `linter` completed without introducing new WARN/ERROR entries
  tied to the new helper (SECURITY DEFINER + explicit `search_path` set).

## Data mutation confirmation
- **Zero storage objects deleted.**
- **Zero rows** mutated in `match_documents`, `wads`, `storage.objects`,
  `storage_deletion_queue`, or any other table by this batch.
- No files moved. No historical data purged.

## Out-of-scope untouched
- WaD sealing (C10 trigger).
- `match_documents` immutability (J2 trigger).
- Legal-hold behaviour (batch + per-file assertions retained).
- Upload path shape.
- Document share / review / download semantics.
- Payments, refunds, token ledger, email, POI, lifecycle, reconciliation.
- Other buckets and other storage operations.
- No provider called, no email/notification sent.

## Deployment
- Migration applied via Supabase migration tool.
- Edge function `storage-retention-cleanup` deployed.

## Final status
`BATCH_M_SEALED_STORAGE_DELETE_AWARENESS_DEPLOYED_PENDING_VERIFICATION`
