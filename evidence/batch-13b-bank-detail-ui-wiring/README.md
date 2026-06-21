# Batch 13B — Bank-Detail Submission & Review UI Wiring (thin slice)

Final status: **BATCH_13B_BANK_DETAIL_UI_THIN_SLICE_COMPLETE**

This batch wires the user-facing and admin-facing UI on top of the accepted Batch 13 backend (`registry-bank-detail-start`, `-submit`, `-review`, `-unmask-access`, `registry_bank_detail_submissions`, `_evidence`, `_risk_flags`, `_unmask_access_logs`). Batch 4 pages, wording and guards are left untouched.

## 1. User bank-detail journey

* `/registry/bank-details` — entry list / authority picker.
* `/registry/company/:id/bank-details/submit` — start from a company context.
* `/registry/bank-details/:bankDetailSubmissionId` — masked status page.

Flow: pick active authority → confirm company + country → fill country-aware form → accept consent → accept declaration → submit → masked status view.

## 2. Authority-gated entry proof

* UI loads only `registry_active_authorities` rows scoped to `bank_detail_submission` or `bank_detail_update` and `status='active'`.
* If none, page renders the canonical blocker text from
  `REGISTRY_BANK_DETAIL_B13_UI_AUTHORITY_BLOCKER`:
  > “You need approved authority for this action before bank details can be submitted.”
* Claim approval alone never exposes the submit action — the page does **not** query `registry_company_claims`.
* `registry-bank-detail-submit` re-validates the authority server-side as well (defence in depth).

## 3. Country form proof

* Country-aware fields are driven by `getBankDetailCountryRequirements(country)` from the accepted Batch 13 SSOT.
* ZA requires `branch_code` and `account_type`; NG requires `bank_name` + `account_number` without branch code; default supports `iban` / `swift_bic` / `routing_number` / `sort_code`.
* Verified by `src/tests/batch-13b-bank-detail-ui.test.ts` (ZA / NG / default tests).

## 4. Consent and declaration proof

* Submit button is disabled unless **both** the consent checkbox (using `REGISTRY_BANK_DETAIL_B13_CONSENT_WORDING`) and the declaration checkbox (using `REGISTRY_BANK_DETAIL_B13_UI_DECLARATION`) are checked.
* The `registry-bank-detail-submit` edge function also requires `acknowledged_captured_not_verified: true` and `declaration_acknowledged: true` server-side.

## 5. Masking proof

* `BankDetailSubmit` never persists raw fields in component state after submit — it navigates straight to the status page.
* `BankDetailStatus` and `AdminBankDetailReview` only `select(...)` masked / status / risk / rejection columns. No `enc_*` column is read from the UI.
* Guard `scripts/check-batch-13b-ui-no-raw-leak.mjs` fails the build if any UI surface selects an `enc_*` column.

## 6. User status proof

* Status page renders the canonical labels from `REGISTRY_BANK_DETAIL_B13_UI_STATUS_LABEL` for every B13 status.
* `captured_unverified` renders as “Captured but not verified” and always shows the `Not verified` badge plus the public acceptance notice `REGISTRY_BANK_DETAIL_B13_ACCEPT_PUBLIC_NOTICE`.

## 7. Admin review proof

* `/admin/registry/bank-details/queue` lists submissions with status, country, risk level, third-party flag.
* `/admin/registry/bank-details/submissions/:bankDetailSubmissionId` provides masked summary, risk flags, review actions, unmask request.
* Both routes are wrapped in `<RequireAuth role="platform_admin" fallbackRoute="/desk">`.

## 8. captured_unverified acknowledgement proof

* The “Accept as captured/unverified” button is disabled until the acknowledgement checkbox is checked AND a reason of ≥5 chars is provided.
* Click sends `acknowledged: true` to `registry-bank-detail-review`, which enforces both the acknowledgement and the reason server-side and refuses when `risk_level='blocked'`.

## 9. Risk display proof

* Risk flags are rendered with `REGISTRY_BANK_DETAIL_B13_UI_RISK_LABEL`.
* `blocked` risk surfaces a destructive alert and disables the acceptance button.
* `high` risk surfaces a “compliance review required” banner.

## 10. Unmask access proof

* Unmask request requires a reason ≥20 chars; button stays disabled otherwise.
* Calls `registry-bank-detail-unmask-access`, which gates on `platform_admin` / `compliance_owner` roles, audits via `registry_bank_detail_unmask_access_logs`, `registry_bank_detail_access_log`, `registry_bank_detail_events` and `event_store`.
* Returned raw values are shown temporarily inside an amber-tinted box marked “Unmasked (temporary view, audited)”; the values are not persisted to component state outside that view and never serialised to other surfaces.

## 11. No verified wording proof

* Guard `scripts/check-batch-13b-ui-no-verified.mjs` (added to `prebuild`) fails the build on `bank details verified`, `verified bank account|details`, `institutionally usable`, and `production-ready` anywhere in the B13 UI files or the UI copy SSOT.
* Existing Batch 4 (`check-registry-batch4-wording.mjs`) and Batch 13 backend (`check-registry-bank-detail-b13-no-verified.mjs`) wording guards continue to pass.

## 12. No external notification proof

* No B13 UI surface invokes any email / SMS / WhatsApp send function. The user status page reads from the database only; the admin review page invokes only `registry-bank-detail-review` and `registry-bank-detail-unmask-access`.

## 13. Guard list

* `scripts/check-batch-13b-ui-no-verified.mjs`
* `scripts/check-batch-13b-ui-no-raw-leak.mjs`
* (existing) `scripts/check-registry-bank-detail-b13-parity.mjs`
* (existing) `scripts/check-registry-bank-detail-b13-no-verified.mjs`
* (existing) `scripts/check-registry-batch4-wording.mjs`
* (existing) `scripts/check-registry-readiness-forbidden-words.mjs`

## 14. Test summary

* `src/tests/batch-13b-bank-detail-ui.test.ts` — 12 cases covering: every status has a label; captured_unverified never labelled “verified”; isBankDetailB13Verified always false; not-verified badge stable; authority blocker copy stable; declaration copy stable; consent wording stable; admin acknowledgement stable; unmask UI notice gates role + reason + audit; ZA requires branch code; NG does not; default supports IBAN-style submission.

## 15. Out of scope (deferred to follow-up pass)

* Evidence upload UI (capture lives server-side via `registry-bank-detail-evidence-upload`; the status page lists evidence read-only).
* Revocation / dispute / supersede admin UI buttons (server endpoints exist and remain callable via the generic review action with reason).
* Advanced queue filters (status / country / reviewer / overdue).
* Reviewer assignment UI.
* Notification centre UI (in-app log-only).
* Visual / branding polish.

Backend contracts remain untouched. No verified state was ever granted. No raw bank-detail API or public surface was added. Batch 4 pages, wording and guards remain intact.
