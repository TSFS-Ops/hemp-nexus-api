# Batch 13 — Consent-Based Bank-Detail Submission & Review

## Status

**BATCH_13_BANK_DETAIL_SUBMISSION_REVIEW_COMPLETE** (backend-only complete pass)

This batch extends Batches 4 and 12. No existing tables, columns or policies
were renamed. New surfaces are additive.

## What it builds

1. **Active-authority gated submission** — every submit/update/revoke path
   reads `registry_authority_requests`, requires an approved (or
   conditionally_approved) request held by the calling user, blocks
   revoked/disputed/expired authorities, and confirms the request carries
   the right authority scope (`bank_detail_submission`,
   `bank_detail_update`, `bank_detail_revocation_request`).

2. **Country-aware bank fields** — `findMissingBankFields()` enforces the
   per-country required-field matrix (ZA, NG, DEFAULT) on the server.

3. **Consent + declaration capture** — submit now requires
   `acknowledged_captured_not_verified` *and* `declaration_acknowledged`,
   accepts the legacy Batch 4 consent scopes *and* the seven new Batch 13
   consent scopes, and emits a `registry_bank_detail_consent_accepted`
   event per scope.

4. **Masking and fingerprinting** — raw bank fields are obfuscated at rest
   (Batch 4 shell-grade obfuscator preserved), masked variants populate
   `masked_*` columns, `account_number_last4` is stored, and
   `account_fingerprint` (SHA-256 over normalised country+bank+branch+
   account+IBAN) is computed for duplicate detection.

5. **Risk flag engine** —
   `registry-bank-detail-risk-evaluate` raises rows in
   `registry_bank_detail_risk_flags` for: account-holder mismatch,
   individual-holder-for-company, third-party account, bank-country vs
   company mismatch, duplicate fingerprint on another company,
   missing/expired evidence. Highest level rolls up to
   `registry_bank_detail_submissions.risk_level`. `blocked` cannot move to
   captured_unverified.

6. **Admin review workflow** — `registry-bank-detail-review` accepts every
   action in `REGISTRY_BANK_DETAIL_B13_REVIEW_ACTIONS`. Every action except
   `assign_reviewer` requires a reason; `accept_captured_unverified`
   additionally requires the acknowledgement (`acknowledged: true`)
   matching `REGISTRY_BANK_DETAIL_B13_ACCEPT_ACKNOWLEDGEMENT`.

7. **Captured-not-verified outcome** — successful acceptance moves
   `b13_status` to `captured_unverified` and stamps
   `captured_unverified_at`. The function returns
   `verified: false` and the pinned public notice. `b13_status` is never
   set to `verified` in any code path (guarded by
   `check-registry-bank-detail-b13-no-verified.mjs`).

8. **Revocation request** — `registry-bank-detail-revocation-request`
   requires the `bank_detail_revocation_request` scope and moves the
   submission to `revocation_requested`. Admin `approve_revocation`
   finalises it to `revoked`.

9. **Unmask access** — `registry-bank-detail-unmask-access` is the
   elevated, reasoned, audit-only path. Requires platform_admin or
   compliance_owner, requires a >=20 char reason, returns only the fields
   requested, and writes to *both*
   `registry_bank_detail_unmask_access_logs` (new B13 ledger) and the
   existing `registry_bank_detail_access_log`, plus
   `registry_bank_detail_events` and `event_store`.

10. **Log-only notifications** — `registry-bank-detail-notification-log`
    writes to `registry_bank_detail_status_notifications` with
    `delivered_externally = false`. No external email/SMS is wired in.

## Database changes

- **Extended** `registry_bank_detail_submissions` with: bank_country_code,
  bank_code, routing_number, sort_code, branch_name,
  intermediary_admin_meta, account_number_last4, account_fingerprint,
  account_holder_kind, is_third_party, is_primary_account, bank_purpose,
  declaration_acknowledged, evidence_metadata_captured, risk_level,
  mismatch_flags, sla_due_at, assigned_reviewer_id, last_activity_at,
  captured_unverified_at, superseded_by, superseded_at, withdrawn_at,
  rejection_reason, more_evidence_due_at, revocation_requested_at,
  b13_status.
- **New tables** (all admin/compliance-only by default, with submitter
  read access where the row links to their own submission):
  - `registry_bank_detail_risk_flags`
  - `registry_bank_detail_review_events`
  - `registry_bank_detail_notes`
  - `registry_bank_detail_status_notifications`
  - `registry_bank_detail_unmask_access_logs`
- **Tightened** the submission UPDATE policy `WITH CHECK` to match its
  USING condition (no rewriting of submitter_user_id / claim_id /
  authority_request_id).

## Edge functions

| Function | Purpose | Auth |
| --- | --- | --- |
| `registry-bank-detail-start` *(new)* | Draft submission; gates on active scoped authority + verified email. | user JWT |
| `registry-bank-detail-submit` *(hardened)* | Final submit; country fields, declaration, fingerprint, dup-detect. | user JWT |
| `registry-bank-detail-evidence-upload` *(new)* | Evidence metadata capture. | user JWT or admin |
| `registry-bank-detail-review` *(new)* | All admin/compliance review actions, with acknowledgement on accept. | platform_admin / compliance_owner |
| `registry-bank-detail-risk-evaluate` *(new)* | Raises risk flags and rolls up `risk_level`. | platform_admin / compliance_owner |
| `registry-bank-detail-revocation-request` *(new)* | User-driven revocation; needs `bank_detail_revocation_request` scope. | user JWT |
| `registry-bank-detail-notification-log` *(new)* | Log-only in-app notification ledger; never sends externally. | platform_admin / compliance_owner |
| `registry-bank-detail-unmask-access` *(new)* | Elevated, reasoned unmask with audit. | platform_admin / compliance_owner |
| `registry-bank-detail-status-transition` *(unchanged)* | Legacy Batch 4 verifier — out of scope for Batch 13. | platform_admin / compliance_owner |
| `registry-bank-detail-access` *(unchanged)* | Batch 4 masked-view / request-unmasked / read-unmasked. | mixed |

## API safety

`registry-institutional-payment-status` reads `registry_bank_detail_submissions.status`
and maps it through `mapBankStateToApiFlag()`. Only the Batch 4
`verified` state returns the API `verified` flag — every Batch 13
submission status hits the function's default branch and degrades to
`not_verified`. The pinned guard
`scripts/check-registry-api-no-raw-bank.mjs` continues to block raw
field exposure on the institutional surface.

## Guards added

- `scripts/check-registry-bank-detail-b13-parity.mjs` — TS ↔ Deno parity
  for every Batch 13 array constant and the three mandatory wording
  strings.
- `scripts/check-registry-bank-detail-b13-no-verified.mjs` — scans all
  Batch 13 SSOTs and edge functions for any mapping of a B13 status to a
  verified flag.

Both are wired into `package.json` `prebuild`.

## Existing guards still enforced

- `check-registry-bank-detail-state-parity.mjs` (Batch 4 SSOT parity)
- `check-registry-batch4-audit-names.mjs`
- `check-registry-batch4-wording.mjs`
- `check-registry-batch4-no-provider-integration.mjs`
- `check-registry-public-bank-leakage.mjs`
- `check-registry-api-no-raw-bank.mjs`
- `check-registry-api-state-rules.mjs`
- `check-registry-batch5-no-provider.mjs`

## Tests

- `src/tests/batch-13-bank-detail-submission-review.test.ts` — vitest
  unit tests covering the SSOT invariants, country field matrix, holder
  mismatch heuristic, fingerprint determinism, mandatory wording strings
  and the action → authority-scope map.

## Manifest + config

- `scripts/edge-function-deploy-manifest.json` — adds the seven new
  Batch 13 functions to `required`.
- `supabase/config.toml` — adds `verify_jwt = false` blocks for the seven
  new functions (in-code JWT validation).
- `RELEASE_GATE.md` — adds the two new prebuild guards to the documented list.

## Out of scope (explicit)

- No verification of bank details.
- No bank verification provider integration.
- No bank-detail status ever moves to `verified` in this batch.
- No raw bank-detail API surface.
- No raw bank-detail public surface.
- No external notification send (email/SMS/webhook).
- No new outreach.
- No weakening of Batch 1–12 guardrails.
