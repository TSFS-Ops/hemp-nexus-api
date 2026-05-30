# Admin Export Controls — Batch 9 (Redaction UI Preview Shell)

Status: complete. Read-only preview shell. NO file generation, NO download link, NO signed URL, NO storage upload, NO Blob, NO `Content-Disposition`, NO prepare / destroy. NO mutation of `export_requests` / `legal_holds` / `matches` / `governance_records`. Batch 7C production-refusal guard NOT weakened. DATA-004 (cron / retention / cold-storage) NOT touched.

## Decision context

Continuing under **Option 3** (publish/build-and-debug-later) because no separate staging backend is connected. Batch 7C live execution remains blocked (production refusal is correct and intact). Batch 9 stays inside the safe boundary: lets HQ/platform_admin users visually review what a Governance Record export would look like after applying the Batch 8 redaction contract, without opening any output / download surface.

## Files changed

- created `supabase/functions/admin-governance-export-preview/index.ts` — preview edge function
- created `src/components/admin/governance/AdminGovernanceExportPreviewPanel.tsx` — HQ preview panel
- edited  `src/pages/HQ.tsx` — adds the `export-preview` sub-tab under Governance Records
- created `src/tests/admin-export-controls-batch-9.test.ts` — Vitest source-pin tests
- created `scripts/check-admin-export-controls-batch-9.mjs` — prebuild guard
- edited  `package.json` — prebuild wires the new guard
- edited  `RELEASE_GATE.md` — Batch 9 entry (release-gate-sync satisfied)
- created `evidence/admin-export-controls-batch-9-redaction-preview-shell.md` — this file

## Preview surfaces

- **Edge function**: `POST /functions/v1/admin-governance-export-preview` (Lovable-managed; CORS-handled). Body: `{ governance_record_id: uuid, redaction_mode?: "redacted_client_safe" | "evidence_only" | "metadata_only" | "full_internal" }`. Response: `{ ok, governance_record_id, redaction_mode, redacted, manifest, contract }`.
- **HQ UI**: `/hq` → tab `governance-records` → sub-tab `export-preview` → component `AdminGovernanceExportPreviewPanel`.

## Access control / AAL2 behaviour

- **Edge function** enforces (defence in depth):
  1. `Authorization: Bearer …` required (401 `unauthorized` otherwise).
  2. `is_admin(adminUser.id)` RPC must return true (403 `NOT_PLATFORM_ADMIN`, denial audit emitted).
  3. `assertAal2(...)` must pass (403 `MFA_REQUIRED`, denial audit emitted).
  4. Zod schema enforces UUID `governance_record_id` and the four-mode allow-list (400 `invalid_body`).
- **UI** also guards on `useAuth().isPlatformAdmin` and renders a restricted-access alert for non-admins; UUID is validated client-side before invocation.
- Demo / test / org-admin / broker / buyer / supplier users have no route, no UI affordance, and are denied by the server gates if they hit the function directly.

## Redaction modes supported

The four canonical Batch 8 modes (default `redacted_client_safe`):

- `redacted_client_safe` — counterparty/external client-safe summary. PII removed.
- `evidence_only` — evidence-shape summary; no decision text, no PII.
- `metadata_only` — identifiers + status + timestamps only; no evidence, no decision text.
- `full_internal` — platform_admin internal review; retains PII at top level; secrets, signed URLs, raw legal-hold reasons, raw third-party payloads still blocked.

Unsupported mode → 400 `UNSUPPORTED_REDACTION_MODE` (Zod-rejected, defence-in-depth catch returns the same code if `redactGovernanceRecord` throws).

## Payload assembly (safe by construction)

The edge function does NOT query raw sensitive tables. It assembles a Governance Record-shaped payload from three already-safe sources:

- `matches` (anchor for Governance Record). Columns selected: `id, status, created_at, updated_at, buyer_org_id, seller_org_id`. No commercial terms, no document blobs, no notes, no metadata are selected.
- `export_requests` (latest by `requested_at` for the governance_record_id; `kind='admin_export'`). Columns selected: `id, status, redaction_mode, requested_at, updated_at, created_at`. No `reason`, no `approval`, no `verification` selected.
- `detectGovernanceRecordLegalHold(...)` (Batch 6 helper) — returns the safe summary only (`has_legal_hold`, `scope`, `hold_count`, `hold_sources`, `primary_scope`, `detected_at`, `detection_source`, `detection_version`). Never reads `reason`, `notes`, `metadata`, `released_*`, `applied_by`.

The assembled payload is then passed through the Batch 8 helper `redactGovernanceRecord(payload, redaction_mode)`. The helper is pure, deterministic, and never mutates the input.

## Sample redaction manifest (mode = `redacted_client_safe`)

```json
{
  "mode": "redacted_client_safe",
  "allowed_fields": [
    "governance_record_id","export_request_id","match_id","status",
    "redaction_mode","requested_at","approved_at","updated_at","created_at",
    "is_demo","is_test","demo","test_mode","legal_hold","decision_summary",
    "outcome_summary","purpose","reason_summary","approval_note_summary",
    "counterparty_label"
  ],
  "removed_fields": [],
  "masked_fields": [],
  "forbidden_fields_blocked": [],
  "legal_hold_reduced": true,
  "notes": []
}
```

For typical real-world Governance Records, the manifest will populate `removed_fields` with any allow-list-rejected top-level keys and `masked_fields` with any PII paths encountered inside nested objects.

## Sensitive fields excluded (at every layer)

- **Source selection** never reads: legal-hold `reason`, `notes`, `metadata`, `released_reason`, `released_by`, `applied_by`; `export_requests.reason` / `.approval` / `.verification`; raw match commercial terms; match documents / blobs / storage paths; sanctions / PEP / adverse-media raw payloads; user secrets / tokens.
- **Redaction contract** (Batch 8 floor) drops/masks: secrets (`password`, `api_key`, `auth_token`, `refresh_token`, `webhook_secret`, `signing_secret`, `bearer`, `totp`, `mfa_secret`), payment instruments (`card_number`, `pan`), file/download/storage surface (`signed_url`, `download_url`, `download_token`, `storage_path`, `storage_object`, `file_path`, `file_url`, `object_key`, `bucket`), raw compliance payloads (`sanctions_raw`, `pep_raw`, `adverse_media_raw`, `raw_api_response`, `third_party_confidential`, `auto_sources_raw`), internal notes (`internal_notes`, `admin_notes`, `privileged_legal_notes`, `internal_investigation_notes`), raw legal-hold context (`legal_hold_reason`, `legal_hold_notes`, `released_reason`, `released_by`, `applied_by_user`), and PII (`email`, `phone`, `physical_address`, `national_id`, `passport`, `tax_id`, `date_of_birth`, …) masked to `[REDACTED]` in every mode except `full_internal`.

## Tests added

`src/tests/admin-export-controls-batch-9.test.ts` (Vitest, source-pin):

Edge function — platform_admin + AAL2 gates; consumes Batch 8 helper; defaults to `redacted_client_safe` and enumerates the four canonical modes; emits the canonical denial audit on refusal; performs NO `.insert`/`.update`/`.delete`/`.upsert`; performs NO `createSignedUrl` / `.storage` / `Deno.writeFile`/`writeTextFile` / `new Blob(` / `text/csv` / `application/pdf` / `Content-Disposition` / `supabase.functions.invoke`; does NOT touch Batch 7C production guard or DATA-004 surface.

HQ panel — renders preview-only / no-download / no-signed-URL / AAL2 badges; renders redacted + manifest containers; invokes ONLY `admin-governance-export-preview` (and NEVER list/request/approve/prepare/download/destroy); renders no download anchor / Blob / `URL.createObjectURL` / `saveAs` / csv-pdf MIME / `Content-Disposition` / `Download` / `Prepare` / `Destroy` / `Ready to download` / `signed url` surface; guards on `isPlatformAdmin`; validates UUID client-side.

Prebuild wiring — guard script exists, `package.json` prebuild invokes it, RELEASE_GATE.md documents the batch and the guard.

## Commands run / results

- `node scripts/check-admin-export-controls-batch-9.mjs` → ✅ passed
- `node scripts/check-release-gate-sync.mjs` → ✅ passed (Batch 9 guard documented)
- `node scripts/check-evidence-secret-leaks.mjs` → ✅ clean
- `node scripts/check-batch-suite-presence.mjs` → ✅ passed
- `bunx vitest run src/tests/admin-export-controls-batch-9.test.ts` → ✅ all cases pass
- `bunx vitest run src/tests/admin-export-controls-batch-8.test.ts` → ✅ 31/31 still pass (no regression)

## Behaviour changes in request / approval / list paths

**None.** Batch 9 introduces a new preview surface only. The `admin-governance-export-request`, `admin-governance-export-approve`, and `admin-governance-export-list` edge functions and panels are unchanged. The Batch 7C internal smoke runner is unchanged. No migration is added. No new audit name is introduced — only the canonical `data.admin_export_blocked_or_declined` is emitted on denial.

## Explicit confirmations

- NO file generation, NO CSV/JSON/PDF, NO Blob, NO `Content-Disposition`, NO download anchor, NO copy-link, NO save-as.
- NO signed URL creation, NO storage upload/download, NO public bucket access, NO storage path returned.
- NO prepare / download / destroy edge function added or invoked.
- NO raw legal-hold reason / notes / metadata exposure.
- NO raw sanctions / PEP / adverse-media payload exposure.
- NO secrets / tokens / auth identifiers in the response.
- Batch 7C production guard NOT weakened. `is_production_environment()` not referenced from Batch 9 code.
- DATA-004 NOT touched: no cron, no `org_retention_policies`, no `cold-storage-archive`, no schedule changes.
- NO mutation of `export_requests`, `legal_holds`, `matches`, or `governance_records`.

## Batch 7C status

Still blocked. Only connected backend is `tier='production'`; runner correctly refuses with `production_refused`. Not bypassed, not weakened.

## Remaining risks

- **No live verification** for the preview backend without staging — static contract tests only.
- **Source-data drift** — if `matches` columns or `legal_holds` schema change, the source selection must be re-audited; the redactor's allow-list-by-default contract is a safety net but is not a substitute for source-side discipline.
- **PII inside free text** — PII embedded inside a string value (e.g. inside a future `decision_summary`) is not detected. Today's payload assembly does NOT include free-text decision strings, but any future addition must consider this.
- **UI rendering of nested values** — the panel renders the redacted JSON verbatim via `JSON.stringify`. This is intentional (faithful preview), and the redactor has already stripped/masked sensitive surfaces upstream.

## Recommended Batch 10

Do NOT open `prepare` / `download` / `destroy` in Batch 10 without explicit risk acceptance for the production-debug posture. Two safer candidates:

1. **Admin Export Controls Production-Safe Manual QA Checklist** — documented operator checks runnable against the connected backend without invoking the Batch 7C runner. Covers request / approve / list / legal-hold detection / redaction-contract review / Batch 9 preview, with expected codes and expected absence of generation-leak markers.
2. **Redaction Preview Manual QA Pack** — extends Batch 9 with a documented set of synthetic Governance Record ids (or in-UI fixture-loader behind a platform_admin-only test mode) exercising every redaction mode + legal-hold permutation, still without opening any output surface.
