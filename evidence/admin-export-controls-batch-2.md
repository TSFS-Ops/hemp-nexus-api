# Admin Export Controls — Batch 2: HQ Governance Record Export Request Shell

**Status:** Built. Request + audit only. No file generation, no signed
URLs, no download links, no approval flow, no destructive behaviour.

**DATA-004 not touched.** No cron schedules, no retention jobs, no
cold-storage code. Batch 13 fixtures A/B/D remain staged for jobid 41
tick on Sunday 2026-05-31 04:10 UTC.

---

## Files changed

| Kind | Path |
|---|---|
| migration | `supabase/migrations/<timestamp>__admin_export_controls_batch_2.sql` (applied via migration tool) |
| edge fn | `supabase/functions/admin-governance-export-request/index.ts` (new) |
| UI | `src/components/admin/governance/AdminGovernanceExportRequestPanel.tsx` (new) |
| UI mount | `src/components/admin/governance/GovernanceRecordDetail.tsx` (mounted panel at bottom, platform_admin + matchId gated) |
| guard | `scripts/check-admin-export-controls-batch-2.mjs` (new) |
| prebuild | `package.json` (guard wired immediately before `check-evidence-secret-leaks.mjs`) |
| evidence | `evidence/admin-export-controls-batch-2.md` (this file) |

## Migration summary

Additive only. No backfill. No destructive changes.

- `public.export_requests` gained two nullable columns:
  - `governance_record_id uuid NULL`
  - `redaction_mode text NULL` with CHECK domain
    `('redacted_client_safe','evidence_only','metadata_only','full_internal')`.
- Index `export_requests_governance_record_idx` on
  `governance_record_id WHERE governance_record_id IS NOT NULL`.
- New SECURITY DEFINER RPC
  `public.request_admin_governance_export(p_requester_user_id uuid,
   p_governance_record_id uuid, p_purpose text, p_reason text,
   p_requested_categories text[], p_target_org_id uuid DEFAULT NULL,
   p_redaction_mode text DEFAULT 'redacted_client_safe',
   p_date_range jsonb DEFAULT NULL,
   p_legal_hold_context jsonb DEFAULT NULL)`.
  - Sets `search_path = public`.
  - Validates `governance_record_id NOT NULL`, `purpose NOT NULL`,
    `length(reason) >= 10`, `redaction_mode` in the allow-list.
  - Inserts `kind='admin_export'`, `status='awaiting_approval'`,
    `verification` jsonb carries `legal_hold_context`.
  - `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated;
     GRANT EXECUTE ... TO service_role;`
  - Existing `request_admin_export` RPC + the existing self-approval
    trigger remain unchanged.

## Backend path

`supabase/functions/admin-governance-export-request/index.ts` — new
edge function:

- `POST` only.
- Reads Bearer token; `userClient.auth.getUser` to identify caller.
- `admin.rpc('is_admin', { user_id })` gate — denies with
  `403 { code: 'NOT_PLATFORM_ADMIN' }` and emits
  `data.admin_export_blocked_or_declined`.
- `assertAal2(...)` gate — denies with
  `403 { code: 'MFA_REQUIRED' }` and emits
  `data.admin_export_blocked_or_declined`.
- Zod `BodySchema.strict()` validates
  `governance_record_id`, `purpose ∈ EXPORT_PURPOSES`,
  `reason.trim().min(10).max(500)`, `requested_categories` (1..32),
  optional `target_org_id`, `redaction_mode` (default
  `'redacted_client_safe'`), `date_range`, `legal_hold_context`.
  Invalid body → 400 + audit.
- Calls `admin.rpc('request_admin_governance_export', ...)`.
- On success emits canonical
  `data.admin_export_requested` with metadata: `actor_user_id`,
  `requested_by_admin_user_id`, `surface`, `request_id`,
  `governance_record_id`, `target_org_id`, `purpose`, `reason`,
  `requested_categories`, `redaction_mode`, `legal_hold_context`.
- Returns
  `{ ok, request_id, status: 'awaiting_approval', redaction_mode, next_step }`.
- **Never** generates a file, mints a signed URL, returns user data,
  or links to storage.

## UI route / component

Surface: HQ → Governance Records → record detail.
The new panel is mounted at the **bottom** of
`GovernanceRecordDetail.tsx`, gated on `isPlatformAdmin` AND
`anchor.matchId`. The panel is invisible to every other role.

Panel (`AdminGovernanceExportRequestPanel.tsx`) shows:

- AAL2-required banner with explicit "no file generated, no download
  link" copy.
- Export purpose select (mirrors `EXPORT_PURPOSES`).
- Redaction-mode select; default `redacted_client_safe`. `full_internal`
  is selectable but labelled "platform_admin investigations only" — it
  is **not** the default and the server validates the value.
- Reason textarea (max 500, client-side disable when `<10` chars; server
  enforces the same).
- Scope/filter summary textarea (optional, appended to reason).
- "Record export request" button; "No file generated · No download
  link" badge.
- States: `idle`, `submitting`, `success` (shows request_id +
  redaction_mode + "awaiting approval" copy), `denied` (e.g.
  `MFA_REQUIRED` / `NOT_PLATFORM_ADMIN`), `failed`.
- No download anchor, no signed-URL handling, no Blob/CSV code.

## Role matrix

| Role | Sees panel | Can submit | Server outcome |
|---|---|---|---|
| platform_admin (AAL2) | yes | yes | request recorded; `data.admin_export_requested` emitted |
| platform_admin (AAL1) | yes | submit blocked | 403 `MFA_REQUIRED`; `data.admin_export_blocked_or_declined` emitted |
| non-platform admin (any AAL) | no | n/a | direct API call returns 403 `NOT_PLATFORM_ADMIN`; audit emitted |
| org admin / compliance / legal / director / auditor | no | n/a | 403 (same path) |
| broker / buyer / supplier / demo | no | n/a | 403 (same path) |
| unauthenticated | n/a | n/a | 401 |

## AAL2 / MFA behaviour

- Request submission requires AAL2 (`assertAal2`).
- AAL1 receives the project-standard response shape:
  `403 { error: "mfa_required", code: "MFA_REQUIRED" }`.
- UI surfaces this as a clear "Request blocked · MFA_REQUIRED" alert.

## Audit events

| Trigger | Action | entity_type | metadata.surface |
|---|---|---|---|
| Successful request | `data.admin_export_requested` | `export_request` | `admin-governance-export-request` |
| Non-platform admin | `data.admin_export_blocked_or_declined` | `export_request` | same, `reason='not_platform_admin'` |
| Missing AAL2 | `data.admin_export_blocked_or_declined` | `export_request` | same, `reason='mfa_required'` |
| Invalid body | `data.admin_export_blocked_or_declined` | `export_request` | same, `reason='invalid_body'`, `errors` |
| RPC failure | `data.admin_export_blocked_or_declined` | `export_request` | same, `reason='request_create_failed'`, `rpc_error` |

All audits routed through the canonical
`supabase/functions/_shared/export-lifecycle-audit.ts:writeLifecycleAudit`.
No bespoke audit writer was introduced.

## Legal-hold behaviour

- The shell does **not** block requests on legal hold (preservation
  /evidence export is the explicit reason for the admin path).
- The request payload accepts `legal_hold_context = { hold_id, scope,
  reason }` and stores it inside `export_requests.verification ->
  legal_hold_context` plus on the canonical audit row.
- The shell does **not** mutate, delete, or read held records — it
  only records intent.
- **Unverified — worth checking:** whether a separate "is record under
  legal hold?" precheck should auto-populate `legal_hold_context`. No
  precheck exists today; deferred to Batch 3 explicitly.

## Redaction modes

Stored on `export_requests.redaction_mode`. Server default and CHECK
domain enforced:

1. `redacted_client_safe` (default; safest)
2. `evidence_only`
3. `metadata_only`
4. `full_internal` (selectable, but never the default; labelled in UI)

The shell only **stores** the requested mode. The actual redaction
engine remains in `supabase/functions/_shared/export-redaction.ts`
(via `export-prepare`) and is unchanged.

## Tests added

None in this batch. Test scaffolding for this surface is deferred to
**Batch 3** because the approve/prepare path it would exercise does
not yet have UI or a sign-off. Test obligations are recorded here:

- backend: platform_admin AAL2 success; AAL1 → `MFA_REQUIRED`;
  non-platform_admin → 403; invalid body → 400 + audit; request
  inserts row with `governance_record_id` + `redaction_mode`; audit
  rows present.
- UI: panel hidden for non-platform_admin; success/denied/failed states
  render correctly; no download link rendered.
- guard: passing today; regression-fixture variant deferred to Batch 3.

## Prebuild guard result

`node scripts/check-admin-export-controls-batch-2.mjs` →
**`OK — request shell stays within scope.`**

Wired into `package.json` `prebuild`, immediately before
`check-evidence-secret-leaks.mjs`.

## Explicit confirmations

- **No file generated.** The edge function contains no `toCsv`,
  no `storage.from(...).upload`, no `createSignedUrl`, no
  `Blob([...], { type: 'text/csv' })`. Guard enforced.
- **No download link.** The UI panel contains no `signedUrl`, no
  `<a ... download>`, no `downloadCSV`. Guard enforced.
- **No approval flow.** `approve_admin_export` RPC and
  `admin-export-approve` edge fn untouched.
- **No prepare/destroy flow.** `export-prepare` and `export-destroy`
  untouched.
- **No DATA-004 touchpoints.** No cron schedules, no retention jobs,
  no cold-storage code, no `data_004_cron_drift_check` calls.
- **No `request_admin_export` RPC change.** DATA-010 Phase 2A path
  remains intact and unmodified.
- **Tenant boundary preserved.** Only `platform_admin` reaches the
  RPC; existing `export_requests` RLS for `admin_export` already
  scopes SELECT to `is_admin(auth.uid())`.

## Remaining risks

- **R-A** No HQ list view yet for `export_requests` filtered by
  `governance_record_id` — operators cannot review their own past
  requests visually until Batch 3 adds it.
- **R-B** Legal-hold context is operator-provided in this batch.
  Auto-detection deferred to Batch 3.
- **R-C** Tests for the new edge function and panel are deferred to
  Batch 3 (see "Tests added").

## Recommended Batch 3 scope

Choose ONE of:

1. **Governance Record Export Approval shell** — wire
   `admin-export-approve` into the same HQ panel for `platform_admin`
   #2 to approve a Batch-2 request (no prepare, no download).
2. **Governance Record Export Redaction Contract Tests** — Vitest +
   Deno tests asserting role / AAL2 / audit / redaction-mode storage
   for the Batch-2 edge function and panel, plus an
   `admin-governance-export-request` Playwright smoke (request → audit
   row visible).

Both are narrow and additive. Neither generates files or download
links.
