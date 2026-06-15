# Facilitation Phase 2 — Operator Verification Pack

**Current status:** `PHASE_2_PARTIAL — NOT CLIENT_UAT_READY`
**Last updated:** 2026-06-15

## What changed since the previous audit

The compliance_analyst route-access blocker was fixed (`src/App.tsx`, `src/pages/HQ.tsx`, `src/lib/constants.ts`). All facilitation prebuild guards re-passed.

## Why we are still PARTIAL

Two classes of issue remain open:

### 1. Client-embarrassment defects identified in the previous audit but never applied

| ID | Defect | File evidence |
|---|---|---|
| EMB-1 | Catch blocks throw raw `err.message` so the UI shows "Edge Function returned a non-2xx status code" instead of the structured server error. `parseEdgeError` exists in `src/lib/edge-error.ts` but is not imported by any facilitation component. | `rg 'parseEdgeError' src/components/facilitation-outreach/` → 0 matches |
| EMB-2 | Gate codes (`dnc_org_name_warning`, `blocked`, `suppressed_email`, …) render verbatim in badges and ack checkboxes. No label map is applied. | `src/components/facilitation-outreach/FacilitationOutreachTab.tsx:91-97, 358-368` |

Smallest safe fix for both is described in `summary.json → remaining_blockers`.

### 2. Live multi-role click-through cannot be performed by the agent

The agent does not have separate `compliance_analyst` or requester credentials in this environment. Code-level RBAC, RLS, and component-gating are all verified, but the operator must still drive a live click-through with screenshots before client UAT.

Items still requiring live operator verification are listed in `summary.json → platform_admin_journey`, `compliance_analyst_journey`, and `requester_milestone_privacy` (every `OPERATOR-VERIFY-REQUIRED` entry).

## Files in this pack

- `summary.json` — machine-readable result of the re-audit.
- `platform-admin-checklist.md` — manual click-through script for the platform_admin role.
- `compliance-analyst-checklist.md` — manual click-through script for the compliance_analyst role.
- `screenshot-checklist.md` — list of screenshots required for the evidence pack.
- `screenshots/` — empty until the operator captures the live runs.

## Path to PHASE_2_CLIENT_UAT_READY

1. Apply EMB-1 and EMB-2 fixes.
2. Operator runs both role checklists live, captures screenshots.
3. Re-run prebuild.
4. Update `summary.json` status to `PHASE_2_CLIENT_UAT_READY`.
