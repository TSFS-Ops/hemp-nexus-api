# VerifyNow ZA za_said_basic — next diagnostic access plan (Batch V-Hardening, step 3)

Status marker: VERIFYNOW_ZA_BASIC_BACKEND_PATH_PASSED_PROVIDER_ERROR_REMAINS_NEXT_DIAGNOSTIC_ACCESS_PLAN_REQUIRED

Date: 2026-07-11

## 1. What this retry confirmed

One supervised sandbox retry was run against the approved fixture (South Africa, `za_said_basic`, ID `8001015009087`) via `/desk/idv/start`, request body `{ document_country: "ZA", document_type: "za_said_basic", payload: { said_number: "8001015009087" }, subject_id: "c343f468-3e94-4e08-903c-8d15e37e7a59" }`.

- `idv-subject-provision`: HTTP 200.
- `idv-person-verify`: HTTP 200.
- `idv-open-manual-review`: not triggered.
- `idv-person-verify` response: `{ ok: true, subject_id, internal_status: "provider_error", unlocks_controlled_actions: false }`.

This confirms the backend routing, auth, ownership check, and DB-write path are healthy end-to-end for this route. The only remaining unknown is why the VerifyNow response is still classified as `provider_error`.

## 2. Why no further classifier change was made this session

Per explicit instruction, guessing blindly was ruled out. Section 12 of `PROVIDER_CLASSIFIER_HARDENING.md` already anticipated exactly this retry and stated that the values-free admin-only diagnostic (`raw_http_status`, `response_body_shape`) recorded by the already-deployed instrumentation step must be inspected before deciding anything further. That diagnostic has now been populated by this very retry (one new row on `p5scr_idv_records` for this subject, decided around the retry time), but it has not been read in this session — this session has GitHub web access only, no Supabase dashboard, SQL editor, or log access.

## 3. The diagnostic is already retrievable without any new code

Direct inspection of the schema migration and the current `idv-person-verify/index.ts` source confirms this is already possible today, with no repo change:

- `p5scr_idv_records` already has `GRANT SELECT ... TO authenticated` plus RLS policy `p5scr_idv_records_admin_read` (`USING has_role(auth.uid(),'platform_admin')`).
- The column `raw_provider_payload_admin_only.diagnostic` (`raw_http_status`, values-free `response_body_shape`) is already populated by `idv-person-verify` on every invocation, added in the prior instrumentation step and untouched by the classifier hardening step.
- The same values-free fields, plus `error_code` and `raw_outcome`, are also emitted as a single `[idv-person-verify] provider_response` log line on every invocation.

Because of this, options 1–3 from today's decision list are already substantially implemented by prior work. Adding a new temporary internal-only endpoint (option 2) now would only duplicate this existing, already role-gated read path and would add unneeded attack surface for no new capability.

Two existing ways to retrieve the diagnostic for this retry, neither requiring a repo change:

(a) As `platform_admin`, read the most recent `p5scr_idv_records` row for `subject_id = "c343f468-3e94-4e08-903c-8d15e37e7a59"` and inspect `raw_provider_payload_admin_only -> 'diagnostic'`.
(b) In the Supabase Edge Function logs for `idv-person-verify`, find the `[idv-person-verify] provider_response` log line with a timestamp matching this retry.

## 4. Decision on the five options under consideration

1/2/3 (richer diagnostics / new internal endpoint / admin-only response fields) — not pursued: already satisfied by the existing instrumentation plus the existing `platform_admin` RLS read policy described above.
4 (further classifier hardening) — not pursued yet: doing so now would be guessing, since it is not yet known whether `raw_http_status` was 200 with an unrecognised body shape (a real classifier gap), or 401/403/4xx (an auth or request-contract issue unrelated to the classifier), or 5xx (sandbox temporarily unavailable). Deferred until the diagnostic is actually read.
5 (ask VerifyNow/Daniel) — held in reserve. To be scoped precisely, quoting the exact observed `response_body_shape` or status code, once the diagnostic is read, rather than sent as a generic question now.

## 5. Recommended next step

Retrieve the two diagnostic fields for this retry via (a) or (b) above — this requires Supabase project access this session does not have — and share them back. That single read will make the actual cause (auth/key rejection, request/body rejection, or classifier/schema mismatch) unambiguous, which is exactly the purpose the instrumentation in `PROVIDER_DIAGNOSTIC_INSTRUMENTATION.md` was built for.

## 6. Guardrails observed

No code changed. No migration created. No RLS policy or grant changed. No secret read or changed. No frontend file changed or published. No real identity data used (only the previously-approved sandbox fixture `8001015009087`). No production VerifyNow used. Client testing was not resumed — this analysis is source/schema inspection only. Unknown/ambiguous provider responses remain fail-closed (`provider_error` / manual-review path), unchanged.

Final verdict: VERIFYNOW_ZA_BASIC_BACKEND_PATH_PASSED_PROVIDER_ERROR_REMAINS_NEXT_DIAGNOSTIC_ACCESS_PLAN_REQUIRED
