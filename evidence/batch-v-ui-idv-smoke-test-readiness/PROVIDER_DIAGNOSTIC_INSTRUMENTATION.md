# VerifyNow provider diagnostic instrumentation (step 1)

Status marker: VERIFYNOW_PROVIDER_DIAGNOSTIC_INSTRUMENTATION_READY_FOR_ONE_SANDBOX_RETRY

## Purpose

Distinguish, on the next single supervised sandbox retry, whether the current
`internal_status: "provider_error"` on the SA `za_said_basic` fixture is caused
by (a) VerifyNow auth/key rejection, (b) VerifyNow request/body rejection, or
(c) our classifier not recognising the real sandbox response schema. Achieved
without changing behaviour, without persisting any provider values, and without
exposing any raw provider response in the UI or in ordinary logs.

## Files changed

- `supabase/functions/_shared/verifynow/response-shape.ts` (new) — values-free
  structural summariser (`summariseResponseShape`). Retains only key names,
  primitive TYPES (`string` / `number` / `boolean` / `null`), and
  array/object indicators (array length + element-type set). Bounded to
  `MAX_DEPTH=4`, `MAX_KEYS_PER_OBJECT=50`, `MAX_ARRAY_SAMPLE=10`. Never emits
  primitive VALUES.
- `supabase/functions/_shared/verifynow/response-shape_test.ts` (new) —
  8 Deno tests. Explicitly asserts none of a list of sensitive markers
  (SA ID numbers, NIN, names, DoB, phone, email, `Bearer `, `sk_live_`)
  survives the summariser; asserts primitive types are recorded but values
  are not; asserts recursion depth is bounded; asserts truncation of very
  wide objects / long arrays; asserts non-JSON exotic values are handled
  safely.
- `supabase/functions/_shared/verifynow/adapter.ts` — added two optional
  diagnostic fields on `VerifyNowAdapterOutcome`:
  `raw_http_status: number | null` and `response_body_shape: ShapeSummary | null`.
  Populated on the fetch-success path (with the shape summary),
  set to `raw_http_status: 0` / `response_body_shape: null` on the fetch-throw
  (`source_unavailable`) path. All pre-fetch fail-closed paths
  (unsupported route / missing key / misconfigured contract / idempotency
  contract) intentionally leave both fields undefined — no HTTP call was made.
  Classification (`classifyProviderResponse`) is unchanged.
- `supabase/functions/idv-person-verify/index.ts` — persists the two
  diagnostic fields under `raw_provider_payload_admin_only.diagnostic`
  (admin-only column, never returned to the UI) and emits one values-free
  admin diagnostic log line: `[idv-person-verify] provider_response` with
  `document_country`, `document_type`, `raw_http_status`,
  `response_body_shape`, `error_code`, `raw_outcome`. No secrets, no ID
  numbers, no provider response values. UI response contract unchanged.

## Tests run

- `deno test response-shape_test.ts --allow-read` → 8 passed / 0 failed.
- `deno test adapter_smoke_test.ts --allow-read --allow-env --no-check`
  → 18 passed / 0 failed (all pre-existing adapter contracts and
  fail-closed behaviours still hold).

## Redeploy / sync status

- Only `idv-person-verify` was redeployed via the Lovable Cloud edge-function
  deploy tool. `idv-verify` (legacy entity/KYB) was NOT touched.

## Exact diagnostic fields added

Persisted admin-only under
`p5scr_idv_records.raw_provider_payload_admin_only.diagnostic`:

- `raw_http_status`: number (0 when the fetch itself threw) | null
- `response_body_shape`: values-free `ShapeSummary`
  - `{ kind: "null" }`
  - `{ kind: "primitive", type: "string" | "number" | "boolean" }`
  - `{ kind: "array", length, element_types[], truncated? }`
  - `{ kind: "object", keys: { [name]: ShapeSummary }, truncated? }`
  - `{ kind: "non_json", note }`

Logged (once per invocation) under
`[idv-person-verify] provider_response`:
`document_country`, `document_type`, `raw_http_status`,
`response_body_shape`, `error_code`, `raw_outcome`.

## Confirmation no behaviour changed

- `classifyProviderResponse` unchanged.
- `provider-contract-map.ts` unchanged (no field mapping, endpoint, or
  reportType changes).
- Request body shape and headers unchanged.
- `p_provider_live_now: false` and `p_state` mapping via
  `mapInternalStatusToRecordState` unchanged.
- No migration, no RLS change, no grant change, no secret change, no
  frontend change, no publish.
- UI response contract of `idv-person-verify` (`ok`, `subject_id`,
  `internal_status`, `unlocks_controlled_actions`) unchanged.

## Ready for one supervised sandbox retry

Yes — one supervised retry of the approved SA `za_said_basic` fixture is
sufficient to populate the diagnostic column and log line and identify which
of (a) / (b) / (c) is the actual cause.

Final verdict: VERIFYNOW_PROVIDER_DIAGNOSTIC_INSTRUMENTATION_READY_FOR_ONE_SANDBOX_RETRY
