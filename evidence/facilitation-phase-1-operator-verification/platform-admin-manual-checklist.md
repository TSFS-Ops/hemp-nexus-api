# Platform Admin Manual Verification Checklist — Facilitation Phase 1

To be executed in the preview by an authorised `platform_admin` operator.
Until this checklist is completed and screenshots attached, the verdict
remains **PHASE_1_PARTIAL — NOT CLIENT_UAT_READY**.

Test fixture from the headless pack (case is closed but still visible to admins):

- Case ID: `1c2ca2f0-88ca-46a4-b0b7-7df6e7690c5b`
- Case number: `FAC-2026-000003`
- Requesting org (Org A): `06f34183-1807-49a0-910e-a13e6fef6bd6`

## Steps

1. Sign in to the preview as a `platform_admin`.
2. Navigate to **HQ → Facilitation Queue**. Confirm the tab is visible.
   - Screenshot → `01-hq-tab-visible.png`
3. Confirm `FAC-2026-000003` appears in the queue (filter: status = `closed_admin` if needed since the headless pack closed it; or run the headless pack again immediately before to seed a fresh `new` case).
   - Screenshot → `02-queue-row-visible.png`
4. Open the case drawer. Confirm the timeline shows the `facilitation_case.created` event.
   - Screenshot → `03-drawer-timeline.png`
5. Use the admin actions to:
   - Assign owner to yourself.
   - Change status to `under_review` (or another allowed transition from the current status).
   - Add an internal note.
   - Screenshot after each action → `04-assign.png`, `05-status-change.png`, `06-note.png`
6. Refresh the drawer. Confirm all three new events appear in the timeline with correct `actor_user_id`, `from_status`, `to_status`.
   - Screenshot → `07-timeline-after-actions.png`
7. Open the requester milestone view as the requesting user (`facilitation-org-a@test.izenzo.co.za`, password from the harness env) and confirm admin-only details (internal notes, owner identity) are hidden.
   - Screenshot → `08-requester-milestone.png`

## What to capture

Drop all screenshots into:

```
evidence/facilitation-phase-1-operator-verification/platform-admin/
```

…and add a one-line note under each step describing what was observed. When complete, update `summary.json` `verdict` to `PHASE_1_CLIENT_UAT_READY` only if **and only if** the residual `orgA.storage_upload` defect has also been fixed (see README.md → Remaining failure) and re-verified.

## Do NOT during this pass

- Do not approve/escalate via any send path (none exists in Phase 1).
- Do not click anything that mutates POI / WaD / match / token / credit / payment state.
- Do not modify role-governance, RBAC, RLS, or admin-assignment logic.
