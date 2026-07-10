# VerifyNow IDV — record-state mapping fix

**Status:** VERIFYNOW_IDV_RECORD_STATE_MAPPING_FIX_IMPLEMENTED_PENDING_FIRST_SMOKE_RETRY

## Root cause

`idv-person-verify` was passing a VerifyNow **workflow** status (from the
closed `InternalIdvStatus` union in
`supabase/functions/_shared/verifynow/result-mapping.ts`) straight into the
`p_state` parameter of the `p5scr_record_idv` RPC, which inserts the value
verbatim into `p5scr_idv_records.state`.

That column is guarded by the check constraint
`p5scr_idv_records_state_check`, which allows only:

```
idv_pending, provider_pending, manual_review_required,
cleared, cleared_with_conditions, failed, rejected, screening_expired
```

Most `InternalIdvStatus` values (`idv_completed`, `retry_required`,
`alternative_document_required`, `provider_error`, `provider_not_available`,
`blocked_pending_admin_decision`, `pending`, `expired`, `unsupported`,
`error`) are **not** in that set, so the insert failed with:

```
new row for relation "p5scr_idv_records" violates check constraint
"p5scr_idv_records_state_check"
```

The two vocabularies (workflow vs. persistence) were never reconciled at the
edge-function boundary.

## Fix

Introduced a pure boundary mapper
`mapInternalStatusToRecordState(workflowStatus)` that converts an
`InternalIdvStatus` into a DB-allowed `p5scr_idv_records.state` value.
`idv-person-verify` now:

- keeps `workflowStatus` for the UI response and the admin-only raw payload;
- computes `recordState = mapInternalStatusToRecordState(workflowStatus)`;
- passes `p_state: recordState` to `p5scr_record_idv`;
- keeps `p_provider_live_now: false` (supporting-only preserved).

The DB check constraint, RLS, and grants are unchanged.

## Mapping table

| Workflow (`InternalIdvStatus`)      | DB `p5scr_idv_records.state` |
| ----------------------------------- | ---------------------------- |
| `idv_completed`                     | `cleared`                    |
| `manual_review_required`            | `manual_review_required`     |
| `provider_pending`                  | `provider_pending`           |
| `retry_required`                    | `manual_review_required`     |
| `alternative_document_required`     | `manual_review_required`     |
| `provider_error`                    | `manual_review_required`     |
| `provider_not_available`            | `manual_review_required`     |
| `blocked_pending_admin_decision`    | `rejected`                   |
| `pending`                           | `provider_pending`           |
| `failed`                            | `failed`                     |
| `expired`                           | `screening_expired`          |
| `unsupported`                       | `manual_review_required`     |
| `error`                             | `manual_review_required`     |
| unknown / null / undefined          | `manual_review_required`     |

Safety rule: unknown or ambiguous statuses **never** map to `cleared`.
`idv_completed` is only ever produced by `resolveVerifyNowOutcome` when the
route can unlock controlled actions, so supporting-only routes (e.g.
`za_said_basic`) with a `clear_match` still resolve to
`manual_review_required` and persist as `manual_review_required`.

## Files changed

- `supabase/functions/_shared/verifynow/record-state-mapping.ts` — new pure
  mapper + `ALLOWED_IDV_RECORD_STATES` constant + `isAllowedIdvRecordState`
  guard.
- `supabase/functions/_shared/verifynow/record-state-mapping_test.ts` — new
  Deno regression tests.
- `supabase/functions/idv-person-verify/index.ts` — imports the mapper,
  separates `workflowStatus` from `recordState`, passes `recordState` into
  `p_state`, preserves `workflowStatus` in the admin-only raw payload and
  audit metadata, UI response continues to return `internal_status:
  workflowStatus`.

## Tests added

Deno tests in `record-state-mapping_test.ts`:

- `ALLOWED_IDV_RECORD_STATES` matches the DB check-constraint list;
- every `InternalIdvStatus` maps to an allowed DB state;
- every raw VerifyNow outcome (both `route_can_unlock` values), after
  resolution, maps to an allowed DB state;
- workflow-only statuses are not accepted as record states directly;
- unknown / unsupported / error / null / undefined map to
  `manual_review_required`, never `cleared`;
- `idv_completed` maps to `cleared`;
- supporting-only `clear_match` (`route_can_unlock=false`) resolves to
  `manual_review_required` and persists as `manual_review_required` (never
  `cleared`);
- controlled-action `clear_match` (`route_can_unlock=true`) persists as
  `cleared`;
- `blocked_pending_admin_decision` maps to `rejected` (also verified via
  raw `blocked_id` / `deceased` / `suspected_fraud`);
- `failed` → `failed`, `expired` → `screening_expired`.

## Guarantees

- DB check constraint unchanged.
- Allowed DB states not broadened.
- RLS and grants unchanged.
- Manual-review fallback preserved (every unclear/error path routes to
  `manual_review_required`).
- Supporting-only routes stay supporting-only (`p_provider_live_now:false`
  and `unlocks_controlled_actions` still derived from `resolved`).
- No provider payload exposed to non-admins (unchanged).
- No migration created.
- No frontend change, no publish, no secrets change.

## Final status

`VERIFYNOW_IDV_RECORD_STATE_MAPPING_FIX_IMPLEMENTED_PENDING_FIRST_SMOKE_RETRY`

## Next smoke-test step

First smoke retry (sandbox only) via `/desk/idv/start`:

- Country: South Africa
- Document type: `za_said_basic`
- Fixture: `8001015009087`

Expected: `idv-person-verify` returns `200` with `internal_status:
"manual_review_required"` and `unlocks_controlled_actions: false`; the
`p5scr_idv_records` row persists with `state = 'manual_review_required'`
and `provider_live_now = false`.
