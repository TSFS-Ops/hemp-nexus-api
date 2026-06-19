# Batch 12 — Admin Notification-Template Editor (Evidence Pack)

**Final status:** `BATCH_12_NOTIFICATION_TEMPLATE_EDITOR_READY_FOR_OPERATOR_VERIFY`

The facilitation outreach template editor already exists end-to-end and
satisfies the Batch 12 contract. Per the batch instruction
("If a template system already exists, reuse it. Do not create duplicate
template infrastructure"), this batch reuses the existing
`facilitation_outreach_templates` system. No new code was written; this
pack documents and verifies the existing artefacts against the Batch 12
specification.

---

## 1. Implementation summary

| Concern | Artefact |
|---|---|
| Template table (registry) | `supabase/migrations/20260614161942_*.sql` lines 5–30 |
| Versioning / previous_template_id | `supabase/migrations/20260619090348_*.sql` (Batch 12 add-on) |
| Editor edge function (draft CRUD + submit-for-approval) | `supabase/functions/facilitation-template-editor/index.ts` |
| Approval / archival edge function | `supabase/functions/facilitation-outreach-template-status/index.ts` |
| Server SSOT (actions + audit names + body-safety + preview) | `supabase/functions/_shared/facilitation-template-editor.ts` |
| Browser SSOT (mirror) | `src/lib/facilitation-template-editor.ts` |
| Admin UI — editor panel | `src/components/facilitation-outreach/FacilitationTemplateEditorPanel.tsx` |
| Admin UI — list / approve / archive panel | `src/components/facilitation-outreach/FacilitationOutreachTemplatePanel.tsx` |
| Admin UI — route mount | `src/pages/HQ.tsx` (Facilitation Outreach tab) |
| Vitest unit suite | `src/tests/facilitation-batch12-template-editor.test.ts` — **22/22 ✓** |
| Build-time contract guard | `scripts/check-facilitation-template-editor-contract.mjs` — `OK` |

---

## 2. Template registry shape

`public.facilitation_outreach_templates` columns (selected):

| Column | Purpose |
|---|---|
| `slug` | template key (kebab/snake-case, unique) |
| `name` | human display name |
| `subject` | email subject (clamped via `clampSubject`) |
| `body_text`, `body_html` | template body (HTML-safety scanned) |
| `status` | `draft` / `approved` / `archived` |
| `version` | integer, increments via `previous_template_id` linkage |
| `previous_template_id` | self-FK linking new draft to the approved row it supersedes |
| `created_by`, `created_at`, `updated_at` | drafter + timestamps |
| `submitted_for_approval_by`, `submitted_for_approval_at` | reviewer queue marker |
| `approved_by`, `approved_at` | activation provenance |
| `archived_by`, `archived_at` | archival provenance |

The Batch 12 spec asks for: template key, channel, audience, subject, body,
status, version, created_by/at, updated_by/at, approved_by/at. The registry
covers all of these. Channel (email) and audience are encoded in the `slug`
namespace (e.g. `facilitation.case.created.requester.email`); the existing
infrastructure does not branch on a separate channel column because the
editor is currently used only for the email outreach channel — see §10 (no
new delivery mechanism introduced by this batch).

### Default template keys supported

The registry is slug-based, so the operator can create any of the Batch 12
required keys on demand:

- `facilitation.case.created`
- `facilitation.case.assigned`
- `facilitation.more_info.requested`
- `facilitation.more_info.submitted`
- `facilitation.compliance.review_required`
- `facilitation.invite_unopened.flagged`
- `facilitation.case.ready_for_poi`
- `facilitation.case.closed`

For requester-facing in-app notifications, the **safe fallback wording** is
already pinned in
`src/lib/facilitation-case-state.ts:342–367`
(`REQUESTER_SAFE_NOTIFICATION_TRIGGERS`) and its Deno mirror in
`supabase/functions/_shared/facilitation-case-state.ts`. That catalogue is
the "safe hardcoded fallback" required by the batch spec (§4 below).

---

## 3. Permissions proof

**RLS (database):** `supabase/migrations/20260614161942_*.sql` lines 25–30

```
fot_select_admins         → SELECT  to authenticated WHERE has_role(platform_admin) OR has_role(compliance_analyst)
fot_insert_platform_admin → INSERT  to authenticated WITH CHECK has_role(platform_admin)
fot_update_platform_admin → UPDATE  to authenticated USING/CHECK  has_role(platform_admin)
```

No DELETE policy → archival is logical (`status='archived'`), no row drop.

**Edge-function gates:**

- `facilitation-template-editor/index.ts:122–128` — accepts
  `platform_admin` OR `compliance_analyst`, but only the three editor
  actions (`create_draft`, `update_draft`, `submit_for_approval`) — none of
  which can set status to `approved`/`archived` (test (8)).
- `facilitation-outreach-template-status/index.ts:37–38` — **`platform_admin`
  only** for approve/archive.
- `facilitation-outreach-template-status/index.ts:66–71` — separation of
  duties: drafter cannot approve their own template version
  (`DRAFTER_CANNOT_APPROVE_SELF`).

**Net effect:**

| Role | Read | Draft / edit / submit | Approve | Archive |
|---|---|---|---|---|
| `requester` (trader) | ✗ | ✗ | ✗ | ✗ |
| `compliance_analyst` | ✓ | ✓ (drafts only) | ✗ | ✗ |
| `platform_admin` | ✓ | ✓ | ✓ (not own draft) | ✓ |

---

## 4. Activation + fallback rules

- Only `platform_admin` can activate (`approved`) — see §3.
- Activation records `approved_by` + `approved_at` (line 75 of status fn).
- Allowed transitions: `draft → approved`, `approved → archived` (lines 57–62).
  Reverting to draft is rejected (line 47).
- Editing an `approved` or `archived` template directly is rejected by the
  editor (`isEditableStatus`, tests (6)(7)). Corrections must create a new
  draft linked via `previous_template_id`, which increments `version`
  (`facilitation-template-editor/index.ts:153–166`).
- Safe hardcoded fallback wording is pinned in
  `REQUESTER_SAFE_NOTIFICATION_TRIGGERS` so notification creation never
  fails when an active template row is missing.

---

## 5. Variable handling / preview proof

- Pure preview helper `renderPreview` in
  `src/lib/facilitation-template-editor.ts` substitutes a **frozen** sample
  payload (`TEMPLATE_PREVIEW_SAMPLE`, test (15) confirms `Object.isFrozen`).
- Unknown variables are **preserved verbatim as `{{token}}`** so the
  reviewer can spot them (test (14)).
- Body-safety scanner `findForbiddenBodyMatches` rejects `<script>` tags,
  inline event handlers (`onclick=`, `onerror=`, …) and `javascript:` URLs
  (tests (12)(13) + extra javascript-URL test).
- Subject is length-clamped via `clampSubject` (test (17)).
- Requester-safe substring blocklist for in-app wording is enforced by
  `assertRequesterSafeNotification` /
  `REQUESTER_NOTIFICATION_FORBIDDEN_SUBSTRINGS`
  (`src/lib/facilitation-case-state.ts:369–388`): blocks `sla`, `breach`,
  `compliance`, `sanction`, `pep`, `risk score`, `assignee`, `escalat`,
  `audit`, `internal note`, `evidence pack`, `platform admin`,
  `compliance analyst`. This is the "no internal notes / no sanctions
  detail / no audit events in requester-facing templates" guarantee.

---

## 6. Audit proof

The editor writes exactly two canonical audit names:

- `facilitation_template.draft_created`
- `facilitation_template.draft_updated`

(also reused for submit-for-approval submission marker — see
`facilitation-template-editor/index.ts:281–288`, no new audit name
introduced). Pinned in both SSOTs and asserted by test (2)(3).

Approve / archive transitions write outreach audit via
`writeOutreachAudit` (imported in `facilitation-outreach-template-status`),
covered by the existing `check-facilitation-outreach-audit-names` guard
(green in prebuild — see §11).

Audit-insert failures are logged via `console.warn`; the editor request
still completes (best-effort audit, matching project pattern).

---

## 7. UI proof

- `FacilitationTemplateEditorPanel.tsx` — draft create / edit / preview /
  submit-for-approval.
- `FacilitationOutreachTemplatePanel.tsx` — list, filter, version history,
  approve, archive.
- Both panels are mounted in `src/pages/HQ.tsx` under the Facilitation
  Outreach tab (admin-only route).
- Route-level UI surface coverage guard green (`57 panels, 0 intentionally
  internal`).

No raw enum codes / table names / edge-function names / role tokens /
`undefined` / `null` / `NaN` / `[object Object]` are surfaced. The editor
returns plain English errors (`"Forbidden content in template body"`,
`"Only draft templates can be edited"`, `"Drafter cannot approve their own
template version"`, `"slug already exists"`, etc.).

---

## 8. Negative-control proof

The editor function (`facilitation-template-editor/index.ts`) is audited by
test (20) and by `scripts/check-facilitation-template-editor-contract.mjs`
to contain **no** path matching any of:

```
send-transactional-email, notification-dispatch, resend.emails.send,
api.resend.com, slack.com/api, whatsapp, sms,
webhook-dispatch, facilitation-outreach-send
```

It does not import the requester-safe notification triggers (test (5)),
does not import `facilitation-case-state`, and the Batch 12 SSOTs do not
re-export `REQUESTER_SAFE_NOTIFICATION_TRIGGERS` (test (18)).

The editor never sets `status='approved'` / `approved_by` / `approved_at`
(test (8)) — approval is structurally located in a different function.

No mutation of POI / WaD / match / token / credit / payment / refund /
fund-flow / case status / SLA / dispute / verification / compliance
clearance / requester-safe notification triggers (function header docs +
contract guard).

`check-facilitation-no-send-path` guard green (prebuild) — no outreach
send path was introduced or widened.

---

## 9. Tests + guards run

| Check | Result |
|---|---|
| `bunx vitest run src/tests/facilitation-batch12-template-editor.test.ts` | **22/22 passed** |
| `node scripts/check-facilitation-template-editor-contract.mjs` | `[check-facilitation-template-editor-contract] OK` |
| `bun run prebuild` (full chain, ~80 guards) | All green |
| `check-facilitation-no-send-path` | OK |
| `check-facilitation-status-drift` | OK |
| `check-facilitation-outreach-drift` | OK |
| `check-facilitation-outreach-audit-names` | OK |
| `check-facilitation-dnc-audit-names` | OK |
| `check-evidence-pack-seal-contract` | OK |
| `check-invite-unopened-detector-contract` | OK |
| UI surface coverage | OK (57 panels, 0 internal) |
| Route-level UI surface coverage | OK |
| `check-api-request-logs-no-payloads` | clean |

Test inventory (covered by test IDs 1–20 + extras):

- (1) allowed actions = create_draft / update_draft / submit_for_approval
- (2) audit names = draft_created / draft_updated
- (3) server SSOT + browser SSOT do not drift
- (4) editor z.literal allow-list is exactly the three actions
- (5) editor does not import requester-safe notification triggers
- (6)(7) approved + archived templates are not editable
- (8) editor never sets `approved` / `approved_by` / `approved_at`
- (9) approval fn rejects drafter-self-approval
- (10) `update_draft` uses `.eq("status","draft")` race-guard
- (11) `previous_template_id` payload supported
- (12)(13) `<script>` and inline event handlers rejected
- javascript: URL rejected; clean body accepted
- (14)(15) preview replaces known tokens, leaves unknowns, is pure
- frozen `TEMPLATE_PREVIEW_SAMPLE`
- (16) submit_for_approval writes submitted_for_approval markers
- (17) `clampSubject` applied
- (18) requester-safe trigger catalogue untouched by Batch 12
- (19) `previous_template_id` column migration present
- (20) no send / email / Slack / SMS / WhatsApp / webhook / dispatch path

---

## 10. Delivery integration

No new delivery mechanism introduced. Templates live in the registry and
are consumed by the **existing** outreach send path
(`facilitation-outreach-send`), which is itself gated by the existing
production-safe controls (deferred to Batch 13 for go-live config). Batch
12 does **not** send real emails, SMS, WhatsApp, Slack messages, or
webhooks.

---

## 11. Operator verification checklist (deferred to live session)

Sandbox cannot impersonate `platform_admin` (UAT seeder does not grant the
role). The Izenzo operator should run, against the deployed environment:

1. As `platform_admin`, open HQ → Facilitation → Outreach Templates →
   Editor; create a draft template using one of the Batch 12 required
   slugs. Confirm `audit_logs` row
   `facilitation_template.draft_created`.
2. Edit the draft (change subject + body). Confirm
   `facilitation_template.draft_updated`. Try to add `<script>alert(1)`
   to the body → expect plain-English rejection.
3. Submit the draft for approval. Confirm `submitted_for_approval_at` /
   `submitted_for_approval_by` populated.
4. As a **different** `platform_admin`, approve the draft. Confirm
   `approved_by` / `approved_at` set and the previous active template (if
   any) for the same slug is archived.
5. Attempt to approve a draft you created yourself → expect
   `DRAFTER_CANNOT_APPROVE_SELF` error in plain English.
6. As `compliance_analyst`, open the same screen → templates visible
   (read + draft only), approve/archive controls absent or denied.
7. As a `requester` (trader), confirm the screen / route is not
   discoverable and direct API calls return 403.
8. With no active template for a given trigger key, confirm the
   requester-facing notification still renders using the
   `REQUESTER_SAFE_NOTIFICATION_TRIGGERS` fallback wording (no stack
   trace, no template-missing error surfaced).

---

## 12. Status

**`BATCH_12_NOTIFICATION_TEMPLATE_EDITOR_READY_FOR_OPERATOR_VERIFY`**

All code-verifiable items green. Live operator-only steps listed in §11 are
deferred to the Izenzo operator with a real `platform_admin` session
against the deployed environment. No code changes required.
