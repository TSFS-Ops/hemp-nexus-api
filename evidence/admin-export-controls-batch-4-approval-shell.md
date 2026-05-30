# Admin Export Controls — Batch 4 Evidence (Governance Record Export Approval Shell)

**Scope:** Narrow approval shell. A second `platform_admin` with AAL2 can
transition an `awaiting_approval` Governance Record export request to
`approved`. **No file generation, no preparation, no download, no signed URL,
no destroy. DATA-004 not touched.**

> **Acceptance line:** *Approved means approved only — not prepared, not
> generated, not downloadable.*

## Files changed

| Path | Change |
|---|---|
| `supabase/migrations/<batch-4>.sql` (`approve_admin_governance_export`) | NEW — additive: adds `'approved'` to admin_export status CHECK; creates SECURITY DEFINER RPC, `service_role`-only EXECUTE. |
| `supabase/functions/admin-governance-export-approve/index.ts` | NEW — platform_admin + AAL2 edge function wrapping the RPC; deployed. |
| `src/components/admin/governance/AdminGovernanceExportApprovalPanel.tsx` | NEW — HQ panel listing pending requests for the current Governance Record and surfacing the Approve action. |
| `src/components/admin/governance/GovernanceRecordDetail.tsx` | EDITED — imports + mounts the approval panel beneath the request panel, gated on `isPlatformAdmin && anchor.matchId`. |
| `src/tests/admin-export-controls-batch-4.test.ts` | NEW — 40 source-pin contract tests (Vitest). |
| `scripts/check-admin-export-controls-batch-4.mjs` | NEW — prebuild guard. |
| `package.json` | EDITED — wired guard into `prebuild`. |
| `RELEASE_GATE.md` | EDITED — Batch 4 entry appended. |

## Migration summary

- `ALTER TABLE public.export_requests` — `export_requests_status_domain` CHECK
  rebuilt to additionally allow `'approved'` for `kind='admin_export'`. All
  pre-existing statuses preserved verbatim.
- `CREATE OR REPLACE FUNCTION public.approve_admin_governance_export(uuid, uuid, text)`
  — `SECURITY DEFINER`, `SET search_path = public`, `FOR UPDATE` row lock,
  emits structured codes: `APPROVER_REQUIRED`, `REQUEST_ID_REQUIRED`,
  `REQUEST_NOT_FOUND`, `NOT_ADMIN_EXPORT`, `NOT_GOVERNANCE_RECORD_REQUEST`,
  `REQUEST_NOT_PENDING`, `SELF_APPROVAL_BLOCKED`. Only forward write is
  `status = 'approved'`. Approval blob records `approver_user_id`,
  `approved_at`, `approval_note`, `previous_status`, `new_status`.
- `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated` + `GRANT EXECUTE … TO service_role`.

Live DB introspection confirms:

| Role | `EXECUTE approve_admin_governance_export` |
|---|---|
| `postgres` (owner) | t |
| `service_role` | t |
| `authenticated` | f |
| `anon` | f |

## Backend path

- Edge function `admin-governance-export-approve` (deployed).
- Order: Bearer → `auth.getUser` → `is_admin` (`NOT_PLATFORM_ADMIN`/403) →
  `assertAal2` (`MFA_REQUIRED`/403) → strict Zod body
  (`request_id` UUID, `approval_note` ≤500) → `rpc("approve_admin_governance_export")`
  → structured RPC-error → stable code mapping.
- Read-only `select` of `verification`/`target_org_id` after the RPC for audit
  enrichment — no mutation.

## UI component / route

- Mounted in `GovernanceRecordDetail.tsx` (same page as the Batch 2 request
  panel), guarded by `isPlatformAdmin && anchor.matchId`.
- Lists only `kind='admin_export'` + `status='awaiting_approval'` +
  `governance_record_id = currentMatchId` (≤50 rows). Per-row Approve action
  invokes the edge function.
- Persistent badges on every row: **"No file generated · No download link"**.
- No prepare/download/destroy/signed-URL/Blob/anchor-download/"ready to
  download" rendering anywhere.

## Approval transition proof

- Only forward write in the migration: `SET status = 'approved'`.
- Tests assert the absence of every other forward write
  (`ready_for_download`, `downloaded`, `destroyed`,
  `export_preparation_required`).
- RPC return payload pins `previous_status` + `new_status='approved'` for
  audit consumption.

## Role visibility matrix

| Viewer | Sees approval panel? | Can approve via API? |
|---|---|---|
| platform_admin (AAL2) on a Governance Record with `anchor.matchId` | Yes | Yes (non-self) |
| platform_admin (AAL2) who is the requester of the row | Yes (Approve button **disabled**, "Self-approval blocked" badge) | No — DB + RPC + edge return `SELF_APPROVAL_BLOCKED` |
| platform_admin without `matchId` anchor | No (mount gate) | n/a |
| Org admin, compliance, legal, director, auditor, broker, buyer, supplier, demo/test | No (`return null` + mount gate) | No — `NOT_PLATFORM_ADMIN` |
| Unauthenticated | No | `401 unauthorized` |

## AAL1 vs AAL2 matrix

| Auth | Result |
|---|---|
| AAL1 | `403 MFA_REQUIRED` + `data.admin_export_blocked_or_declined` audit (`reason="mfa_required"`). |
| AAL2 | `200` + `data.admin_export_approved` audit. |

## Self-approval behaviour

Enforced at **three layers**:

1. **DB trigger** `trg_export_requests_self_approval` (pre-existing) raises
   `SELF_APPROVAL_NOT_ALLOWED` if `approval.approver_user_id =
   requester_user_id`.
2. **RPC** raises `SELF_APPROVAL_BLOCKED` *before* the trigger fires (cleaner
   surface error).
3. **Edge** maps both to `409 SELF_APPROVAL_BLOCKED`.
4. **UI** disables the Approve button for the requester and shows the
   "Self-approval blocked — another platform admin must approve." badge.

## Audit proof

- Success: `data.admin_export_approved` (canonical
  `DATA_010_AUDIT_ACTIONS.approved`) with payload pinning
  `actor_user_id`, `approver_user_id`, `surface`, `request_id`,
  `governance_record_id`, `requested_by`, `redaction_mode`, `approval_note`,
  `legal_hold_context`, `previous_status`, `new_status`. `target_org_id` and
  `request_id` are passed positionally to `writeLifecycleAudit` so they land
  on the canonical anchor columns.
- Denial (≥4 paths): `data.admin_export_blocked_or_declined` with structured
  `reason` for `not_platform_admin`, `mfa_required`, `invalid_body`, plus the
  dynamic RPC-error code (`request_not_found`, `request_not_pending`,
  `not_governance_record_request`, `self_approval_blocked`, `not_admin_export`,
  `invalid_args`, `approval_failed`).

## Legal-hold behaviour

- Approval **does not mutate or delete** any held data — the RPC only writes
  `status` + `approval` blob on the request row itself.
- `legal_hold_context` (operator-provided at request time, stored in
  `verification.legal_hold_context`) is read read-only after the RPC and
  included in the success audit payload.
- Approval panel renders a `legal-hold context` badge on rows that carry one.
- **No** legal-hold auto-detection added in this batch (out of scope —
  carried as a documented risk for a future batch).

## Redaction mode preservation

- The RPC never reads or rewrites `redaction_mode`. Whatever was stored at
  request time persists across approval.
- The success audit and the edge response both echo the stored
  `redaction_mode` so consumers can verify continuity.

## Tests + results

```bash
node scripts/check-admin-export-controls-batch-4.mjs
# → [check-admin-export-controls-batch-4] OK — approval-only contract holds.

bunx vitest run src/tests/admin-export-controls-batch-4.test.ts
# → Test Files  1 passed (1)
# → Tests      40 passed (40)

node scripts/check-release-gate-sync.mjs
# → ✓ Batch W release-gate sync: 62 script(s) and 7 cron job(s) documented.
```

40 source-pin tests across: access matrix (5), body validation (4), RPC
error mapping (7), audit emission (5), RPC + DB contract (6), UI visibility
+ scope (8), mount contract (2), Batch 2/3 boundary preserved (3).

All tests are static / source-pin (no live JWT invocation), matching the
existing `data-010-export-aal2-universal.test.ts` pattern. **No tests were
skipped.** **No Batch 2 or Batch 3 behaviour required correction.**

## Guard / prebuild result

- `scripts/check-admin-export-controls-batch-4.mjs` wired into `prebuild`
  immediately after the Batch 3 guard.
- `check-release-gate-sync.mjs` reports `62 script(s)` documented — new
  guard registered.
- Manual guard run: PASS.

## Explicit confirmations

- **No file generation, no signed URL, no download link, no prepare path,
  no destroy path, no broad export, no "ready to download" surface was
  added.** Approve is the only verb the new edge function and panel
  expose.
- **No Batch 2 or Batch 3 surface was loosened.** Both prior guards still
  pass.
- **DATA-004 was not touched** — no cron change, no retention change, no
  cold-storage change, no legal-hold retention enforcement change. Batch 13
  fixtures remain staged for the scheduled Sunday 2026-05-31 04:10 UTC
  `cold-storage-archive-live` jobid 41 tick.

## Remaining risks

1. **Source-pin only** — no live JWT integration test (consistent with the
   wider project pattern; a future batch could add a Deno integration
   harness).
2. **Two-admin control is enforced for self-approval but does not yet
   require N-of-M / quorum semantics.** Two different platform admins are
   sufficient.
3. **Legal-hold context is descriptive, not enforcing.** Operator-provided
   at request time; approval surfaces it but does not auto-detect or block.
4. **Redaction modes still declared, not implemented.** Approval preserves
   the stored mode but no redaction engine consumes it yet.
5. **No approval revocation / decline action in this batch** — the
   `awaiting_approval` row can only be transitioned forward to `approved`.
   Decline / revoke is a future batch.
6. **Pending list pagination capped at 50** — sufficient for the
   per-Governance-Record scope but a List view batch should add proper
   pagination if cross-record listing is added.

## Recommended Batch 5

Given Batch 4 is fully green and the remaining risks are well-bounded, the
natural next step is **Approval Decline / Revoke Shell** (mirror of this
batch for `data.admin_export_blocked_or_declined` lifecycle, no file
generation) or — if export visibility across records is a higher priority —
**HQ Governance Export Request List View** (read-only listing of pending +
approved requests across Governance Records, still no download).

**Legal-Hold Context Auto-Detection** and **Redaction Contract
Implementation** remain valid alternates but neither is required before
either of the above.

**Do not add download / signed URL / prepare / destroy in Batch 5.** Those
must remain separately-approved batches.
