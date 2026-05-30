# Admin Export Controls — Batch 1: Assessment + Control Contract

**Workstream:** Admin Export Controls (separate from DATA-004).
**Scope:** Read-only inventory and contract. No code, cron, schedule, retention, or
legal-hold enforcement changed. DATA-004 (Batch 13 awaiting scheduled
`cold-storage-archive-live` jobid 41 tick) was not touched.
**Method:** `rg`/`code--view` over `supabase/functions/**`, `src/components/admin/**`,
`src/components/governance/**`, `src/components/desk/**`, `src/lib/download-utils.ts`,
plus the existing DATA-005 / DATA-010 / Batch O (AUD-012/017/018) memory.

---

## 1. Existing export inventory

### 1.1 Server-side export edge functions

| Edge function | Data exported | Roles allowed | AAL2 | Audited | Redaction | Limits | Signed URL | Notes |
|---|---|---|---|---|---|---|---|---|
| `supabase/functions/admin-export-request` | metadata only (creates `export_requests` row) | `platform_admin` (`is_admin` RPC) | **yes** (`assertAal2`) | `data.admin_export_requested` / `data.admin_export_blocked_or_declined` | n/a (no payload) | requires `subject_user_id` OR `target_org_id`, ≤32 categories, reason ≥10 chars, purpose ∈ `EXPORT_PURPOSES` | n/a | DATA-010 Phase 2A. Unscoped requests rejected with `MUST_BE_SCOPED`. |
| `supabase/functions/admin-export-approve` | n/a (state transition `awaiting_approval` → `export_preparation_required`) | `platform_admin` + AAL2 | yes | `data.admin_export_approved` | n/a | DB trigger + server reject `approver == requester` (two-person rule) | n/a | |
| `supabase/functions/export-prepare` | CSV under `USER_EXPORT_CATEGORY_ALLOW_LISTS` / `ADMIN_EXPORT_CATEGORY_ALLOW_LISTS` via `safeProjection` (no `SELECT *`) | service-role only | n/a (server worker) | `data.export_prepared` / `data.admin_export_generated` | column allow-list + `safeProjection`; residency hold gate | per-kind TTL (user 7d, admin 3d); uploads to private bucket | n/a (writes file) | Demo short-circuit + residency claim guard wired. |
| `supabase/functions/export-download` | mints download URL only | user-export: `subject_user_id == auth.uid()`; admin-export: `platform_admin` + AAL2 AND (requester OR approver) | yes (admin path) | `data.export_delivered` / `data.admin_export_downloaded` | n/a (file already redacted by prepare) | **TTL = 300 s** (`EXPORT_DOWNLOAD_SIGNED_URL_TTL_SECONDS`) | yes, private bucket, 300 s | Residency hold gate wired. |
| `supabase/functions/export-destroy` | n/a (lifecycle) | service-role / `x-internal-cron-key` | n/a | `export.destroy_dry_run_scanned` only | n/a | `EXPORT_DESTROY_PHASE = 'phase_2a_dry_run_only'`; destructive mode gated on `EXPORT_DESTROY_ENABLED='true'` (unset in Phase 2A; verified by `scripts/check-data-005-010-export-lifecycle.mjs`) | n/a | **Not yet destructive — sign-off pending.** |
| `supabase/functions/export-audit` | n/a (writes audit row before client-side CSV) | `platform_admin` (`is_admin` RPC) + AAL2 (default-sensitive) | yes | legacy `export.csv`/`export.json` + canonical `data.admin_export_requested` / `_blocked_or_declined` / `_generated` | enforces `purpose`, `reason ≥10 chars`, `target_org_id`, `data_categories` | n/a (client streams) | n/a | Batch O AUD-012; bridges legacy client-side CSV exports into the DATA-010 audit spine. |
| `supabase/functions/user-export-request` | n/a (Phase 1 records request only) | authenticated user (self) | n/a (Phase 1 metadata only) | `data.user_export_requested` / `_scope_resolved` / `_blocked_or_declined` | category allow-list (`ALLOWED_USER_EXPORT_CATEGORIES`) + `FORBIDDEN_USER_EXPORT_CATEGORIES` strip + legal-hold guard | rate-limit + legal-hold guard | n/a | Phase 1 NEVER returns user data / signed URL. |
| `supabase/functions/document-download` | single document object via signed URL | authenticated; admin path requires `access_reason` query param | not explicit (relies on `authenticateRequest`) | access-logged | n/a | per-document | yes, short-lived signed URL | Admin downloads require `access_reason`. |
| `supabase/functions/evidence-pack` | canonical evidence JSON (deterministic, hashed) | authenticated + `requireScope` + `enforceTokenMetering` + residency gate | inherits scope/auth | yes (canonical JSON serialisation; hash deterministic) | canonical projection only | rate-limited, token-metered | n/a (response body) | Not a bulk dump; per-match evidence pack. |
| `supabase/functions/tenant-boundary-evidence-download` | sealed Batch 5 manifest JSON for a given `run_id` | `platform_admin` only (no MFA per Batch 5 Stage 1) | no | append-only sealed evidence model | n/a (already sealed) | one run_id at a time | response body | Static probe evidence, not a tenant data dump. |
| `supabase/functions/cold-storage-archive` | non-destructive JSON copies to `archived-records` bucket | service-role / `x-internal-cron-key` | n/a | `retention_run_evidence` (no `audit_logs` writes — `audit_logs.org_id` NOT NULL) | n/a (system data copy) | dry-run default `true`; live path gated to Sundays via jobid 41 | n/a | DATA-004 Batch 7+10. **Out of scope here.** |

### 1.2 Client-side CSV exports (legacy / Batch O AUD-018 hardened)

All sensitive client CSV exports route through `auditedDownloadCSV` /
`auditedDownloadCSVRaw` in `src/lib/download-utils.ts`. Raw `downloadCSV(` /
`new Blob([...], { type: 'text/csv' })` is forbidden in `src/components/admin/**`,
`src/components/desk/**`, `src/components/match/**` by prebuild guard
`scripts/check-csv-export-audit.mjs` (allowlist currently empty).

| Surface | File | Data | Roles | AAL2 | Audited |
|---|---|---|---|---|---|
| Admin audit logs CSV | `src/components/admin/AdminAuditLogs.tsx` | redacted audit rows (`redactExportMetadata`) | HQ admin | yes (via `auditedDownloadCSV` → `export-audit` default-sensitive) | yes |
| Admin revenue CSV | `src/components/admin/AdminRevenuePanel.tsx` | revenue rows | HQ admin | yes | yes |
| Admin pending engagements CSV | `src/components/admin/AdminPendingEngagementsPanel.tsx` | pending engagements | HQ admin | yes | yes |
| Admin notification prefs CSV | `src/components/admin/AdminNotificationPreferencesPanel.tsx` | notif prefs | HQ admin | yes | yes |
| Admin outreach blocks CSV | `src/components/admin/AdminOutreachBlocksPanel.tsx` | outreach blocks | HQ admin | yes | yes |
| Users management CSV | `src/components/admin/UsersManagement.tsx` | user rows | HQ admin | yes | yes |
| Matches list CSV (per-row + bulk) | `src/components/MatchesList.tsx` | match rows | org-scoped | yes | yes |

### 1.3 Self-service surface

- `src/components/desk/settings/DataExportTab.tsx` — DATA-005 Phase 1 user export
  request surface. Categories restricted to `ALLOWED_USER_EXPORT_CATEGORIES`;
  `FORBIDDEN_USER_EXPORT_CATEGORIES` cannot be requested.

### 1.4 HQ admin export UI

**Finding:** No HQ admin surface currently invokes `admin-export-request` /
`admin-export-approve` / `export-prepare` / `export-download`. `rg` over `src/`
returns matches only in `src/integrations/supabase/types.ts` and test files
(`data-005-010-phase2a-export-lifecycle.test.ts`, `ops-010-demo-isolation.test.ts`,
`data-009-phase-2-review-workflow.test.ts`). The DATA-010 Phase 2A pipeline is
server-complete but has no operator UI — see Risk R1.

---

## 2. Risk findings

| ID | Risk | Severity | Evidence |
|---|---|---|---|
| R1 | DATA-010 Phase 2A admin-export pipeline is wired server-side but has no HQ UI. Operators cannot exercise it; reviewers cannot verify it end-to-end. | High | §1.4 |
| R2 | `export-destroy` is dry-run only (`EXPORT_DESTROY_PHASE='phase_2a_dry_run_only'`). Expired export files accumulate in the private bucket until destructive path is signed off. | Med | §1.1 |
| R3 | `document-download` does not visibly call `assertAal2` for admin downloads; relies on `authenticateRequest` + `access_reason` only. Needs confirmation it routes through AAL2 for HQ access. | Med | §1.1 |
| R4 | `tenant-boundary-evidence-download` is `platform_admin` only but explicitly **no MFA** (Batch 5 Stage 1). Acceptable for sealed static evidence; document explicitly. | Low | §1.1 |
| R5 | `export-audit` still permits client-side CSV streaming. Audit row is written first (AUD-017), but the actual bytes are produced in the browser. Phase 2 (server-side projection under signed URL) is the long-term fix. | Low | §1.1 |
| R6 | No canonical link today between an export request and a Governance Record. `export_requests` does not carry a `governance_record_id` reference. | Med | derived |
| R7 | Legal-hold interaction is asymmetric: `user-export-request` blocks via `assertNoLegalHold`; admin path uses residency hold gate in `export-prepare` / `export-download` but does not explicitly require a `legal_hold_context` field on admin requests touching held records. | Med | §1.1 |
| R8 | No demo/test-row labelling contract on generated admin exports (DATA-004 `test_mode_bypass` audit pattern exists but is not asserted on CSV output). | Low | derived |

---

## 3. Admin Export Control Contract (binding for future batches)

1. **Role control.** Only `platform_admin` can call `admin-export-request` /
   `admin-export-approve` / admin path of `export-download`. Org admins may
   only export their own org's data via a future scoped surface with an explicit
   `target_org_id == own_org` check. Brokers / buyers / suppliers / demo users
   are blocked. Direct unauthorised calls must return `401`/`403` with the
   canonical `NOT_PLATFORM_ADMIN` / `FORBIDDEN` codes.
2. **AAL2 / MFA.** Every sensitive admin export action — request, approve,
   prepare-trigger, download — requires AAL2. List / preview surfaces may
   remain AAL1. AAL2 failure returns the project-standard `MFA_REQUIRED`
   shape (`{ error: "mfa_required", code: "MFA_REQUIRED" }`, HTTP 403),
   matching `admin-export-request`.
3. **Auditability.** Every export path emits canonical DATA-010 / DATA-005
   audits: `requested`, `approved`, `blocked_or_declined`, `generated`,
   `downloaded`, `file_destroyed`. Each row carries `actor_user_id`,
   `target_org_id`, `subject_user_id`, `purpose`, `reason`, `requested_categories`,
   `row_count` (post-prepare), `file_hash` (post-prepare),
   `redaction_mode`, `timestamp`, and request_id. Audits are append-only.
4. **Redaction.** Server-side `safeProjection` + per-category allow-lists are
   mandatory; `SELECT *` is forbidden (already enforced by `export-redaction.ts`).
   Modes: `full_internal` (platform_admin investigations only), `redacted_client_safe`
   (default for admin exports of customer data), `evidence_only`,
   `metadata_only`. Sensitive fields (passwords, hashes, API keys, webhook
   secrets, auth tokens, session tokens, reset tokens, payment card data,
   admin notes, privileged legal notes, raw audit logs, other-org data) are
   forbidden by `FORBIDDEN_USER_EXPORT_CATEGORIES` and the admin allow-list.
5. **Scope and limits.** Every request must carry explicit filters
   (`subject_user_id` OR `target_org_id`), bounded `requested_categories`
   (≤32), `date_range` where applicable, and a row-count cap enforced in
   `export-prepare`. No unbounded platform-wide dump. Large exports must be
   async (jobs already are).
6. **Tenant boundary.** Org isolation is mandatory. Cross-org exports are
   `platform_admin` only and must be flagged `cross_tenant=true` in the
   audit row. Mixed-tenant CSVs are forbidden unless the request is
   explicitly cross-tenant and audited.
7. **Legal-hold / Governance Record integration.** Exports related to a
   Governance Record must record `governance_record_id` on
   `export_requests` and on every lifecycle audit. Preservation/evidence
   export by `platform_admin` is permitted on held records but must be
   labelled `legal_hold_context={hold_id, scope, reason}` and audited.
   Exports must never mutate / delete held records — enforced by reusing
   the existing `assertNoLegalHold` semantics for mutation paths.
8. **File handling.** Files live in the private `exports` bucket only;
   signed URLs expire at `EXPORT_DOWNLOAD_SIGNED_URL_TTL_SECONDS = 300 s`;
   `file_hash` (SHA-256), `generated_by`, `generated_at`, `expires_at` are
   persisted on `export_files`. Public buckets are forbidden. Destruction
   policy: user exports 7 d TTL, admin exports 3 d TTL; destructive
   cleanup gated on `EXPORT_DESTROY_ENABLED='true'` + separate sign-off
   (R2).
9. **UI requirements.** HQ Admin Export Controls surface must show:
   export type, filters, AAL2-required banner, redaction mode, estimated
   row count (when safe), latest export jobs, status, download link (when
   ready, AAL2-gated), expiry, audit reference, denied/failed reason,
   `governance_record_id` (when linked). Cancel/Close affordance per
   modal standard.
10. **Tests required (deferred to implementation batch).** Each of the
    bullets in the prompt §10 becomes an explicit `it(…)` in the next
    batch's test file; none are added in Batch 1.

---

## 4. What must be blocked now

- Any new export edge function or client export path that bypasses
  `safeProjection` + DATA-010 audit constants.
- Any client CSV outside the `auditedDownloadCSV` / `auditedDownloadCSVRaw`
  wrappers (already prebuild-enforced).
- Activating the destructive branch of `export-destroy` (R2).
- Exposing admin-export pipeline to non-`platform_admin` roles.
- Returning export payloads without AAL2 on the admin path.

## 5. What can be safely built first (recommended Batch 2 scope)

**Batch 2 — HQ Governance Record Export Shell (read-only request + audit only).**

Narrow, defensible scope:
- Add a `governance_record_id uuid NULL` column to `export_requests`
  (additive migration) and propagate it through `admin-export-request`
  body schema + `request_admin_export` RPC + lifecycle audit payloads.
- Add a single HQ panel `src/components/admin/AdminExportRequestsPanel.tsx`
  that lists `export_requests` for the active operator and lets a
  `platform_admin` (AAL2) **request** a Governance Record export. No
  approval, no prepare-trigger, no download in Batch 2.
- Reuse `EXPORT_PURPOSES`; add `governance_record_review` to the enum
  in a paired migration.
- Prebuild guard: new `scripts/check-admin-export-controls-contract.mjs`
  asserting the canonical audit names are emitted on every code path and
  that the panel imports only the audited download helpers.

**Out of scope for Batch 2:** approval, prepare, download, destroy,
cross-org bulk export, legal-hold preservation export, demo-row labelling
contract. Each becomes its own batch.

---

## 6. Confirmations

- **DATA-004 not touched.** No cron schedules, no retention jobs, no
  cold-storage-archive code, no `data_004_cron_drift_check` calls.
  Batch 13 fixtures A/B/D remain in place pending the scheduled jobid 41
  tick at Sunday 2026-05-31 04:10 UTC.
- **No destructive behaviour introduced.** This batch is read-only.
- **No new endpoints, no schema changes, no migrations.**
- **No new memory entries.** A memory entry will be added in Batch 2
  once the contract is exercised by code.
