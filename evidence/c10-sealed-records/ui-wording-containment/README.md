# C10 — Sealed Records & Legal-Hold UI Wording Containment (Safe Subset)

Status before: `C10_SEALED_RECORDS_UI_WORDING_CONTAINMENT_READY_TO_APPLY`
Status after:  `C10_SEALED_RECORDS_UI_WORDING_CONTAINMENT_SAFE_SUBSET_DEPLOYED`

Frontend-only copy changes. No backend, RLS, grant, policy, storage,
cron, edge function, cleanup worker, legal-hold logic, WaD trigger, or
data behaviour was modified. No migrations applied. No emails sent.

## Findings applied

### L-1 — HoldDialog
- File: `src/pages/admin/p5-governance/components/dialogs/HoldDialog.tsx` (L114)
- Before: `All hold actions are recorded in the immutable audit timeline.`
- After:  `All hold actions are recorded in the tamper-evident audit timeline.`
- Reason: `audit_logs` immutability is not yet backend-enforced
  (`IMMUTABILITY_BACKEND_ENFORCED = false`). "Tamper-evident" matches the
  approved `SAFE_LEDGER_COPY` carve-out and the level of guarantee
  actually shipped today.

### D-1 — ProofDocumentsList
- File: `src/components/match/ProofDocumentsList.tsx` (L157)
- Before: `Document hashes are part of the tamper-evident evidence chain.`
- After:  `Document hashes are captured at upload and included in the sealed evidence bundle.`
- Reason: `match_documents` rows have no row-level immutability trigger.
  The hash is snapshotted into the sealed WaD evidence bundle, which is
  what the new wording states — without implying the underlying row is
  immutable.

## Deferred — NOT touched

- L-5: match-scoped legal-hold badge on customer docs tab.
- R-4: `OrgRetentionHealthPanel.tsx` skip-reason rendering.
- `match_documents` row-level immutability (backend).
- `wad_attestations` pre-seal write protection (backend).
- Privileged WaD trigger proof (still parked at
  `C10_SEALED_WAD_METADATA_IMMUTABILITY_NEEDS_PRIVILEGED_TRIGGER_PROOF`).
- All C6/C7/C8/C9 pending verification items.

## Guards / tests

Added: `src/tests/c10-ui-wording-containment.test.ts`
- Asserts L-1 new wording present and old wording absent.
- Asserts D-1 new wording present and old wording absent.
- Asserts neither file contains any phrase from
  `BANNED_TRUST_PHRASES` in `src/lib/policy/audit-ledger-capability.ts`.

## Confirmation

- No migrations, RLS, grants, policies, storage policies, cron jobs,
  edge functions, cleanup workers, or legal-hold logic changed.
- No data was read or mutated.
- No provider calls, emails, or notifications dispatched.
