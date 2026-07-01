# Batch J2 — Sealed match_document full-freeze (tracker item #9)

**Status:** `BATCH_J2_SEALED_MATCH_DOCUMENT_FULL_FREEZE_DEPLOYED_PENDING_VERIFICATION`

## Client / product decision
Once a `match_documents` row is referenced inside a **sealed, non-revoked** WaD
evidence bundle, the row is frozen:
- no post-seal metadata edits;
- no post-seal delete;
- new evidence requires a **new document version** and a **new / superseding
  WaD flow**;
- post-seal review / revoke / supersession must not mutate the original
  sealed row.

## Pre-apply verification
- `wads.evidence_bundle->'documents'` is a JSONB array of `{ id, sha256_hash,
  ... }`. Confirmed against live rows (2 distinct sealed doc refs, 0 dangling).
- Sealed WaDs identified by `sealed_at IS NOT NULL`; live rows revoked via
  `revoked_at IS NOT NULL`.
- Writer inventory scanned on `match_documents`:
  - `finalise-match-document-upload` — INSERT only (pre-seal), unaffected.
  - `document-share`, `document-revoke`, `document-review` — post-upload
    UPDATEs. Per the approved client decision, these must not mutate the
    original sealed row; the trigger enforces that. New versions still flow
    through fresh inserts.
  - `wad/index.ts` — SELECT only from `match_documents`.
  - Migrations `20260322115522`, `20260416172404`, `20260501094739`,
    `20260516160602` — historical/backfill UPDATEs, no future runtime.
- No new required post-seal update/delete path found.

## Predicate (exact)
```
EXISTS (
  SELECT 1 FROM public.wads w,
    LATERAL jsonb_array_elements(COALESCE(w.evidence_bundle->'documents', '[]'::jsonb)) doc
  WHERE w.sealed_at IS NOT NULL
    AND w.revoked_at IS NULL
    AND (doc->>'id')::uuid = _doc_id
)
```
Explicitly not hash-only, not match-level.

## Migration
- `supabase/migrations/20260701213053_99145d6b-5573-43ca-998c-6fc6722ffa41.sql`
- Helper: `public.is_match_document_sealed(_doc_id uuid) RETURNS boolean` — SQL,
  STABLE, SECURITY DEFINER, `search_path = public`.
- Trigger function:
  `public.assert_match_document_sealed_immutability()` — plpgsql, SECURITY
  DEFINER, `search_path = public`. Raises `check_violation` with marker
  `sealed_match_document_immutable`.
- Trigger: `match_documents_sealed_immutability_trg`
  `BEFORE UPDATE OR DELETE ON public.match_documents FOR EACH ROW`.
- No RLS, grant, policy, storage, WaD-sealing, legal-hold, or document
  upload/versioning changes.

## Live trigger inspection
`pg_trigger` confirms both `match_documents_sealed_immutability_trg` and the
pre-existing `trg_match_documents_cleanup` / `update_match_documents_updated_at`
remain in place. Rollback-only proof SQL is bundled at
`supabase/tests/batch_j2_sealed_match_document_full_freeze_proof.sql` for
privileged execution; sandbox roles cannot exercise it without INSERT rights
on `public.matches` / `public.wads`, so **live end-to-end proof is pending
privileged verification**. Static guard passes.

## Tests / guards run
- `scripts/check-batch-j2-sealed-match-document-freeze.mjs` — **PASS**
- `scripts/check-batch-j1-token-ledger-append-only.mjs` — **PASS** (regression
  check unchanged).

## Confirmation — out of scope untouched
No changes to: RLS, grants, policies, ownership, storage schema/policies,
legal-hold, WaD sealing, WaD triggers, document upload/versioning code,
payments, token ledger, refunds, reconciliation, cron.

## Final status
`BATCH_J2_SEALED_MATCH_DOCUMENT_FULL_FREEZE_DEPLOYED_PENDING_VERIFICATION`
