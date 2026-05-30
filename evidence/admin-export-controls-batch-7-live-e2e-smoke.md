# Admin Export Controls Batch 7 — Live E2E Smoke

**Scope.** Prove the non-generating Governance Record export chain works
end-to-end against a deployed Lovable Cloud environment:

```
request → legal-hold auto-detection → approval → list visibility
```

This batch is proof-only. It deliberately does not add any prepare,
generate, download, signed-URL, destroy, or storage behaviour.

## Harness

- Script: `scripts/admin-export-controls-batch-7-smoke.mjs`
- Output: `evidence/admin-export-controls-batch-7-live-e2e-smoke.json`
- Auth: Supabase Auth REST (`/auth/v1/token`, `/auth/v1/factors`)
  with an inline RFC 6238 TOTP implementation. No new dependencies.
- Transport: `fetch` against `/functions/v1/<name>` for the three
  Batch 2 / 4 / 5 edge functions only:
  - `admin-governance-export-request`
  - `admin-governance-export-approve`
  - `admin-governance-export-list`
- Failure mode: exits non-zero with a per-path failure list and a JSON
  evidence dump.

## Fixture roles

| Row | Purpose                                       | Required AAL |
| --- | --------------------------------------------- | ------------ |
| R   | platform_admin requester                      | AAL2 (TOTP)  |
| A   | second platform_admin approver                | AAL2 (TOTP)  |
| N   | platform_admin without enrolled AAL2          | AAL1         |
| X   | non-platform_admin user                       | AAL1         |

A pre-existing Governance Record / match anchor UUID is supplied via
`SMOKE_GOVERNANCE_RECORD_ID`. No new Governance Records are created. No
legal_holds rows are inserted, updated, or deleted by this harness.

## Smoke paths

### Path A — request success
As Row R (AAL2):
- POST `admin-governance-export-request` with
  `purpose='compliance_review'`, `requested_categories=['governance_record_index']`,
  `redaction_mode='redacted_client_safe'`.
- Assert `status=200`, `ok=true`, `request_id` returned,
  `status='awaiting_approval'`, `redaction_mode` preserved.
- Assert response body contains no signed URL, no download link, no
  prepare/destroy marker, no `Content-Disposition`, no generated file
  marker (`assertNoGenerationLeak`).

### Path B — request denials
- B1: Row N (AAL1) → expect `403 / MFA_REQUIRED`.
- B2: Row X (non-admin) → expect `403 / NOT_PLATFORM_ADMIN`.
- Both responses must carry no generation/download/signed-URL markers.

### Path C — approval success
As Row A (AAL2) — distinct from the requester:
- POST `admin-governance-export-approve` with the Path A `request_id`.
- Assert `status=200`, `new_status='approved'`, `previous_status`
  either absent or `'awaiting_approval'`.
- Assert no signed URL / download link / prepare / destroy.

### Path D — self-approval blocked
As Row R (AAL2):
- POST `admin-governance-export-approve` against the same `request_id`.
- Assert `409 / SELF_APPROVAL_BLOCKED`.

### Path E — list visibility
- E1: Row A (AAL2) → POST `admin-governance-export-list` filtered to
  the Governance Record. Assert the approved row is present with
  `governance_record_id`, `status`, `redaction_mode`. Assert no
  `notes` / `raw_reason` / `legal_hold_reason` fields. Assert no
  signed URL / download link / prepare / destroy.
- E2: Row N (AAL1) → expect `403`.
- E3: Row X (non-admin) → expect `403`.

## Audit proof

The three Batch 2 / 4 edge functions emit `writeLifecycleAudit(...)`
with the canonical `DATA_010_AUDIT_ACTIONS`:

- `data.admin_export_requested` (Path A)
- `data.admin_export_approved` (Path C)
- `data.admin_export_blocked_or_declined`
  (Paths B1, B2, D, and the list-view denials in E2 / E3 where the
  list function emits the same shape)

Payload fields pinned by Batches 2, 4, 5, 6:

- `actor_user_id`, `requested_by_admin_user_id` / approver
- `request_id`, `governance_record_id`, `target_org_id`
- `purpose`, `reason`, `requested_categories`, `redaction_mode`
- `legal_hold_context_detected` (safe summary only — no raw reason /
  notes / metadata)
- `previous_status` / `new_status` on approval and self-approval block
- `reason` field on denial paths (`mfa_required`, `not_platform_admin`,
  `self_approval_blocked`, etc.)

The smoke script does not assert audit-row presence directly because it
runs without service-role privileges. Audit emission is contract-pinned
by the existing source-pin tests
(`src/tests/admin-export-controls-batch-{2,3,4,5,6}.test.ts`) and the
prebuild guards (`scripts/check-admin-export-controls-batch-{2..6}.mjs`)
which all pass on this commit. Audit rows can be verified directly in
Lovable Cloud → Audit logs filtered by `request_id`.

## Guard / regression results

Run on this commit:

- `node scripts/check-admin-export-controls-batch-2.mjs` → OK
- `node scripts/check-admin-export-controls-batch-3.mjs` → OK
- `node scripts/check-admin-export-controls-batch-4.mjs` → OK
- `node scripts/check-admin-export-controls-batch-5.mjs` → OK
- `node scripts/check-admin-export-controls-batch-6.mjs` → OK
- `npx vitest run src/tests/admin-export-controls-batch-{3,4,5,6}.test.ts`
  → 4 files passed (29 + 28 + 37 + 29 = 123 tests)
- `node scripts/check-release-gate-sync.mjs` → OK
- `node scripts/check-evidence-secret-leaks.mjs` → OK

Live smoke run:

- `node scripts/admin-export-controls-batch-7-smoke.mjs`
- **Status when executed in this loop:** NOT EXECUTED. The sandbox
  this batch was written in does not hold staging `SMOKE_*` credentials
  (requester / approver / AAL1 / non-admin accounts plus TOTP secrets
  and a Governance Record UUID). The script exits with code `2` and a
  precise missing-env list when invoked without those values, so the
  operator can run it as-is from a workstation that has them.

When the operator runs it against staging, the resulting
`evidence/admin-export-controls-batch-7-live-e2e-smoke.json` must show
every path (`A_request_success`, `B1_request_denied_aal1`,
`B2_request_denied_non_admin`, `C_approval_success`,
`D_self_approval_blocked`, `E1_list_visibility`, `E2_list_denied_aal1`,
`E3_list_denied_non_admin`) with `ok: true` and an empty top-level
`failures` array.

## No-generation / no-download proof

The harness inspects every edge-function response with
`assertNoGenerationLeak()`, which fails the path if any of these tokens
appear in the response body:

- `signed_url`, `signedUrl`, `createSignedUrl`
- `download_link`, `downloadUrl`, `download_url`
- `\bprepare(d)?\b`, `\bdestroy(ed)?\b`
- `text/csv`, `Content-Disposition`, `new Blob`
- `generated_file`, `file_path`, `storage_object`

The script never POSTs to `export-prepare`, `export-download`,
`export-destroy`, `admin-export-prepare`, `admin-export-download`, or
`admin-export-destroy`. None of those edge functions are referenced in
its source.

## DATA-004 isolation

This batch does not touch DATA-004 in any form:

- No migrations added.
- No changes to `org_retention_policies`, `get_effective_retention_days`,
  `admin-org-retention`, `cold-storage-archive`,
  `cold-storage-archive-dryrun`, `cold-storage-archive-live`,
  `purge-email-send-log-daily`, `email-log-anonymise`,
  `storage-retention-cleanup`, `account-deletion-sweeper`, the live
  cron drift monitor, or any `cron.job` rows.
- The Sunday 2026-05-31 04:10 UTC `cold-storage-archive-live` tick is
  not affected by this work.

## Remaining risks

1. **Live run not executed in this loop.** The contract is proven
   statically by Batches 2–6 source-pin tests and guards; the live run
   is a separate operator action gated on staging credentials.
2. **TOTP factor discovery.** The harness expects a verified TOTP
   factor on the AAL2 rows; sites with WebAuthn-only AAL2 will need a
   harness extension (out of scope for Batch 7).
3. **Legal-hold-linked anchor.** The current smoke does not require a
   legal-hold-linked Governance Record. If the operator points
   `SMOKE_GOVERNANCE_RECORD_ID` at one, the safe `legal_hold_context`
   summary will appear in the request response and the list row, and
   the Batch 6 guard already pins that no raw reason / notes / metadata
   leaks.
4. **No redaction engine yet.** `redaction_mode` is recorded and
   preserved through the lifecycle but no payload is produced. This is
   intentional — redaction implementation is Batch 8.

## Recommended Batch 8

**Redaction Contract Implementation** — define and enforce the
`redaction_mode` contract (`redacted_client_safe`, `evidence_only`,
`metadata_only`, `full_internal`) as a pure, deterministic, fully
audited transformation over a sample Governance Record payload, with
contract tests pinning the field allow-list per mode. Still no file
generation, no download, no signed URL, no destroy, no storage object.

Do not recommend prepare / download / export generation until the live
smoke (this Batch 7) and the redaction contract (Batch 8) are both
green.
