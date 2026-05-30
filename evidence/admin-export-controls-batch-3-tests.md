# Admin Export Controls — Batch 3 Evidence

**Scope:** Test/proof-only batch covering the Batch 2 Governance Record export
**request shell**. No approval, prepare, download, destroy, signed URL, file
generation, or new export surface added. DATA-004 was not touched.

## Files changed

| Path | Change |
|---|---|
| `src/tests/admin-export-controls-batch-3.test.ts` | NEW — 41 static-contract / source-pin tests (Vitest). |
| `scripts/check-admin-export-controls-batch-3.mjs` | NEW — prebuild guard pinning Batch 2 surfaces remain request-only and Batch 3 test file stays intact. |
| `package.json` | EDITED — wired `check-admin-export-controls-batch-3.mjs` into `prebuild`. |
| `RELEASE_GATE.md` | EDITED — Batch 3 entry appended. |
| `evidence/admin-export-controls-batch-3-tests.md` | NEW — this file. |

No edge function, RPC, migration, panel, mount, cron, retention, archive, or
legal-hold code was modified in this batch.

## Tests added (41 cases, all pass)

`src/tests/admin-export-controls-batch-3.test.ts` groups:

1. **Edge function access matrix (5 cases)** — Bearer-only, POST-only,
   `is_admin` + `NOT_PLATFORM_ADMIN`, `assertAal2` + `MFA_REQUIRED`, and the
   ordering invariant (platform check *before* AAL check, so a non-admin can
   never reach the MFA gate).
2. **Body validation (8 cases)** — strict Zod schema, UUID
   `governance_record_id`, `MIN_EXPORT_REASON_LENGTH`, `EXPORT_PURPOSES` enum,
   4-value `redaction_mode` allow-list, `redacted_client_safe` default,
   `invalid_body` denial + audit, `invalid_json` path.
3. **Audit emission — DATA-010 canonical (4 cases)** — imports
   `DATA_010_AUDIT_ACTIONS`, emits `requested` on success, emits
   `blocked_or_declined` ≥ 4× (one per denial path), payload carries
   `actor_user_id`, `governance_record_id`, `redaction_mode`,
   `legal_hold_context`, `purpose`, `reason`, plus structured denial reason
   codes (`not_platform_admin`, `mfa_required`, `invalid_body`,
   `request_create_failed`).
4. **RPC + DB contract (7 cases)** — redaction CHECK constraint exists with
   exactly the 4 modes; `governance_record_id` + `redaction_mode` columns
   added; `request_admin_governance_export` is `SECURITY DEFINER` with locked
   `search_path`; raises on missing record id / short reason; defaults
   redaction mode safely; raises on invalid mode; `REVOKE … FROM PUBLIC,
   anon, authenticated` + `GRANT … TO service_role`; inserts `awaiting_approval`
   + `admin_export`.
5. **UI visibility + scope (10 cases)** — `return null` for non-platform-admin
   viewers, AAL2 banner present, default redaction mode is
   `redacted_client_safe`, all four modes present and no rogue extras, reason
   ≥10 char gating, only invokes `admin-governance-export-request` (no
   `admin-export-approve` / `export-prepare` / `export-download` /
   `admin-export-destroy`), shows "No file generated" + "No download link",
   success surface exposes `request_id` + `redaction_mode` + "awaiting"
   wording, no approve/prepare/download/destroy controls, no
   `createSignedUrl`/`Blob(text/*)`, no `raw_payload`/`event_store`/`dump_all`/
   `export_all` strings.
6. **Mount contract (2 cases)** — `GovernanceRecordDetail` only mounts the
   panel when `isPlatformAdmin && anchor.matchId`, and the
   `governanceRecordId` prop is bound to `anchor.matchId` (not a free-form
   value).
7. **Batch 2 boundary preserved (3 cases)** — edge function generates/signs/
   uploads nothing; no `admin_export_approved|prepared|downloaded|destroyed`
   verbs anywhere in the edge function; the migration writes
   `'awaiting_approval'` and never `'approved'`/`'ready'`/`'downloaded'`.

## Commands run

```bash
node scripts/check-admin-export-controls-batch-3.mjs
# → [check-admin-export-controls-batch-3] OK — request-only contract holds.

bunx vitest run src/tests/admin-export-controls-batch-3.test.ts
# → Test Files  1 passed (1)
# → Tests      41 passed (41)

node scripts/check-release-gate-sync.mjs
# → ✓ Batch W release-gate sync: 61 script(s) and 7 cron job(s) documented.
```

## Backend access matrix (pinned by tests)

| Caller | Result |
|---|---|
| Unauthenticated (no `Authorization: Bearer …`) | `401 unauthorized` (no audit — pre-actor) |
| Authenticated, not platform_admin (org admin, broker, buyer, supplier, demo/test user) | `403 NOT_PLATFORM_ADMIN` + `data.admin_export_blocked_or_declined` audit |
| platform_admin, AAL1 (no MFA) | `403 MFA_REQUIRED` + `data.admin_export_blocked_or_declined` audit |
| platform_admin, AAL2, valid body | `200 ok` + `data.admin_export_requested` audit, `status=awaiting_approval` |
| platform_admin, AAL2, malformed JSON | `400 invalid_json` |
| platform_admin, AAL2, invalid body (missing record id / bad mode / short reason / unknown field) | `400 invalid_body` + `data.admin_export_blocked_or_declined` audit |

Pinning is via static source assertions over the edge function — there is no
live invocation in this batch.

## UI role visibility matrix (pinned by tests)

| Viewer | Sees `AdminGovernanceExportRequestPanel`? |
|---|---|
| platform_admin on a Governance Record with `anchor.matchId` | Yes |
| platform_admin without a `matchId` anchor | No (mount gate) |
| Any non-platform-admin role (org admin, compliance, legal, director, auditor, broker, buyer, supplier, demo) | No (`return null` guard + mount gate) |

## AAL1 vs AAL2 result matrix

| Auth | Outcome |
|---|---|
| AAL1 | UI: denial banner with `MFA_REQUIRED` copy. Edge: `403 MFA_REQUIRED`. Audit: `data.admin_export_blocked_or_declined` (`reason="mfa_required"`). |
| AAL2 | UI: success state with `request_id`, `redaction_mode`, "awaiting approval". Edge: `200`. Audit: `data.admin_export_requested`. |

## Audit event proof

The `admin-governance-export-request` edge function emits exactly two
canonical DATA-010 audit actions:

- `data.admin_export_requested` — emitted on success only. Payload includes
  `actor_user_id`, `requested_by_admin_user_id`, `surface`, `request_id`,
  `governance_record_id`, `target_org_id`, `purpose`, `reason`,
  `requested_categories`, `redaction_mode`, `legal_hold_context`, and the
  `requestId` + `target_org_id` are passed positionally to
  `writeLifecycleAudit` so they land on the canonical anchor columns.
- `data.admin_export_blocked_or_declined` — emitted on all four denial paths
  (`not_platform_admin`, `mfa_required`, `invalid_body`,
  `request_create_failed`). Pinned by a regex count assertion.

## Redaction mode proof

- DB CHECK constraint `export_requests_redaction_mode_domain` allows only
  `NULL`, `redacted_client_safe`, `evidence_only`, `metadata_only`,
  `full_internal` (verified live: `pg_get_constraintdef` matches the
  migration text).
- RPC default + edge default + UI default all resolve to
  `redacted_client_safe`.
- `full_internal` is reachable only through the gated edge function, which
  itself requires `platform_admin` + AAL2 — there is no client-side or
  anon/authenticated path that can bypass these.

## DB/RPC contract proof

Live DB introspection (`pg_proc` × `has_function_privilege`):

| Role | `EXECUTE request_admin_governance_export` |
|---|---|
| `postgres` (owner) | `t` |
| `service_role` | `t` |
| `authenticated` | `f` |
| `anon` | `f` |

This matches the migration's `REVOKE … FROM PUBLIC, anon, authenticated` +
`GRANT … TO service_role` and is pinned by Test §4. Tenant-boundary
assumptions are preserved: the RPC is wrapped by the platform-admin edge
function, which is the only call site, and no anon/authenticated caller can
reach it directly.

## Guard / prebuild result

- `scripts/check-admin-export-controls-batch-3.mjs` wired into `prebuild`
  immediately after `check-admin-export-controls-batch-2.mjs` and before
  `check-evidence-secret-leaks`.
- `check-release-gate-sync.mjs` reports `61 script(s)` documented — the new
  guard is present in `RELEASE_GATE.md`.
- Manual run of the guard: PASS.
- Manual run of the contract tests: 41/41 PASS.

## Remaining risks

1. **Live integration not exercised.** This batch is source-pin only, mirroring
   the existing `data-010-export-aal2-universal.test.ts` pattern. A future
   batch (Approval Shell) should add a Deno integration test that actually
   invokes the edge function with a fake JWT.
2. **No second-admin approval yet.** Batch 2 returns `awaiting_approval` but
   there is currently no UI path to advance the request. Until the Approval
   Shell ships, requests will accumulate. Acceptable for now — they are inert.
3. **`legal_hold_context` is descriptive, not enforcing.** The field is
   stored, audited, and surfaced in the request payload, but the request does
   not yet refuse to issue a hold-bound export. The Legal-Hold Context
   Auto-Detection batch should add the enforcing leg.
4. **Redaction modes are declared, not implemented.** The CHECK constraint
   pins the vocabulary but no redaction engine consumes it yet. The Redaction
   Contract Implementation batch should close this.
5. **Panel is not yet covered by a React Testing Library test.** Visibility
   and content invariants are source-pinned only. A future UI batch could add
   a `@testing-library/react` render test for `isPlatformAdmin = false`.

## Explicit confirmations

- No approval, prepare, download, destroy, file generation, signed URL, or
  download link behaviour was added in this batch.
- No new export surface, broad data dump, or "export all" path was
  introduced.
- DATA-004 (per-org retention, cold-storage archive, legal-hold retention
  enforcement, cron schedules) was **not touched**. Batch 13 fixtures remain
  staged for the scheduled `cold-storage-archive-live` jobid 41 tick at
  Sunday 2026-05-31 04:10 UTC.
- No migration, edge function, RPC, panel, or mount code was modified.

## Recommended Batch 4

Given the risks above, the natural next step is **Governance Record Export
Approval Shell** — a second-admin AAL2 approval surface that transitions
`awaiting_approval → approved` (no file generation yet, no download yet),
with canonical `data.admin_export_approved` / `…_blocked_or_declined`
audits and contract tests + guard in the same pattern as this batch.
Legal-Hold Context Auto-Detection and Redaction Contract Implementation
remain valid alternates but both benefit from having the approval anchor in
place first.
