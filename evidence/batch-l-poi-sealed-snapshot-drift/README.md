# Batch L — Live POI drift from sealed snapshot (tracker #26)

**Status:** `BATCH_L_POI_SEALED_SNAPSHOT_DRIFT_READY_TO_APPLY`
**Mode:** Inspection only. No code, migrations, functions, RLS, grants, policies, schema, storage, cron, triggers, payments, refunds, ledger, email, legal holds, or data were changed.

Note on terminology: in this codebase the "POI" (proof of intent) is the `public.matches` row (see `wads.poi_id = matches.id`). "Live POI drift" therefore means "the `matches` row can change after the WaD is sealed, and some surfaces re-read the live `matches` row instead of the sealed snapshot".

## 1. Sealed POI snapshot — does it exist?

Yes. `supabase/functions/wad/index.ts` builds `evidence_bundle` at WaD creation and stores it on `wads.evidence_bundle` (jsonb).

Shape (from `supabase/functions/wad/index.ts` lines 552–585):

```jsonc
{
  "poi_snapshot": {
    "id":         "<match id>",
    "hash":       "<match hash>",
    "commodity":  "...",
    "quantity":   { "amount": ..., "unit": "..." },
    "price":      { "amount": ..., "currency": "..." },
    "terms":      "...",
    "buyer":      { "id": "...", "name": "...", "org_id": "..." },
    "seller":     { "id": "...", "name": "...", "org_id": "..." },
    "created_at": "...",
    "settled_at": "..."
  },
  "documents":     [ { "id","sha256_hash","doc_type","title","status" } ],
  "event_count":   <n>,
  "event_hashes":  [ ... ],
  "test_mode":     { "issued_under_test_mode", "bypassed_gates", "bypassed_at" }
}
```

Immutability of the snapshot after sealing is already enforced:

- `public.assert_wad_seal_immutability` (C10 trigger `wads_seal_immutability_trg`) blocks any UPDATE/DELETE on `wads` after `sealed_at IS NOT NULL` for every column outside the narrow revocation/supersession allowlist. `evidence_bundle` is NOT in the allowlist, so `wads.evidence_bundle.poi_snapshot` is frozen at seal — confirmed via `src/tests/c10-wad-seal-immutability.test.ts` and `supabase/tests/c10_wad_seal_immutability_proof.sql`.
- `assert_match_document_sealed_immutability` (Batch J2) additionally freezes `match_documents` rows referenced by a sealed, non-revoked WaD.

There is NO comparable freeze on the underlying `matches` (POI) row itself. That is expected — the POI can legitimately continue to move through downstream state (settled_at, poi_state, etc.) — but it means surfaces MUST read the sealed snapshot for sealed-WaD displays, not the live row.

## 2. Display / export / API paths reviewed

| Surface | File | Reads from | Result |
|---|---|---|---|
| WaD detail stepper (customer + admin) | `src/components/wad/WadStepper.tsx:369-375` | `wad.evidence_bundle.poi_snapshot` | ✅ Snapshot |
| WaD attestation flow | `supabase/functions/attestation/index.ts:67` | selects `wads.evidence_bundle` | ✅ Snapshot |
| Governance triage inbox | `src/components/governance/TriageInbox.tsx` | `wads.evidence_bundle` | ✅ Snapshot |
| Evidence pack viewer (admin/funder) | `src/pages/admin/p5-batch2/EvidencePackViewer.tsx`, `src/pages/funder/FunderEvidencePack.tsx` | separate `p5_batch2_*` evidence tables — do NOT re-render WaD POI fields | N/A (out of scope) |
| Storage cleanup | `supabase/functions/enqueue-storage-cleanup/index.ts` | `wads.evidence_bundle` (for referenced doc ids) | ✅ Snapshot |
| **Deal certificate (HTML/PDF, customer- and API-facing)** | `supabase/functions/deal-certificate/index.ts:466-594` | selects `matches.*` (LIVE) and builds `sealPayload` + `sealHash` from **live** `match.commodity / quantity / price / terms / buyer_name / seller_name / settled_at` | ❌ **Live POI drift** |

The deal-certificate function is the one drift point. It authenticates, guards on `state='completed'` and on the test-mode WaD gate, then computes the certificate `sealPayload` and `sealHash` from the **current** `matches` row — not from `linkedWad.evidence_bundle.poi_snapshot`. If any of the snapshotted commercial fields on `matches` were mutated after WaD sealing (there is no DB freeze preventing that), a freshly downloaded certificate would present the drifted values as sealed truth and its `sealHash` would no longer match the WaD seal.

## 3. POI mutation paths

- No `assert_matches_*_immutable` trigger exists in `supabase/migrations/` that gates `matches` UPDATE on `wads.sealed_at IS NOT NULL`.
- `sync_and_seal_deal` / `atomic_deal_seal` RPCs (migrations 20260408, 20260414, 20260416) write `matches.event_chain_hash` and set `poi_state='COMPLETED'` — expected post-seal state motion, not commercial-field drift.
- Nothing in the reviewed code paths blocks an admin, RPC, or edge function from later `UPDATE public.matches SET commodity/quantity/price/terms/... = ...` while a sealed, non-revoked WaD references that row.

## 4. Risk classification

**B — Needs narrow frontend/API fix.**

The sealed snapshot already exists, is cryptographically frozen, and every UI surface except one already reads it. Only `supabase/functions/deal-certificate/index.ts` re-reads the live `matches` row for the sealed payload. This is a small, contained edge-function change; no snapshot repair, no schema/migration, no client decision.

## 5. Recommended smallest fix (NOT applied)

In `supabase/functions/deal-certificate/index.ts`:

1. When `linkedWad` is present and sealed (`linkedWad.status === 'sealed'` and not revoked/superseded), source `sealPayload` from `linkedWad.evidence_bundle.poi_snapshot` (mapped 1:1 onto the existing sealPayload keys) instead of the live `match` row.
2. Fall back to the live `match` row only when no sealed WaD exists (early lifecycle / legacy rows without a snapshot).
3. Continue to compute `sealHash` from the same canonicalStringify(sealPayload) — so a certificate regenerated years later reproduces the original hash byte-for-byte.
4. Label the certificate rendering as "snapshot at WaD sealing" for clarity.
5. Do NOT mutate any existing sealed `wads.evidence_bundle` rows. Do NOT add a matches-freeze trigger in this batch (that is a heavier, separately-scoped decision).

Static guard to accompany the fix (a follow-up test, not this batch):
- Assert `deal-certificate/index.ts` references `evidence_bundle.poi_snapshot` and does not read `match.commodity/quantity/price/terms` when a sealed WaD is linked.

## 6. Confirmation of no changes

- No files edited.
- No migrations created or run.
- No edge functions deployed.
- No RLS, grants, policies, schema, storage, cron, triggers, payments, refunds, ledger, emails, notifications, or legal-hold entries changed.
- No `matches`, `wads`, `match_documents`, or any other rows mutated.
- No provider calls issued.
- Only reads: `rg`/file views against the working tree.

## 7. Final status

`BATCH_L_POI_SEALED_SNAPSHOT_DRIFT_READY_TO_APPLY`
