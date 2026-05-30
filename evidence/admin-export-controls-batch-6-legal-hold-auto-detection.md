# Admin Export Controls Batch 6 — Legal-Hold Context Auto-Detection

Status: complete. Detection-only batch. Still no prepare / generate / download / signed URL / destroy. DATA-004 not touched.

## Files changed

- created `supabase/functions/_shared/legal-hold-detection.ts`
- edited  `supabase/functions/admin-governance-export-request/index.ts`
- edited  `supabase/functions/admin-governance-export-approve/index.ts`
- edited  `supabase/functions/admin-governance-export-list/index.ts`
- edited  `src/components/admin/governance/AdminGovernanceExportRequestPanel.tsx`
- edited  `src/components/admin/governance/AdminGovernanceExportRequestsListPanel.tsx`
- created `scripts/check-admin-export-controls-batch-6.mjs`
- created `src/tests/admin-export-controls-batch-6.test.ts`
- edited  `package.json` (prebuild wires new guard)
- edited  `RELEASE_GATE.md` (Batch 6 entry; release-gate sync check satisfied)

## Legal-hold source of truth

`public.legal_holds` (status = 'active'). Selected columns are restricted to `id, scope_type, scope_id` — `reason`, `metadata`, `applied_by`, `released_by`, `released_reason` are never read.

## Confirmed detection paths (implemented)

Anchor: `governance_record_id == match_id`.

- `match`        → `legal_holds(scope_type='match',     scope_id=match_id)`
- `buyer_org`    → `legal_holds(scope_type='org',       scope_id=matches.buyer_org_id)`
- `seller_org`   → `legal_holds(scope_type='org',       scope_id=matches.seller_org_id)`
- `target_org`   → `legal_holds(scope_type='org',       scope_id=request.target_org_id)` (when supplied and distinct)
- `dispute`      → `legal_holds(scope_type='dispute',   scope_id IN disputes.id WHERE match_id=…)`
- `engagement`   → `legal_holds(scope_type='engagement',scope_id IN poi_engagements.id WHERE match_id=…)`

All confirmed paths are resolved in one bulk `IN (...)` query against `legal_holds` after resolving the per-anchor ids.

## Deliberately deferred paths

- per-document holds (`scope_type='evidence'` on `match_documents.id`)
- per-evidence-row holds (`scope_type='evidence'` on `match_evidence.id`)
- POI-record holds (`scope_type='poi'`) — current model surfaces POIs through `poi_engagements`, already covered by the `engagement` path
- user-scope holds — no stable user→governance-record path beyond the requester themselves

These will be revisited only with explicit relationship confirmation; the guard already bans inventing them without an accompanying source-of-truth update.

## Safe stored context schema

Stored on `export_requests.verification.legal_hold_context`:

```json
{
  "has_legal_hold": true,
  "scope": "seller_org",
  "detected": {
    "has_legal_hold": true,
    "hold_count": 2,
    "hold_sources": ["seller_org", "dispute"],
    "primary_scope": "dispute",
    "detected_at": "2026-05-30T…Z",
    "detection_source": "auto",
    "detection_version": "batch-6.v1",
    "confirmed_paths": ["match","buyer_org","seller_org","target_org","dispute","engagement"],
    "deferred_paths": ["match_document_evidence","match_evidence_row","poi_record","user_scope"],
    "hits": [
      {"source":"seller_org","scope_type":"org","legal_hold_id":"…"},
      {"source":"dispute","scope_type":"dispute","legal_hold_id":"…"}
    ],
    "detection_errors": []
  },
  "operator": { "hold_id": "…", "scope": "…" }
}
```

Excluded fields (never stored, never returned anywhere): `reason`, `metadata`, `notes`, `released_reason`, `released_by`, `applied_by`, document contents, evidence payloads, party PII.

## Request-time behaviour

- `admin-governance-export-request` runs `detectGovernanceRecordLegalHold` after auth/AAL2/Zod gates.
- Operator-supplied `legal_hold_context` is sanitised (`hold_id`, `scope` only) and stored under `verification.legal_hold_context.operator` — never overrides detected context.
- `data.admin_export_requested` audit now includes `legal_hold_context_detected` and `legal_hold_context_operator` (safe fields only).
- Response body adds `legal_hold_auto_detection` summary.

## Approval audit behaviour

- `admin-governance-export-approve` re-runs detection **read-only** post-approval and computes diff against request-time stored detection.
- `data.admin_export_approved` audit now carries `legal_hold_context_detected_at_request`, `legal_hold_context_detected_at_approval`, `legal_hold_context_operator`, `legal_hold_context_changed_since_request`, `legal_hold_context_diff`.
- Approval is not blocked by held material — semantics unchanged. No prepare / generate / download / destroy / signed URL added.

## List view behaviour

- `admin-governance-export-list` exposes new safe fields: `legal_hold_auto_detected`, `legal_hold_hold_count`, `legal_hold_hold_sources`, `legal_hold_primary_scope`, `legal_hold_detected_at`, `legal_hold_detection_source`.
- Back-compat: `legal_hold_context_present` and `legal_hold_context_scope` still emitted.
- Raw `reason` / `notes` / `metadata` are never selected from `legal_holds` and never returned.

## UI behaviour

- List panel: badge `auto-detected · <scope>` plus a small mono line with hold count and source list. No reason/notes/metadata. No prepare/download/destroy/signed-URL surfaces.
- Request panel: after a successful submit, a `Legal-hold auto-detection` block reports presence + count + primary scope, restates "does not mutate held data / No file has been generated / No download link will appear".

## Access matrix

| Surface                           | Role           | AAL  |
| --------------------------------- | -------------- | ---- |
| admin-governance-export-request   | platform_admin | AAL2 |
| admin-governance-export-approve   | platform_admin | AAL2 |
| admin-governance-export-list      | platform_admin | AAL2 |

AAL1 → `MFA_REQUIRED` (403) on all three. Non-platform-admin → `NOT_PLATFORM_ADMIN` (403). No change vs Batches 2/4/5.

## Sensitive fields excluded

`reason`, `metadata`, `notes`, `released_reason`, `released_by`, `applied_by`, document/evidence payloads, party PII. Verified by guard predicates against helper, request, approve, list edge functions and both UI panels.

## Tests

`src/tests/admin-export-controls-batch-6.test.ts` — static-contract pins covering:
- detection helper exports + safe-column SELECT + no mutation + no signed URL/blob
- request edge wires detection + audits safe context + still emits canonical DATA-010 audits
- approve edge re-detects + audits diff + does not introduce prepare/download/destroy
- list edge surfaces safe detected fields + never reads raw reason/metadata
- request/list panels render safe indicators only

Run: `bunx vitest run src/tests/admin-export-controls-batch-6.test.ts`.

## Guard / prebuild

`scripts/check-admin-export-controls-batch-6.mjs` wired into `prebuild`. Pins all of the above plus the standing bans on `prepare/download/destroy/signed_url/Blob/CSV` drift in the three edge functions and two panels. `check-release-gate-sync.mjs` satisfied via `RELEASE_GATE.md` entry.

## Explicit confirmations

- No file generation added (no `Blob`, no `createSignedUrl`, no `storage.upload`, no `text/csv`).
- No download link added (no `<a download>`, no `Download CSV/JSON/PDF` controls, no `ready_for_download` writes).
- No signed URL minted.
- No prepare/destroy verbs introduced.
- `legal_holds` is not mutated by any Batch 6 code path (no `insert/update/delete`).
- DATA-004 (cron, cold-storage, retention enforcement, archive logic) is untouched. No changes to `pg_cron`, no changes to `cold-storage-archive*`, no changes to `purge-email-send-log-daily`, no changes to `account-deletion-sweeper`.

## Corrections to prior batches

None. Batch 2/4/5 contracts (request shell, approval shell, list view) remain intact; Batch 6 layers detection on top via the existing `verification.legal_hold_context` slot and additive audit fields.

## Remaining risks

1. Detection is fail-OPEN by design (errors surface as `detection_errors[]`, not as a block). Acceptable for Batch 6 because detection is informational and approval semantics are unchanged, but enterprise-grade workflows may want a fail-CLOSED policy gate later.
2. Deferred paths (document-level / evidence-row-level / poi-direct / user-scope) mean a per-document hold against a document attached to an otherwise-unheld match would not surface here yet.
3. Re-detection on approval is best-effort and not transactional with the approve RPC — a hold applied in the gap between re-detect and audit write would still be captured in the next read of the list view.
4. `legal_hold_id`s are persisted in the safe summary; operators with platform_admin access can correlate them by querying `legal_holds` directly. This is intentional but is a deliberate reference-not-content choice.

## Recommended Batch 7

**Redaction Contract Implementation.**

Reasoning: request shell, approval shell, list view, and legal-hold auto-detection are all proven. The next safety boundary before any prepare/generate/download work is making `redaction_mode` enforceable rather than just declared. A Live E2E Smoke can follow Batch 7 once redaction is contractually pinned, so that the smoke exercises the full safe pipeline.

If you prefer to defer redaction, the next-safest option is **Legal-Hold Auto-Detection Live Smoke** to exercise the detection wiring against a seeded held match in the live env, still without any prepare/download.

