# Batch J4 — Legal-hold badge admin-only decision verification

Status: `BATCH_J4_LEGAL_HOLD_BADGE_ADMIN_ONLY_ALREADY_SAFE`
Scope: inspection only — no code, migration, edge, RLS, data, or notification changes.

## Client / product decision (recorded)
- Legal-hold badges/status visible to **platform / admin / legal / compliance users only**.
- No legal-hold badges exposed to normal match participants.
- No customer-facing legal-hold badge is to be introduced unless separately approved later.

## Inspection method
Case-insensitive search across `src/` for:
`legal hold`, `legal_hold`, `HoldActiveBadge`, `hold`, `deletion suspended`,
`anonymisation suspended`, `retention hold`, `litigation hold`.

Targeted re-checks against customer-facing surfaces:
- `src/components/match/` (incl. `MatchDocuments.tsx`, `ProofDocumentsList.tsx`)
- `src/components/wad/`
- `src/components/documents/`
- `src/components/evidence/`
- match detail pages / tabs.

## Findings

### Admin-facing (expected — retained)
- `src/pages/HQ.tsx` — `legal-holds` tab (platform_admin + AAL2), blurb intact:
  "Active holds block deletion/anonymisation; retention values are recorded + audited but not yet enforced by sweepers."
- `src/components/admin/AdminLegalHoldsPanel.tsx` — admin CRUD panel (gated).
- `src/pages/admin/p5-governance/components/dialogs/HoldDialog.tsx` — admin governance dialog.
- `src/components/admin/governance/AdminGovernanceExport*Panel.tsx` — admin surfaces reference hold blocking.
- `src/components/admin/OrgRetentionPanel.tsx`, `OrgRetentionHealthPanel.tsx` — admin retention/hold visibility.
- Prior C10 wording containment intact (no overstated protection claims); admin copy accurate.

### Customer / match-participant-facing (expected — none)
- `src/components/match/**` — **zero** legal-hold references.
- `src/components/wad/**`, `src/components/documents/**`, `src/components/evidence/**` — **zero** legal-hold references.
- Match detail tabs (`MatchDocuments.tsx`, `ProofDocumentsList.tsx`) — no legal-hold badge, no hold status, no "deletion suspended" / "anonymisation suspended" / "litigation hold" copy.

### Public policy surface (unchanged, general — not a per-record badge)
- `src/pages/Trust.tsx:100` — generic policy sentence: "Records under an active legal hold or dispute are preserved until the matter is resolved, after which standard retention applies."
  - This is a policy statement in the public Trust page. It does **not** disclose the existence of any specific hold on any specific record, does not render as a per-match/per-doc badge, and does not expose `scope_type`, `scope_id`, `reason`, `created_by`, or `released_by`.
  - Consistent with prior C10 containment decision — leave as-is.

### API / data exposure
- No customer-facing React Query/RPC path selects `legal_holds` rows or joins hold state into match/document/WaD projections.
- All `public.legal_holds` reads originate from admin panels (`AdminLegalHoldsPanel`, admin governance export panels), which are gated by `platform_admin` role + AAL2.
- `src/tests/legal-hold-edge-behaviour.test.ts`, `legal-hold-edge-wiring.test.ts`, `legal-hold-helper.test.ts`, `legal-hold-audit-names-guard.test.ts`, `admin-f8-legal-hold-wiring.test.ts`, `c10-ui-wording-containment.test.ts` continue to pin admin-only surfaces and wording containment.

## Result
- **Customer-facing exposure:** none found.
- **Admin-facing visibility:** intact and correctly gated.
- **Wording containment (C10):** intact.
- **Apply needed:** no. This is a no-op — the codebase already reflects the approved decision.

## Confirmation
No files edited. No migrations, edge deploys, RLS/grant/policy/schema/storage/cron changes. No legal-hold rows created/released/updated/deleted. No emails, notifications, or provider calls.

Final status: `BATCH_J4_LEGAL_HOLD_BADGE_ADMIN_ONLY_ALREADY_SAFE`
