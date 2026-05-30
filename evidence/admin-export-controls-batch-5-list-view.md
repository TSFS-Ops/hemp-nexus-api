# Admin Export Controls — Batch 5: HQ Governance Export Request List View

**Scope:** Read-only, platform_admin + AAL2-gated cross-record listing of
Governance Record export requests. Visibility only.

**Approved means approved only — not prepared, not generated, not
downloadable.** This batch does not change that. It exposes the
request → approval lifecycle to operators without adding any
preparation, generation, download, signed URL, or destroy surface.

DATA-004 was NOT touched. No cron schedules were touched. No
cold-storage / archive / retention / legal-hold-retention enforcement
was touched.

## Files changed

| Path | Kind | Notes |
|---|---|---|
| `supabase/functions/admin-governance-export-list/index.ts` | new | Read-only edge function: `is_admin` → `assertAal2` → `SELECT` on `export_requests` scoped to `kind='admin_export'` AND `governance_record_id IS NOT NULL`. Returns governance-safe summary rows. No mutation. No file generation. No signed URL. No prepare / download / destroy invocation. |
| `src/components/admin/governance/AdminGovernanceExportRequestsListPanel.tsx` | new | HQ list panel. `isPlatformAdmin` UI guard. AAL2 banner. Status filter (subset of visible statuses). Optional governance_record_id UUID filter. Empty / loading / error / denied states. Invokes only `admin-governance-export-list`. No download / prepare / destroy / signed URL / CSV / JSON / PDF surfaces. |
| `src/pages/HQ.tsx` | edited | New `export-requests` sub-tab under Governance Records, mounting the list panel. Inherits existing platform_admin `RequireAuth` wrapping `/hq`. |
| `src/tests/admin-export-controls-batch-5.test.ts` | new | Static-contract / source-pin tests across the edge function, panel, mount, and guard. |
| `scripts/check-admin-export-controls-batch-5.mjs` | new | Prebuild guard pinning the read-only list-view contract. |
| `package.json` | edited | Wired the Batch 5 guard into `prebuild`. |
| `RELEASE_GATE.md` | edited | New Batch 5 entry alongside Batch 4. |

## Backend path

- Edge function: `admin-governance-export-list` (POST).
- Auth flow inside the function:
  1. Bearer header required → 401 if missing.
  2. `userClient.auth.getUser()` resolves the caller → 401 if invalid.
  3. `admin.rpc("is_admin", { user_id })` → 403 `NOT_PLATFORM_ADMIN`
     otherwise (emits `data.admin_export_blocked_or_declined`).
  4. `assertAal2` on the bearer token → 403 `MFA_REQUIRED`
     otherwise (emits `data.admin_export_blocked_or_declined`).
  5. Strict Zod-validated body. Statuses limited to
     `['awaiting_approval','approved','denied','failed']`.
- Query: `export_requests` filtered by
  `kind='admin_export' AND governance_record_id IS NOT NULL AND status IN (...)`,
  ordered by `requested_at DESC`, limited to ≤200 rows.
- Response: `{ ok, count, items, contract }` with a `contract` block
  asserting `no_file_generated`, `no_download_link`, `no_signed_url`,
  `no_prepare`, `no_destroy`, `aal2_required`, `platform_admin_only`.

No new RPC, no new table, no schema migration.

## UI

- Component: `AdminGovernanceExportRequestsListPanel`.
- Route: HQ → Governance Records → **Export Requests** sub-tab
  (`/hq/governance-records?sub=export-requests`).
- Guarded by:
  - `/hq` route is wrapped by `<RequireAuth role="platform_admin">`.
  - Component itself short-circuits to a destructive Alert if
    `isPlatformAdmin` is false.
  - Server still enforces `is_admin` + AAL2 — UI guards are defence in
    depth.

## Access control matrix

| Caller | Result | Notes |
|---|---|---|
| Unauthenticated | 401 `unauthorized` | Edge function rejects before any DB read. |
| Authenticated, non-platform admin (any org admin / broker / buyer / supplier / demo / test user) | 403 `NOT_PLATFORM_ADMIN` | Audit: `data.admin_export_blocked_or_declined`. |
| Platform admin, AAL1 (no MFA challenge in session) | 403 `MFA_REQUIRED` | Audit: `data.admin_export_blocked_or_declined`. |
| Platform admin, AAL2 | 200 with governance-safe rows | No file, no link, no token. |

UI visibility:
- Tab is mounted only inside `/hq`, which is gated by
  `platform_admin` `RequireAuth`. Org admins, brokers, buyers, suppliers,
  and demo / test users cannot reach `/hq` and therefore cannot reach
  this tab. Direct URL access to `/hq?...&sub=export-requests` for a
  non-platform-admin redirects via `RequireAuth` → `/dashboard?denied=1`.

## AAL1 vs AAL2

- AAL2 required for the list view. Reasoning: this view exposes
  cross-record governance metadata (requester / approver / reason
  summary / legal-hold-context presence). Per the Batch 1 contract,
  sensitive HQ export-governance surfaces require AAL2 even when no
  mutation occurs.
- AAL1 callers receive a stable 403 `MFA_REQUIRED` and an audit
  `data.admin_export_blocked_or_declined { reason: 'mfa_required' }`.

## Fields exposed

Per row:
- `export_request_id`
- `governance_record_id`
- `status` (one of the Batch 5 visible statuses)
- `requested_by` (user id)
- `requested_at`
- `approved_by` (user id, when present in `approval.approved_by`)
- `approved_at` (when present in `approval.approved_at`)
- `redaction_mode`
- `purpose`
- `reason_summary` (whitespace-collapsed, truncated to 160 chars)
- `approval_note_summary` (same trim rules, from `approval.note`)
- `legal_hold_context_present` (boolean)
- `legal_hold_context_scope` (string only, from `verification.legal_hold_context.scope`)
- `target_org_id`
- `created_at`, `updated_at`

## Fields deliberately excluded

- Raw sensitive metadata of any kind.
- Raw sanctions / PEP / adverse media data.
- Full legal-hold reasons (only `present` + `scope` are exposed).
- Raw API response payloads.
- File paths.
- Storage keys.
- Signed URLs.
- Download tokens.
- Any `prepared` / `generated` / `ready_for_download` / `downloaded` /
  `destroyed` lifecycle state — those rows are filtered out at the query
  layer because the status enum is restricted to the Batch 5 set.

## Status handling

Allowed visible statuses:
- `awaiting_approval`
- `approved`
- `denied`
- `failed`

The edge function refuses any other status in `statuses` via Zod and
silently drops them at the query because of the explicit `.in(...)`
clause. The UI status toggles are restricted to the same set.

Batch 4 approval semantics are unchanged. This batch never calls
`approve_admin_governance_export` or `request_admin_governance_export`,
never `INSERT/UPDATE/DELETE`s `export_requests`, and never writes any
`status = ...` value.

## Legal-hold context display

If `verification.legal_hold_context` exists on the underlying request,
the row renders a `legal-hold context` badge with the scope appended
(when present). The full `reason` / `hold_id` are intentionally NOT
returned by the list endpoint — this is intentional ahead of the
recommended Batch 6 (Legal-Hold Context Auto-Detection).

## Audit / evidence decision

- Successful reads are NOT audited in this batch. The existing
  DATA-010 audit vocabulary (`data.admin_export_requested`,
  `data.admin_export_approved`, `data.admin_export_generated`,
  `data.admin_export_downloaded`, `data.admin_export_blocked_or_declined`,
  `data.admin_export_file_destroyed`) does not contain a "listed" /
  "viewed" verb, and inventing one would drift the
  `DATA_005_010_export-lifecycle` SSOT and trip
  `scripts/check-data-005-010-export-lifecycle.mjs`. The pattern in
  Records / Memory / Tenant Boundary HQ surfaces is to leave plain reads
  unaudited.
- Denials ARE audited via the canonical
  `data.admin_export_blocked_or_declined` action with the `surface:
  'admin-governance-export-list'` discriminator, so refusal evidence is
  uniform with Batch 2 / Batch 4.
- Backend restrictions preventing unauthorized visibility:
  - Bearer header required.
  - `is_admin` RPC check before any data access.
  - `assertAal2` before any data access.
  - Service-role client is only used after both gates pass.
  - Query scope hard-pinned to `kind='admin_export'` AND
    `governance_record_id IS NOT NULL`.

## Tests added

`src/tests/admin-export-controls-batch-5.test.ts` — source-pin Vitest
suite covering:
- Edge access matrix (401 / 403 / order-of-checks / Zod strictness).
- Query scope (kind, governance_record_id non-null, status .in,
  ordering, limit, optional record filter).
- Response governance-safety (summarised reason / note, legal-hold
  present + scope only, contract block flags, no storage keys / file
  paths / signed URLs / download tokens / raw payloads).
- Non-mutation (no `.insert`, no `.update`, no `.delete` on
  `export_requests`, no `SET status =`, no approve / request RPC).
- Canonical audit on denial paths and absence of out-of-vocabulary
  `data.admin_export_listed` / `_read` / `_viewed`.
- UI panel access guard + invocation scope + required columns + empty /
  loading / error / denied states + AAL2 banner + contract badge.
- UI panel absence of prepare / download / destroy / generate /
  signed-URL / CSV / JSON / PDF / "ready to download" surfaces and no
  invocation of any other edge function.
- UI status filter constrained to the Batch 5 visible set.
- Mount: HQ.tsx imports + mounts + adds `export-requests` sub-tab id
  and is wrapped by platform_admin `RequireAuth`.
- Guard wiring: script exists and pins the read-only contract.

## Guard

`scripts/check-admin-export-controls-batch-5.mjs`:
- Edge function: requires `assertAal2`, `is_admin`, strict Zod,
  Batch 5 status enum, `.eq('kind','admin_export')`,
  `.not('governance_record_id','is',null)`, `.in('status', ...)`,
  blocked_or_declined audit, NOT_PLATFORM_ADMIN / MFA_REQUIRED codes.
  Forbids `createSignedUrl`, storage `.upload` / `.download`,
  `new Blob`, `text/csv`, any `.insert` / `.update` / `.delete` on
  `export_requests`, prepare/download/destroy verbs, calls to
  `export-prepare` / `export-download` / `export-destroy` /
  `admin-export-prepare`, `SET status =`, and any approve RPC call.
- Panel: requires `isPlatformAdmin` guard, the AAL2 banner,
  the no-file-generated badge, the legal-hold indicator, and the
  empty/loading/error/denied states. Forbids any other edge invocation,
  signed URL / Blob / CSV / PDF / JSON download surfaces, `downloadCSV`,
  anchor `download` attributes, prepare/destroy/generate/download
  buttons, "ready to download" wording, invocation of
  `export-prepare` / `export-download` / `export-destroy` /
  `admin-governance-export-approve` / `admin-governance-export-request`,
  and any direct `export_requests` mutation.
- Mount: requires the import, the `<AdminGovernanceExportRequestsListPanel />`
  mount, and the `["records","memory","export-requests"]` sub-tab tuple
  in `HQ.tsx`.
- Test file: requires the headline contract pins
  (`MFA_REQUIRED`, `NOT_PLATFORM_ADMIN`, read-only, no-file-generated).

Wired into `prebuild` after `check-admin-export-controls-batch-4.mjs`
and before `check-evidence-secret-leaks.mjs`.

## Commands run

```
npx vitest run src/tests/admin-export-controls-batch-5.test.ts
node scripts/check-admin-export-controls-batch-5.mjs
```

(Results captured in the agent run log; both pass green at submit.)

## Explicit confirmations

- No file generation was added.
- No download link was added.
- No signed URL was added.
- No prepare behaviour was added.
- No destroy behaviour was added.
- No CSV / JSON / PDF export was added.
- No public storage / bucket access was added.
- No `export_requests` mutation surface was added.
- No legal-hold record mutation occurred.
- No change to approval semantics from Batch 4.
- No self-approval bypass.
- DATA-004 was NOT touched.
- No cron schedules were touched.
- No retention jobs were touched.
- No cold-storage / archive logic was touched.

## Remaining risks

- Legal-hold context is exposed only as presence + scope; the full
  `reason` / `hold_id` are deliberately withheld. Some operators may
  want to see the hold id in-list. That is the explicit scope of the
  recommended Batch 6 (Legal-Hold Context Auto-Detection), where the
  link from request → live legal hold gets surfaced safely.
- Successful reads are not audited. If the project later decides HQ
  governance reads warrant a "viewed" audit, it must be added to the
  DATA-005/010 SSOT first, then surfaced here without changing any
  other behaviour.
- `approval.approved_by` / `approval.approved_at` are read from the
  free-form `approval` JSON written by Batch 4. If a future batch
  restructures the `approval` payload, the list panel will gracefully
  show `—` until the field map is updated.

## Recommended Batch 6

**Legal-Hold Context Auto-Detection.** Before any redaction / prepare /
download work, the platform should automatically link a Governance
Record export request to live legal holds on its anchor (match /
parties / docs) and surface the link in this list view. That keeps the
safety boundary intact while making the list view operationally
actionable. Redaction Contract Implementation and Live E2E Smoke for
request → approval → list visibility remain the two batches after
that, in either order.
