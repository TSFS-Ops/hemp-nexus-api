# Admin Export Controls — Batch 8 (Redaction Contract Implementation)

Status: complete. Pure, non-generating redaction-contract helper. No file generation, no downloads, no signed URLs, no storage writes, no prepare/destroy. Batch 7C production-refusal guard NOT weakened. DATA-004 (cron / retention / cold-storage) NOT touched. `legal_holds` not mutated.

## Decision context

Proceeding under **Option 3** (publish/build and debug later) because no separate staging backend is connected. The Batch 7C live smoke runner remains blocked: the only connected backend is marked `tier='production'` and the runner correctly refuses. We are NOT flipping production to staging, NOT bypassing the production guard, NOT executing Batch 7C against production. Batch 8 is therefore restricted to non-generating, non-downloadable work.

## Files changed

- created `supabase/functions/_shared/admin-export-redaction.ts` — pure redaction-contract helper
- created `src/tests/admin-export-controls-batch-8.test.ts` — Vitest behaviour tests
- created `scripts/check-admin-export-controls-batch-8.mjs` — prebuild guard
- edited  `package.json` — prebuild wires new guard
- edited  `RELEASE_GATE.md` — Batch 8 entry (release-gate-sync satisfied)
- created `evidence/admin-export-controls-batch-8-redaction-contract.md` — this file

## Redaction modes implemented

Four canonical modes, default `redacted_client_safe`:

| Mode                    | Purpose                                                                 |
|-------------------------|-------------------------------------------------------------------------|
| `redacted_client_safe`  | Default. Safe for counterparty / external client review. PII removed.   |
| `evidence_only`         | Evidence-shape summary (counts / kinds). No decision text, no PII.      |
| `metadata_only`         | Identifiers + timestamps + status only. No decision text, no evidence.  |
| `full_internal`         | Platform_admin internal review only. PII retained at top level; secrets, signed URLs, raw legal-hold reasons, raw third-party payloads still blocked. |

Unsupported mode → `UnsupportedRedactionModeError`. Omitted / `undefined` / `null` mode → `redacted_client_safe`.

## Allowed fields by mode

- `metadata_only`: `governance_record_id`, `export_request_id`, `match_id`, `status`, `redaction_mode`, `requested_at`, `approved_at`, `updated_at`, `created_at`, `is_demo`, `is_test`, `demo`, `test_mode`, `legal_hold` (reduced).
- `redacted_client_safe`: metadata_only set + `decision_summary`, `outcome_summary`, `purpose`, `reason_summary`, `approval_note_summary`, `counterparty_label`.
- `evidence_only`: metadata_only set + `evidence_summary`, `evidence_counts`.
- `full_internal`: redacted_client_safe + evidence_only + `requester_user_id`, `approver_user_id`, `audit_reference_ids`, `previous_status`, `new_status`.

Any field not in the per-mode allow-list is dropped and recorded in `manifest.removed_fields`.

## Always-forbidden categories (every mode)

Field names containing any of these substrings (case-insensitive) are removed from output and recorded in `manifest.forbidden_fields_blocked`:

- Secrets / auth: `password`, `password_hash`, `encrypted_password`, `password_salt`, `api_key`, `auth_token`, `session_token`, `refresh_token`, `reset_token`, `verification_token`, `webhook_secret`, `signing_secret`, `bearer`, `totp`, `mfa_secret`
- Payment instruments: `card_number`, `card_cvv`, `card_cvc`, `card_expiry`, `pan`
- File / download / storage: `signed_url`, `download_url`, `download_token`, `storage_path`, `storage_object`, `file_path`, `file_url`, `object_key`, `bucket`
- Raw third-party / compliance payloads: `sanctions_raw`, `pep_raw`, `adverse_media_raw`, `raw_api_response`, `third_party_confidential`, `auto_sources_raw`
- Internal notes: `internal_notes`, `admin_notes`, `privileged_legal_notes`, `internal_investigation_notes`
- Raw legal-hold context: `legal_hold_reason`, `legal_hold_notes`, `released_reason`, `released_by`, `applied_by_user`

## PII masking (every mode except `full_internal`)

Field names containing any of: `email`, `phone`, `phone_number`, `msisdn`, `physical_address`, `postal_address`, `street_address`, `address_line`, `national_id`, `passport`, `tax_id`, `id_number`, `date_of_birth`, `dob` — replaced with deterministic `MASK_TOKEN = "[REDACTED]"`. In `full_internal` the underlying value is retained but every PII touch is still recorded in `manifest.masked_fields`.

## Legal-hold safe schema

When `legal_hold` is present on the input, it is reduced to ONLY:

```
has_legal_hold, scope, hold_count, hold_sources, primary_scope,
detected_at, detection_source, detection_version
```

`reason`, `notes`, `metadata`, `released_reason`, `released_by`, `applied_by_user` are dropped. This mirrors the Batch 6 Legal-Hold Context Auto-Detection contract.

## Sample redaction manifest

```json
{
  "mode": "redacted_client_safe",
  "allowed_fields": [
    "governance_record_id", "export_request_id", "match_id", "status",
    "redaction_mode", "requested_at", "approved_at", "updated_at",
    "created_at", "is_demo", "is_test", "demo", "test_mode",
    "legal_hold", "decision_summary", "outcome_summary", "purpose",
    "reason_summary", "approval_note_summary", "counterparty_label"
  ],
  "removed_fields": [
    "arbitrary_extra_field", "email", "phone_number", "physical_address",
    "requester_user_id", "approver_user_id", "audit_reference_ids",
    "previous_status", "new_status", "evidence_summary", "evidence_counts",
    "legal_hold.metadata", "legal_hold.reason", "legal_hold.notes"
  ],
  "masked_fields": [],
  "forbidden_fields_blocked": [
    "admin_notes", "adverse_media_raw", "api_key", "applied_by_user",
    "auth_token", "auto_sources_raw", "bearer", "bucket", "card_number",
    "download_token", "download_url", "file_path", "file_url",
    "internal_investigation_notes", "internal_notes",
    "legal_hold.applied_by_user", "legal_hold.released_by",
    "legal_hold.released_reason", "legal_hold_notes", "legal_hold_reason",
    "mfa_secret", "object_key", "pan", "password", "password_hash",
    "pep_raw", "privileged_legal_notes", "raw_api_response",
    "refresh_token", "released_by", "released_reason", "sanctions_raw",
    "signed_url", "signing_secret", "storage_object", "storage_path",
    "third_party_confidential", "totp", "webhook_secret"
  ],
  "legal_hold_reduced": true,
  "notes": []
}
```

## Demo / test label handling

`is_demo`, `is_test`, `demo`, `test_mode` are in every mode's allow-list and pass through verbatim. The Batch 8 tests assert this.

## Tests added

`src/tests/admin-export-controls-batch-8.test.ts` — Vitest. Cases:

- exposes exactly the four canonical modes with `redacted_client_safe` default
- rejects unsupported modes via `UnsupportedRedactionModeError`
- defaults safely when mode is omitted / `undefined` / `null`
- never mutates the input object across all four modes
- per-mode (4 modes × 4 assertions):
  - output keys are a subset of the per-mode allow-list
  - strips every always-forbidden surface (secrets, signed URLs, raw payloads, raw legal-hold reasons)
  - reduces `legal_hold` to safe-summary fields only
  - preserves demo / test labels verbatim
  - manifest records removed / masked / forbidden categories accurately
- `redacted_client_safe` removes PII top-level (email, phone, physical_address)
- `metadata_only` excludes evidence + decision + counterparty
- `evidence_only` includes evidence_summary + evidence_counts but no decision
- `full_internal` includes requester/approver ids + audit refs but still blocks every forbidden surface
- `ALWAYS_FORBIDDEN` list covers every dangerous category floor
- `MASK_TOKEN` is the stable `[REDACTED]` placeholder

Result: prebuild guard `scripts/check-admin-export-controls-batch-8.mjs` green; Vitest cases pass locally.

## Guard / prebuild results

`scripts/check-admin-export-controls-batch-8.mjs` is wired into `package.json` → `prebuild`, after `check-admin-export-controls-batch-7c.mjs` and before `check-evidence-secret-leaks.mjs`. The guard asserts:

- helper exports `redactGovernanceRecord`, `REDACTION_MODES`, `DEFAULT_REDACTION_MODE`, `ALLOWED_FIELDS_BY_MODE`, `LEGAL_HOLD_SAFE_FIELDS`, `MASK_TOKEN`, `UnsupportedRedactionModeError`
- declares the four canonical modes literally
- default is `"redacted_client_safe"`
- always-forbidden list contains every floor substring (password, api_key, auth_token, signed_url, download_url, download_token, storage_path, file_path, sanctions_raw, pep_raw, adverse_media_raw, internal_notes, admin_notes, legal_hold_reason, legal_hold_notes, raw_api_response)
- helper performs NO IO and NO generation: no `fetch(`, no `createSignedUrl`, no `.storage`, no `Deno.writeFile/writeTextFile`, no `new Blob(`, no `text/csv`, no `application/pdf`, no `Content-Disposition`, no `supabase.functions.invoke`, no `from('export_requests'/'legal_holds'/'governance_records')`, no `.insert()`, no `.update()`, no `.delete()`, no `.rpc()`
- helper does NOT touch DATA-004 surface: no `org_retention_policies`, no `cron.schedule`/`net.http_post`, no `cold-storage-archive`
- helper does NOT reference the Batch 7C production guard or confirm phrase (those remain owned by the staging-only runner)
- helper does NOT reference prepare/download/destroy endpoint names
- prebuild wires this guard

## Behaviour changes in request / approval / list paths

**None.** Batch 8 introduces only the shared redaction helper + tests + guard. The `admin-governance-export-request`, `admin-governance-export-approve`, and `admin-governance-export-list` edge functions are NOT modified by this batch. The request / approval / list panels are NOT modified. The Batch 7C internal smoke runner is NOT modified.

## Explicit confirmations

- No file generation, no CSV/JSON/PDF output, no Blob, no `Content-Disposition`, no download anchor.
- No signed URL creation, no storage upload, no storage download, no public bucket access.
- No prepare / download / destroy edge function added or invoked.
- No raw legal-hold reason / notes / metadata exposure in any mode.
- No raw sanctions / PEP / adverse-media payload exposure in any mode.
- No secrets / tokens / auth identifiers in any mode.
- Batch 7C production guard NOT weakened. `is_production_environment()` not touched.
- DATA-004 not touched: no cron, no retention policies, no cold-storage, no schedule changes.
- `legal_holds` table not mutated by Batch 8 code.
- `export_requests` not mutated by Batch 8 code.

## Batch 7C status

Live execution **remains blocked**. The only connected backend is `tier='production'`. The Batch 7C runner correctly refuses with `production_refused`. We did NOT flip the tier, did NOT weaken the guard, did NOT execute the runner. Batch 7C live evidence remains pending a real staging Lovable Cloud instance.

## Remaining risks

- **Surface drift**: future batches that build a prepare / download surface MUST consume this contract and the Batch 8 guard MUST be extended to also pin the consuming surface's redaction-mode default.
- **Source-data shape drift**: the contract is allow-list based, so any new top-level governance-record field is dropped by default (safe-by-default). Reverse risk: a new safe field will be silently removed until added to `ALLOWED_FIELDS_BY_MODE`.
- **Nested-array shape**: the recursive walker masks/removes by field name only. A future input that places PII inside an array of free-form objects is still sanitised by-name; PII embedded inside a string value (e.g. inside `decision_summary`) is NOT detected.
- **No live verification**: this batch ships with static tests only. End-to-end verification still requires a staging environment.

## Recommended Batch 9

**Do NOT** open `prepare` / `download` / `destroy` in Batch 9 without explicit approval to accept the production-debug risk. Two safer Batch 9 candidates:

1. **Redaction UI Preview Shell (no download)** — render the redacted payload + manifest read-only in HQ for platform_admin review; no Blob, no anchor, no CSV, no PDF, no storage write, no signed URL. Lets the redaction contract be reviewed against real Governance Record fixtures without opening any output surface.
2. **Admin Export Controls Production-Safe Manual QA Checklist** — document the exact production-safe operator checks (request / approve / list / legal-hold detection / redaction-contract review) that can be performed against the connected backend without invoking the Batch 7C runner.

Either keeps the production guard intact and DATA-004 untouched.
