# Batch L — Live POI drift from sealed snapshot (tracker #26)

**Final status:** `BATCH_L_POI_SEALED_SNAPSHOT_DRIFT_DEPLOYED_PENDING_VERIFICATION`
**Scope discipline:** only `supabase/functions/deal-certificate/index.ts` was edited; a companion static-guard test was added. No migrations, no RLS/grants/policies/schema/storage/cron/triggers/payments/refunds/token-ledger/email/legal-hold/reconciliation changes. No production data mutated. No providers called. No emails or notifications sent. No historical certificates regenerated.

## 1. Fix — exact code path

`supabase/functions/deal-certificate/index.ts`

- Added helper `pickCertifiedFields(match, linkedWad)` returning `{ source: "sealed_wad_poi_snapshot" | "live_match_fallback", fields }`. It reads `linkedWad.evidence_bundle.poi_snapshot` only when `linkedWad.status === "sealed"` and the snapshot is well-formed (object, non-empty `commodity`, at least one of quantity/price present). Otherwise it returns an empty fields overlay and the source label `live_match_fallback`.
- After the existing `assertWadIsSettleable` test-mode guard, the handler now computes:
  ```
  const poiSource     = pickCertifiedFields(match, linkedWad ?? null);
  const certifiedMatch = { ...match, ...poiSource.fields };
  ```
- The `sealPayload` object literal now sources every commercial/POI field from `certifiedMatch` — key names and canonical key ordering are UNCHANGED, so `sha256Hex(canonicalStringify(sealPayload))` continues to reproduce the original historical hashes byte-for-byte.
- `signingTimestamp` prefers `certifiedMatch.settled_at` over `match.settled_at` (falls back to live `match.updated_at` when neither is present, matching prior behaviour).
- `generateCertificateHtml(certifiedMatch, ...)` renders from the same overlaid values.
- `audit_logs` insert now includes `poi_source` and `wad_id` so every certificate generation records which source path was taken.

## 2. Snapshot-to-certificate mapping

| Certificate field | Sealed-WaD source (`poi_snapshot.*`) | Live-match fallback (`matches.*`) |
|---|---|---|
| `commodity` | `commodity` | `commodity` |
| `quantity_amount` | `quantity.amount` | `quantity_amount` |
| `quantity_unit` | `quantity.unit` | `quantity_unit` |
| `price_amount` | `price.amount` | `price_amount` |
| `price_currency` | `price.currency` | `price_currency` |
| `terms` | `terms` | `terms` |
| `buyer_name` | `buyer.name` | `buyer_name` |
| `seller_name` | `seller.name` | `seller_name` |
| `settled_at` | `settled_at` | `settled_at` |
| `hash` (HTML render only) | `hash` | `hash` |
| `match_id`, `buyer_org_id`, `seller_org_id` | (live match — identity fields, not commercial POI) | — |

## 3. Fallback behaviour

The helper returns `live_match_fallback` and no overlay is applied when any of the following are true — matching the scope requirements:

- no linked WaD (`linkedWad` is null);
- WaD is present but `status !== "sealed"` (already excludes `revoked` and `superseded` from the existing query filter, and additionally excludes any non-sealed status);
- `evidence_bundle` is missing / not an object;
- `poi_snapshot` is missing / not an object;
- `poi_snapshot.commodity` is not a string, or both `quantity` and `price` are absent (malformed snapshot).

In every fallback case, the certificate renders from the live `matches` row exactly as before this fix, so legacy rows without a snapshot continue to work.

## 4. Tests / guards

`src/tests/batch-l-poi-sealed-snapshot-drift.test.ts` — 11 static-source guards, all passing:

```
✓ src/tests/batch-l-poi-sealed-snapshot-drift.test.ts (11 tests) 41ms
Test Files  1 passed (1)
     Tests  11 passed (11)
```

Guards cover:
1. Helper `pickCertifiedFields` exists with the two source labels.
2. Helper reads `evidence_bundle.poi_snapshot`.
3. Helper requires `linkedWad.status === "sealed"`.
4. Field mapping (commodity/quantity/price/terms/buyer/seller/settled_at/hash) is present.
5. `certifiedMatch` overlays snapshot onto match and is passed into `sealPayload` and `generateCertificateHtml`.
6. Seal-hash payload key names and canonical ordering unchanged; still hashed via `sha256Hex(canonicalStringify(sealPayload))`.
7. Audit log records `poi_source` and `wad_id`.
8. Fallback early-returns for null/non-sealed/missing/malformed snapshot are present.
9. No new hashing library / `sha256Hex` and `canonicalStringify` untouched.
10. No migration file references the helper.
11. `supabase/functions/wad/index.ts` still writes `poi_snapshot` at seal and is not modified.

## 5. Confirmation — no out-of-scope changes

- No migrations created or run.
- No DB triggers, functions, RLS, grants, policies, or schema changes.
- The C10 `assert_wad_seal_immutability` trigger and the Batch J2 `assert_match_document_sealed_immutability` trigger are unchanged.
- WaD sealing path (`supabase/functions/wad/index.ts`) unchanged — snapshot writer contract intact.
- No storage, cron, payments, refunds, token ledger, email, notifications, legal-hold, or reconciliation code touched.
- No production data mutated.
- No provider calls.
- No historical certificates regenerated — this fix only affects freshly generated certificates on `deal-certificate` invocations.

## 6. Deployment

`deal-certificate` edge function deployed (see conversation report for deploy result).

## 7. Files changed

- `supabase/functions/deal-certificate/index.ts` — added `pickCertifiedFields`, overlaid `certifiedMatch` into `sealPayload` / HTML / audit / signingTimestamp.
- `src/tests/batch-l-poi-sealed-snapshot-drift.test.ts` — new static-guard test file.
- `evidence/batch-l-poi-sealed-snapshot-drift/README.md` — this file.
