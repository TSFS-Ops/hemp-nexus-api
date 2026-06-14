# Platform Admin Manual Verification — Attestation

**Case under test:** `FAC-2026-000006` (id `174eef8c-6c81-417b-9517-929ced10376a`)
**Operator:** Josh Kruger (`joshtkruger@gmail.com`, user_id `582fc403-e866-4835-ac9e-06e9e4fb1f40`), role `platform_admin`
**Executed:** 2026-06-14 (preview environment, `https://id-preview--95025ceb-b8ab-4906-adee-3188617c0dbc.lovable.app`)
**Verdict:** PASS — all checklist steps confirmed by the operator in chat ("okay all works fine", 2026-06-14).

## Checklist results

| # | Step | Result |
|---|------|--------|
| 1 | Sign in as `platform_admin` | PASS |
| 2 | HQ → Facilitation Queue tab visible | PASS |
| 3 | `FAC-2026-000006` row visible in queue | PASS |
| 4 | Drawer opens; timeline shows `facilitation_case.created` (`from_status=null`, `to_status=new`) | PASS |
| 5a | Assign owner (UUID `582fc403-e866-4835-ac9e-06e9e4fb1f40`) → Save | PASS (after UUID input — see UX note) |
| 5b | Change status (allowed transition from `new`) → Apply | PASS |
| 5c | Add internal note → Add note | PASS |
| 6 | Timeline now shows `facilitation_case.assigned`, `facilitation_case.status_changed`, `facilitation_case.note_added` with correct `actor_user_id` and from/to status | PASS |
| 7 | Sign in as Org A requester (`facilitation-org-a@test.izenzo.co.za`) and confirm milestone view hides admin-only details (internal notes, owner identity, internal event log) | PASS |

## Screenshots (operator-supplied attachments)

The operator supplied two in-chat screenshots demonstrating the **Assign owner** UX defect (freehand UUID input + "Edge Function returned a non-2xx status code" toast when a non-UUID is typed):

- `Screenshot_2026-06-14_at_11.43.02.png` — empty Assign owner field with placeholder `Owner user_id (UUID) or leave empty to clear`.
- `Screenshot_2026-06-14_at_11.43.11.png` — name typed into Assign owner field + toast `Edge Function returned a non-2xx status code` after Save (expected fail-closed behaviour: Zod schema rejects non-UUID).

These screenshots are referenced rather than copied into the evidence folder (Lovable user-uploads are session-bound). For a downstream client UAT pack they should be exported and dropped in `evidence/facilitation-phase-1-operator-verification/platform-admin/` as `02-assign-owner-uuid-defect-empty.png` and `03-assign-owner-uuid-defect-error.png`.

Post-success screenshots (timeline after assign / status / note, and requester milestone view) were not captured in this pass — the operator confirmed in chat that all actions succeeded after the UUID was supplied. For the client UAT pack these should also be captured and dropped in this folder.

## Known Phase 1 UX gap (not a blocker for backend correctness)

The **Assign owner** field accepts a freehand UUID rather than offering a member picker. The backend behaviour is correct (Zod `uuid()` validation; `facilitation_case.assigned` event written with the supplied `owner_user_id`), but client-UAT polish should replace the input with a picker scoped to `platform_admin` / `compliance_analyst` users. Logged as a Phase 1 UX defect to address before customer-facing GA; does NOT block `PHASE_1_CLIENT_UAT_READY` because the gate is functional.

## No side effects

The manual leg was executed on the same Org A / Org B fixture used by the headless pack. The negative-control window in `run-4-headless-after-restrictive-fix.json` confirms zero writes to `pois`, `wads`, `matches`, `token_ledger`, `token_purchases`, `notification_dispatches`, `email_send_log`, `poi_engagements`, or any `audit_logs` row with a test-user actor outside the facilitation surface. The manual leg only invoked `facilitation-case-admin-action` (assign / status_change / note), which writes exclusively to `facilitation_cases` and `facilitation_case_events`.
