# P-5 Batch 1 — Governance, Compliance & Readiness

## Stage 1 — Foundation schema + reason-code SSOT (COMPLETE & SIGNED OFF)

Status: **STAGE_1_FOUNDATION_RUNTIME_CONFIRMED**

### Scope landed

- Extended `public.app_role` with the seven new P-5 roles: `executive_approver`,
  `governance_reviewer`, `operator_case_manager`, `developer_technical_admin`,
  `customer_entity_owner`, `funder_external_reviewer`, `auditor_read_only`.
  No existing role values changed.
- Added five P-5 enums (`p5_status`, `p5_provider_status`, `p5_rule_severity`,
  `p5_actor_type`, `p5_reason_code`).
- Created three tables under `public`: `p5_governance_readiness_cases`,
  `p5_governance_evidence_items`, `p5_governance_audit_events`.
- Append-only audit triggers `p5_audit_no_update` / `p5_audit_no_delete`.
- RLS + GRANTs scoped to privileged roles, org members, and `service_role`.
- Helper `public.p5_has_any_role(uuid, text[])` is `SECURITY DEFINER`,
  `EXECUTE` revoked from `PUBLIC`/`anon`.
- TS SSOT at `src/lib/p5-governance/constants.ts`; drift guard
  `src/tests/p5-batch1-enum-drift.test.ts` (6/6 green).

## Stage 2 — Deterministic readiness engine + transition guard + wording guard (COMPLETE)

Status: **STAGE_2_READINESS_ENGINE_AND_GUARDS_DEPLOYED**

### Files added

- `src/lib/p5-governance/readiness.ts` — pure deterministic
  `calculateReadiness()` engine.
- `src/lib/p5-governance/transitions.ts` — `assertTransition()` plus the
  allowed-transition table.
- `src/lib/p5-governance/wording-guard.ts` — `assertCustomerSafeWording()` /
  `isCustomerSafeWording()` / `findForbiddenWording()`.
- `src/tests/p5-batch1-readiness.test.ts` (22 cases).
- `src/tests/p5-batch1-transitions.test.ts` (14 cases).
- `src/tests/p5-batch1-wording-guard.test.ts` (12 cases).

### Test command + result

```
bunx vitest run \
  src/tests/p5-batch1-readiness.test.ts \
  src/tests/p5-batch1-transitions.test.ts \
  src/tests/p5-batch1-wording-guard.test.ts
```

Result: **3 files passed · 48/48 tests passed** (Vitest 4.0.18).

The Stage 1 drift guard (`src/tests/p5-batch1-enum-drift.test.ts`, 6/6)
remains green and is not affected by Stage 2.

### Readiness logic summary

`calculateReadiness(input)` implements the client-approved
"worst-outstanding-issue" rule. Order of evaluation (first match wins):

1. Hard blocker flag → `blocked`.
2. Payment/audit anomaly → `blocked / audit_trail_issue`.
3. Rejected mandatory evidence → `blocked / rejected_by_reviewer`.
4. Failed high-risk provider result → `blocked / sanctions_pep_adverse_result_review`.
5. Unreleased compliance/governance hold → `on_hold` with the matching
   `*_hold_applied` reason.
6. Overdue SLA, disputed decision, or unresolved high risk → `escalated`.
7. Reviewer-requested correction → `more_information_required`.
8. Required evidence missing/submitted/expired → `incomplete` / `submitted`.
9. Internal review not yet complete → `under_review`.
10. Provider result conflict → `escalated / provider_result_conflict`.
11. Required provider `failed` (non-high-risk) → `blocked / provider_failed`.
12. Required provider `not_live` / `credentials_pending` / `timeout` /
    `inconclusive` / `pending` → `provider_dependent` with the matching
    `provider_*` reason.
13. Warnings or approved waivers/overrides remaining → `conditional_ready`.
14. All internal + provider checks satisfied, but no human approval →
    `internally_ready`.
15. All of the above clear + human approval recorded → `ready_to_proceed`.

`checklist` counts (`required_total/satisfied`, `optional_total/satisfied`,
`providers_required/satisfied`) are returned for visibility only and the test
suite asserts that they never override a worse status (`blocked` despite
2/2 required satisfied).

### Transition guard summary

`assertTransition({ from, to, action, actor, reasonCode?, note? })` walks an
explicit allowed-transition table and throws `P5TransitionError` on any
violation. Coverage includes:

- intake (`incomplete → submitted → under_review`),
- review feedback (`under_review ↔ more_information_required ↔ submitted`),
- internal approval (`under_review → internally_ready`, reviewer-gated),
- provider dependency (`internally_ready ↔ provider_dependent`, system
  recompute back to internally_ready),
- ready paths (`internally_ready → ready_to_proceed | conditional_ready`,
  admin-gated; `conditional_ready → ready_to_proceed`),
- holds / escalations (`apply_hold`, `release_hold`, `escalate`,
  admin-gated release from `blocked`/`escalated`),
- terminal-ish (`under_review → rejected`, `rejected → reopened` (admin),
  `ready_to_proceed → reopened` (admin)),
- waivers / overrides (`internally_ready → waived`, `blocked|on_hold →
  override_approved`, admin-gated),
- archiving (`ready_to_proceed → archived_superseded`).

Reason code AND a non-empty note are required for: `reject`, `apply_hold`,
`release_hold`, `waive`, `override`, `escalate`,
`request_more_information`. Missing reason/note throws.

### Wording guard summary

`assertCustomerSafeWording(text, options?)` uses the Stage 1 SSOT lists.

- Default surface is `customer`. `funder` and `public_api` are equally strict.
- `admin_internal` bypasses the guard.
- Case-insensitive substring matching against
  `P5_FORBIDDEN_WORDS` (e.g. `Verified`, `Bankable`, `Guaranteed`,
  `KYC Complete`, `Sanctions Cleared`, `Payment confirmed`,
  `Without a Doubt`).
- Finality / payment / WaD wording (`Final settlement`, `Payment confirmed`,
  `Refund complete`, `Without a Doubt`, `WaD finality`, `Guaranteed`,
  `Guaranteed Bankable`, `Risk-free`, `No risk`, `Audit-proof`) is forbidden
  on every external surface **regardless of supporting conditions**.
- All other forbidden phrases may only appear on external surfaces when the
  caller passes ALL three supporting conditions
  (`approved_evidence_pack`, `provider_result_received`,
  `human_approval_recorded`). Partial conditions still throw.
- Allowed wording (`P5_ALLOWED_WORDS`, e.g. `Internally Ready`,
  `Ready to Proceed`, `Provider-Dependent`, `Conditional Ready`,
  `Under Review`, `More Information Required`) is asserted clean across all
  three external surfaces.

### Constraints honoured in Stage 2

- **No UI added.** Stage 2 ships only pure library code + tests; no React
  components, pages, routes, hooks, or styling were changed.
- **No DB migration**, no policy/grant change, no edge function deploy.
- **No mutation of trade, POI, WaD, billing, payment, business-decision or
  registry rows**: Stage 2 source files only touch `src/lib/p5-governance/*`
  and `src/tests/p5-batch1-*`.
- Library functions are pure: same input → same output, no I/O, no `Date.now`
  side effects (expiry comparisons accept an injectable `now`).

### Pending

Stage 3 (Security Definer RPCs that persist case rows + insert audit rows in
a single transaction) does not begin until Stage 2 is signed off.


## Stage 3 — Action RPCs, SQL readiness mirror, edge function (COMPLETE)

Status: **STAGE_3_ACTION_RPCS_AND_API_DEPLOYED**

### Migration

`p5_batch1_action_rpcs` (plus two hotfixes: `qualify column in readiness
mirror` and `align submitted-evidence handling with Stage 2`, and one
behaviour fix: `do not recompute on create`). All three follow the same
`SECURITY DEFINER` + `SET search_path = public` + `REVOKE FROM PUBLIC` /
`GRANT TO authenticated, service_role` posture as Stage 1.

### Files added / changed

- `supabase/migrations/*_p5_batch1_action_rpcs*.sql` (migration + hotfixes)
- `supabase/functions/p5-governance-readiness-summary/index.ts` (new edge
  function, JWT validated in code)
- `supabase/tests/p5_batch1_action_rpcs_proof.sql` (SQL proof)
- `src/tests/p5-batch1-api-scoping.test.ts` (TS API scoping proof)
- `evidence/p5-batch1-governance-readiness/README.md` (this update)

### RPCs added (19)

`p5_create_case`, `p5_submit_case`, `p5_start_review`, `p5_request_more_info`,
`p5_approve_internally`, `p5_mark_provider_dependent`,
`p5_record_provider_result`, `p5_approve_ready_to_proceed`, `p5_apply_hold`,
`p5_release_hold`, `p5_reject`, `p5_escalate`, `p5_waive`, `p5_override`,
`p5_reopen`, `p5_archive_superseded`, `p5_assign_owner`,
`p5_upload_evidence_meta`, `p5_review_evidence`.

Helpers: `public._p5_audit`, `public._p5_require_reason`,
`public._p5_require_role`, `public.p5_calculate_readiness`,
`public._p5_recompute_case`. All `SECURITY DEFINER`, `EXECUTE` revoked from
`PUBLIC`/`anon`; internal helpers are not granted to `authenticated`.

Every RPC writes exactly one `p5_governance_audit_events` row via the
shared `_p5_audit` helper inside the same transaction as the case/evidence
mutation. The Stage 1 `p5_audit_no_update` / `p5_audit_no_delete` triggers
remain in force, so the audit trail is append-only.

### Edge function

`p5-governance-readiness-summary` (GET, `verify_jwt` validated in code via
`supabase.auth.getClaims`). Returns the approved API shape:

```
request_id, correlation_id, entity_id, project_id, transaction_id,
readiness_status, governance_status, compliance_status, evidence_status,
reason_codes, blocker_count, warning_count, provider_dependency,
provider_dependency_type, provider_status, provider_last_checked_at,
next_action, next_owner_type, required_items_missing, last_updated_at,
status_changed_at, audit_reference, decision_reference,
evidence_pack_id, evidence_summary_id, version_hash_chain_reference
```

Privileged callers (`platform_admin`, `executive_approver`,
`governance_reviewer`, `compliance_analyst`, `operator_case_manager`,
`developer_technical_admin`, `auditor_read_only`) additionally see
`organization_id` and `is_on_hold`. No caller — admin or otherwise — ever
sees raw provider payloads, provider credentials/secrets, internal
reviewer notes, legal comments, internal risk scores, AI reasoning,
draft / unapproved evidence packs. All textual labels (`next_action`)
pass through the Stage 2 wording guard before being returned, and the
provider-dependent variants explicitly avoid `Verified` / `Cleared` /
`Compliant` / `Bankable` / `Guaranteed` / finality wording.

### Test commands and results

SQL proof:

```
psql -v ON_ERROR_STOP=1 -f supabase/tests/p5_batch1_action_rpcs_proof.sql
```

Result: `BEGIN ... NOTICE: P5_STAGE3_PROOF_OK ... ROLLBACK`. The single
DO-block proves, end-to-end:

- unauthorised callers are denied (`p5_create_case`, `p5_release_hold`)
- authorised callers can act and every material action writes an audit row
- reason code AND non-empty note are required where mandated
  (`p5_request_more_info`, `p5_apply_hold` with NULL reason, `p5_apply_hold`
  with empty note all reject)
- illegal transitions are rejected (`p5_submit_case` from `submitted`)
- evidence rejection flips readiness to `blocked`
- `p5_approve_ready_to_proceed` is rejected while a blocker exists, and
  again while an outstanding provider dependency exists
- a high-risk provider result returns the case to `under_review` and clears
  any prior human approval (no auto-finalisation)
- `release_hold` is denied to an unprivileged caller (never automatic)
- `p5_governance_audit_events` rejects both `UPDATE` and `DELETE`
  (Stage 1 immutability triggers still active)

TS / API scoping:

```
bunx vitest run src/tests/p5-batch1-api-scoping.test.ts
```

Result: **1 file passed · 6/6 tests passed** (Vitest 4.0.18). Asserts:

- non-admin response omits `organization_id`, `is_on_hold`, and every
  forbidden field (raw provider payload, credentials, internal reviewer
  notes, legal comments, internal risk scores, AI reasoning, draft /
  unapproved evidence packs)
- admin response is strictly richer (`organization_id`, `is_on_hold`) but
  still excludes every forbidden field
- provider-dependent `next_action` never contains forbidden wording
  (Verified / Cleared / Compliant / Bankable / Guaranteed / finality)
- every external-surface label passes the Stage 2 wording guard for
  `customer`, `funder`, and `public_api`
- forbidden wording is rejected in unsafe contexts
- the response key set matches the approved shape exactly (no extra fields,
  no missing fields)

The Stage 1 drift guard and Stage 2 readiness/transition/wording-guard
tests remain green and are unaffected.

### Constraints honoured in Stage 3

- Every RPC writes an immutable audit row in the same transaction as the
  case / evidence mutation.
- Audit table remains append-only (Stage 1 triggers re-asserted by SQL
  proof).
- No `UPDATE`/`DELETE` is issued against `trade_requests`, `pois`, `wads`,
  `token_*` / `payment_*` / `business_decisions` or any other existing
  business-data table. All RPC bodies operate only on
  `p5_governance_readiness_cases`, `p5_governance_evidence_items`,
  `p5_governance_audit_events`.
- RLS and GRANT posture from Stage 1 is preserved; the new functions are
  `REVOKE`d from `PUBLIC`/`anon` and only `GRANT`ed to `authenticated` /
  `service_role` where appropriate.
- The edge function never returns raw provider payloads, provider
  credentials, internal reviewer notes, legal comments, internal risk
  scores, AI reasoning or draft evidence packs.

### Pending

Stage 4 (UI surfaces for the admin governance triage + entity-side
readiness cards, with role-based visibility) does not begin until Stage 3
is signed off.

Expected next status: **STAGE_3_ACTION_RPCS_AND_API_RUNTIME_CONFIRMED**.


## Stage 4 — Admin surfaces (COMPLETE)

Status: **STAGE_4_ADMIN_SURFACES_DEPLOYED**

### Admin route added

- `/admin/p5-governance` — P-5 cases dashboard
- `/admin/p5-governance/:caseId` — case detail

Wired in `src/App.tsx` behind `RequireAuth role="platform_admin"`
(consistent with all other `/admin/*` routes). Finer-grained role gating
for action buttons is enforced inside the page via `useP5Permissions`.
Route constant `ROUTES.ADMIN_P5_GOVERNANCE` added in
`src/lib/constants.ts`. Nav entry "P-5 Governance" added to
`src/pages/admin/registry/Index.tsx`.

### Files added

- `src/hooks/useP5Permissions.ts` — pure `deriveP5Permissions(roles)`
  plus React hook reading `AuthContext.roles`. Single source of truth
  for admin UI affordances.
- `src/lib/p5-governance/rpc.ts` — typed wrappers around every Stage 3
  RPC. Admin dialogs/panels MUST call these instead of writing to
  `p5_governance_*` tables directly.
- `src/pages/admin/p5-governance/CasesDashboard.tsx` — case list with
  the 13 filters required in the Stage 4 brief.
- `src/pages/admin/p5-governance/CaseDetail.tsx` — three-lane header,
  subject, action buttons, evidence panel, provider panel, audit
  timeline.
- `src/pages/admin/p5-governance/components/P5StatusBadge.tsx`
- `src/pages/admin/p5-governance/components/EvidenceReviewPanel.tsx`
- `src/pages/admin/p5-governance/components/ProviderDependencyPanel.tsx`
- `src/pages/admin/p5-governance/components/P5AuditTimeline.tsx`
- `src/pages/admin/p5-governance/components/dialogs/ReasonedActionDialog.tsx`
  — shared shell enforcing reason_code + note for high-stakes actions.
- `src/pages/admin/p5-governance/components/dialogs/HoldDialog.tsx`
  (self-contained — includes hold-type selector: governance / compliance
  / legal / payment / admin).
- `src/pages/admin/p5-governance/components/dialogs/WaiverDialog.tsx`
- `src/pages/admin/p5-governance/components/dialogs/OverrideDialog.tsx`
- `src/pages/admin/p5-governance/components/dialogs/EscalateDialog.tsx`
- `src/pages/admin/p5-governance/components/dialogs/RequestMoreInfoDialog.tsx`
- `src/pages/admin/p5-governance/components/dialogs/RejectDialog.tsx`

### Permission hook summary (`useP5Permissions`)

Role mapping aligned with Batch 1 answers and existing `app_role`:

| Role                             | View | Review | Internal approve | Ready to proceed | Hold | Release hold | Waive | Override | Reject | Escalate |
| -------------------------------- | ---- | ------ | ---------------- | ---------------- | ---- | ------------ | ----- | -------- | ------ | -------- |
| `platform_admin`                 | ✓    | ✓      | ✓                | ✓                | ✓    | ✓            | ✓     | ✓        | ✓      | ✓        |
| `executive_approver`             | ✓    | ✓      | ✓                | ✓                | ✓    | ✓            | ✓     | ✓        | ✓      | ✓        |
| `governance_reviewer`            | ✓    | ✓      | ✓                | ✗                | ✓    | ✗            | ✗     | ✗        | ✓      | ✓        |
| `operator_case_manager`          | ✓    | ✓      | ✓                | ✗                | ✓    | ✗            | ✗     | ✗        | ✓      | ✓        |
| `compliance_analyst`             | ✓    | ✓      | ✓                | ✗                | ✓    | ✗            | ✗     | ✗        | ✓      | ✓        |
| `auditor` / `auditor_read_only`  | ✓    | ✗      | ✗                | ✗                | ✗    | ✗            | ✗     | ✗        | ✗      | ✗        |
| `developer_technical_admin`      | ✓¹   | ✗      | ✗                | ✗                | ✗    | ✗            | ✗     | ✗        | ✗      | ✗        |
| `customer_entity_owner` / `funder_external_reviewer` | ✗ | — | — | — | — | — | — | — | — | — |

¹ Diagnostic/provider view only; no business decisions.

### Action / RPC wiring summary

Every mutating button on the admin pages calls a thin wrapper in
`src/lib/p5-governance/rpc.ts`, never the table directly:

| UI control                        | RPC                              |
| --------------------------------- | -------------------------------- |
| Approve internally                | `p5_approve_internally`          |
| Approve ready to proceed          | `p5_approve_ready_to_proceed`    |
| Request more information dialog   | `p5_request_more_info`           |
| Hold dialog                       | `p5_apply_hold`                  |
| Release hold (admin)              | `p5_release_hold`                |
| Escalate dialog                   | `p5_escalate`                    |
| Reject dialog                     | `p5_reject`                      |
| Waiver dialog                     | `p5_waive`                       |
| Override dialog                   | `p5_override`                    |
| Evidence approve / reject /       | `p5_review_evidence`             |
| request correction                |                                  |
| Reopen / archive (admin)          | `p5_reopen` / `p5_archive_superseded` |
| Assign owner / start review       | `p5_assign_owner` / `p5_start_review` |
| Record provider result            | `p5_record_provider_result`      |

Reject, request-more-info, hold/release, waiver, override and escalate
all require a `reason_code` AND a free-text `note` on the client side;
the Stage 3 RPCs re-validate this server-side so this is defence in
depth, not the only check.

### Test command / result

```bash
bunx vitest run src/tests/p5-batch1
```

Result: **9 test files, 81 tests passing.**

Stage 4 added 21 new tests:

- `src/tests/p5-batch1-admin-permissions.test.tsx` — 8 tests covering
  every required role × capability matrix entry (auditor read-only,
  developer no business actions, executive_approver / platform_admin
  full admin, compliance reviewer can hold but not override).
- `src/tests/p5-batch1-admin-wording.test.tsx` — 3 tests asserting that
  `P5StatusBadge`, `ProviderDependencyPanel` and `P5AuditTimeline` never
  emit any term from `P5_FORBIDDEN_WORDS` and only render the Stage 1
  SSOT status labels and approved provider phrases.
- `src/tests/p5-batch1-admin-dashboard.test.tsx` — 4 tests covering
  badge SSOT labels for all statuses, blocked ≠ ready-to-proceed,
  provider-dependent ≠ ready-to-proceed, and dashboard default export.
- `src/tests/p5-batch1-admin-actions.test.tsx` — 6 tests covering the
  `ReasonedActionDialog` shell (confirm disabled without reason+note,
  warning banner renders for override/waiver), developer/auditor
  negative gating, admin positive gating, and RPC wrapper module shape
  (all 15 expected wrappers present).

### Constraints honoured in Stage 4

- **Customer / funder views NOT added.** Only `/admin/p5-governance*`
  routes were introduced. Stage 5 will introduce the customer-safe and
  funder-safe surfaces.
- **No database migrations applied in this stage.** Nothing in
  `supabase/migrations/` was added or changed for Stage 4. No existing
  `trade_requests`, `pois`, `wads`, `token_*`, `payment_*`,
  `business_decisions` or any other business-data row was mutated by
  this stage's code.
- **Audit remains append-only.** All mutating actions in the admin UI
  go through Stage 3 RPCs, which write a `p5_governance_audit_events`
  row in the same transaction; the Stage 1
  `p5_audit_no_update`/`p5_audit_no_delete` triggers continue to block
  any direct edit/delete.
- **No unsafe wording introduced.** The wording test sweeps every
  status and every provider state against the full `P5_FORBIDDEN_WORDS`
  list. Provider panel uses only "Provider result received / failed /
  timeout / inconclusive / Credentials pending / Provider not live /
  Requires human review / Not applicable".
- **Least privilege at the UI layer too.** Action buttons are not
  rendered for roles that cannot perform the action; the Stage 3 RPC
  remains the authoritative deny.
- **No bypass of the action contract.** Every dialog requires reason
  code + note client-side before enabling confirm, matching the Stage 2
  `assertTransition` rules and Stage 3 RPC argument checks.

### Pending

Stage 5 — customer / funder / external API client surfaces, including
the Stage 3 `p5-governance-readiness-summary` edge function consumer
side. Not yet started.

Expected next status: **STAGE_4_ADMIN_SURFACES_RUNTIME_CONFIRMED**.

---

## Stage 5 — Subject Pages + Customer / Funder / API-Client Views

Status marker: **STAGE_5_NON_ADMIN_SURFACES_DEPLOYED**.

### Files added

- `src/components/p5-governance/P5ReadinessCard.tsx` (new) — reusable
  read-only subject-page card. Consumes only the scoped
  `P5ReadinessSummary` shape; never reads `p5_governance_*` tables.
  Viewer-gated (`admin` / `internal` / `customer` / `funder` /
  `api_client`). Stage 1 SSOT labels via `P5StatusBadge`. Stage 2
  wording guard fires at render time.
- `src/components/p5-governance/index.ts` (new) — barrel export.
- `src/lib/p5-governance/summary-types.ts` (new) — typed mirror of the
  Stage 3 edge function response. Includes the `P5SummaryViewer` union.
- `src/lib/p5-governance/summary-client.ts` (new) — typed
  `fetchP5ReadinessSummary` wrapper around the edge function.
- `src/pages/registry/MyCompanyReadiness.tsx` (new) — customer /
  entity-owner readiness view. No internal notes, no raw provider
  payloads, no risk scores, no legal comments, no other customers'
  cases. Evidence upload affordance only when
  `canSubmitCustomerEvidence` is true.
- `src/pages/funder/FunderEvidencePack.tsx` (new) — funder / external
  reviewer read-only summary view. No action buttons. No draft /
  rejected evidence. No raw personal / bank fields.
- `src/hooks/useP5Permissions.ts` (edited) — added
  `canViewCustomerReadiness`, `canSubmitCustomerEvidence`,
  `canViewFunderEvidencePack`, `canFunderMutate` (always false).
- `src/App.tsx` (edited) — added three Stage 5 routes:
  - `/registry/my-companies/:companyId/readiness`
  - `/registry/my-readiness`
  - `/funder/evidence-pack`
- `src/tests/p5-batch1-subject-readiness-card.test.tsx` (new, 7 tests)
- `src/tests/p5-batch1-customer-readiness-view.test.tsx` (new, 6 tests)
- `src/tests/p5-batch1-funder-evidence-pack.test.tsx` (new, 6 tests)
- `src/tests/p5-batch1-customer-funder-wording.test.tsx` (new, 6 tests)

### Subject pages integrated

`P5ReadinessCard` is the integration point. Existing subject pages
(entity profile, my-companies, match page, counterparty page, project /
programme page, transaction page) can drop it in with a
`viewer="internal"` or `viewer="customer"` prop without further wiring;
the card is self-contained, accepts the scoped summary as a prop, and
inherits Stage 1 labels + Stage 2 wording guard. No subject-page schema
or business logic was changed in this stage.

### Customer readiness view summary

- Reads only the scoped edge-function response.
- Shows: simple readiness badge, blocker count, required items
  outstanding, next action (Stage 2 cautious wording), provider
  dependency in neutral wording, last updated date.
- Hides: governance + compliance lane badges, owner type, hash-chain
  reference, audit references block, raw provider payloads, internal
  notes, risk scores, legal comments, other customers' cases.
- Surfaces the "Upload or replace evidence" link only when the role is
  `customer_entity_owner` AND there are outstanding required items AND
  a `companyId` is available.

### Funder evidence-pack view summary

- Read-only — no action buttons.
- Shows: readiness badge, blocker / warning counts, provider dependency
  in cautious wording, audit reference, evidence pack ID, evidence
  summary ID, last updated date.
- Hides: governance + compliance lane badges, owner type, hash-chain
  reference, draft / rejected evidence, internal reviewer notes, raw
  personal / bank fields, provider raw payloads, AI reasoning.

### Permission / scoping summary

`deriveP5Permissions` proves (`p5-batch1-customer-readiness-view.test.tsx`):

| Role                          | Customer view | Submit evidence | Funder pack | Mutate P-5 |
| ----------------------------- | ------------- | --------------- | ----------- | ---------- |
| customer_entity_owner         | yes           | yes             | no          | no         |
| funder_external_reviewer      | no            | no              | yes         | no         |
| platform_admin                | preview       | no              | preview     | yes        |
| reviewer roles                | preview       | no              | preview     | varies     |
| developer_technical_admin     | no            | no              | no          | no         |
| auditor / auditor_read_only   | no            | no              | no          | no         |
| anonymous                     | no            | no              | no          | no         |

`canFunderMutate` is hard-coded `false` regardless of role combination.

### Wording guard summary

- `P5ReadinessCard` calls `assertCustomerSafeWording` on the
  `nextAction` string at render time. Forbidden wording throws.
- `safeText()` falls back to `"Under Review"` if a passed-in label fails
  the customer/funder/api_client guard.
- Provider-status mapping uses only the Stage 1 allow-list copy
  ("Provider not live", "Credentials pending", "External confirmation
  pending", "Provider timeout — retry pending", "Provider result
  inconclusive — manual review required", "Provider result received",
  "Provider result requires review", "Not applicable"). None of these
  imply "Verified", "Cleared", "Compliant", "Bankable", "Final
  settlement", "WaD finality" etc.
- `p5-batch1-customer-funder-wording.test.tsx` sweeps every entry of
  `P5_FORBIDDEN_WORDS` on customer / funder / public_api surfaces.

### Test command / result

```
bunx vitest run src/tests/p5-batch1-
```

- 13 test files
- **106 / 106 P-5 Batch 1 tests pass** (81 prior + 25 new Stage 5).

### Stage 5 invariants — confirmed

- **No admin-only fields leak.** `P5ReadinessSummary` is the only shape
  used by customer / funder / api_client surfaces. The hash-chain
  reference, lane badges and owner type are explicitly hidden from
  non-admin viewers; tests assert each.
- **No direct unsafe table mutation.** Customer + funder pages call
  `fetchP5ReadinessSummary` only. No `supabase.from("p5_governance_*")`
  reads or writes from any Stage 5 file.
- **No existing trade / POI / WaD / billing / payment /
  business-decision rows mutated.** Stage 5 added no SQL migrations and
  no edge functions; it only added React surfaces and typed wrappers.
- **No customer/funder views gained mutation rights.** Funder view has
  zero action buttons; `canFunderMutate === false` in tests.
- **Developer/technical admin does not gain business decision rights.**
  Test sweep `p5-batch1-customer-readiness-view.test.tsx` re-asserts
  `canApproveReadyToProceed === false`, `canWaive === false`,
  `canOverride === false`, `canReject === false`, `canApplyHold ===
  false`, `canSubmitCustomerEvidence === false`.
- **Auditor remains read-only** for both new surfaces.

### Pending

Stage 6 — not yet started. Awaiting explicit approval before any work.

---

## Stage 6 — SLA Monitor + Notifications + Final Acceptance

Status marker: **STAGE_6_SLA_MONITOR_AND_FINAL_ACCEPTANCE_DEPLOYED**.

### Files added / changed

- `src/lib/p5-governance/sla-rules.ts` (new) — pure, deterministic
  SLA rules engine. 20 rule codes, working-day helper, idempotency key
  builder. Same TypeScript module is mirrored inline in the edge
  function (no project-relative imports across the Deno boundary).
- `supabase/functions/p5-governance-sla-monitor/index.ts` (new) — cron
  edge function. `x-internal-key` auth, service-role client, scans
  open cases, writes notification_dispatches + immutable
  p5_governance_audit_events, applies stale_block status change for
  the 14-day rule.
- `supabase/migrations/<ts>_p5_batch1_sla_monitor_columns.sql`
  (applied via migration tool) — adds 8 nullable / default-false
  SLA-tracking columns to `p5_governance_readiness_cases`, creates
  partial index `idx_p5_cases_sla_scan`, seeds the
  `p5-governance-sla-monitor` cron_heartbeats row. No existing rows
  mutated; no business tables touched.
- Cron job registered via `cron.schedule()` (insert tool, not
  migration — vault-backed `INTERNAL_CRON_KEY` is project-local).
- `src/tests/p5-batch1-sla-monitor.test.ts` (new, 16 tests).
- `src/tests/p5-batch1-notifications.test.ts` (new, 5 tests).
- `supabase/tests/p5_batch1_sla_monitor_proof.sql` (new) — SQL proof.

### Cron job

| Field             | Value                                                     |
| ----------------- | --------------------------------------------------------- |
| Job name          | `p5-governance-sla-monitor`                               |
| Cadence           | `*/15 * * * *`                                            |
| Invocation        | `public.cron_invoke()` (vault-stored `INTERNAL_CRON_KEY`) |
| Heartbeat row     | seeded in `cron_heartbeats` (expected_interval 900s)      |
| Active            | true (verified via `cron.job`)                            |

The standard `cron_invoke()` helper writes the heartbeat row on every
invocation; `cron_reconcile_heartbeats` then promotes it to
success / failed based on the `pg_net` response. No bespoke heartbeat
write is needed in the edge function.

### Edge function

`p5-governance-sla-monitor` — POST only. Returns:

```json
{
  "ok": true, "run_id": "uuid",
  "checked": N, "escalated": N, "reminded": N, "blocked": N,
  "notifications_created": N, "audit_events_created": N,
  "skipped_dupes": N
}
```

- 401 on missing/incorrect `x-internal-key` (verified live —
  unauthorised call returns `{"ok":false,"error":"Unauthorized"}`).
- Service-role client used only inside the handler.
- No hard-coded secrets.

### Escalation rules implemented (Batch 1 SSOT)

| Rule | Trigger | Severity | Routes to | Bucket |
| ---- | ------- | -------- | --------- | ------ |
| `reviewer_unassigned_24h` | submitted, no reviewer, >24h | escalation | platform_admin | daily |
| `under_review_overdue_48h` | under_review, >48h | escalation | platform_admin | daily |
| `more_info_reminder_3wd` | more_info, >3 wd no response | reminder | customer + operator | daily |
| `more_info_escalate_7wd` | more_info, >7 wd no response | escalation | platform_admin + operator | daily |
| `more_info_stale_14d` | more_info, >14 cal d, no extension | stale_block (→ blocked) | platform_admin + operator | once |
| `hard_blocker_unresolved_2wd` | blocked, >2 wd since first set | escalation | platform_admin | daily |
| `compliance_hold_unresolved_5wd` | compliance hold, >5 wd | critical_escalation | executive_approver + compliance_admin | daily |
| `provider_pending_24h` | provider pending/not_live/creds/timeout, >24h | reminder | dev_admin + operator | daily |
| `provider_pending_72h_live` | same + affects live/funder, >72h | escalation | platform_admin | daily |
| `immediate_provider_failed` | reason includes `provider_failed` | critical_escalation | platform_admin + compliance_admin | per_event |
| `immediate_provider_conflict` | reason includes `provider_result_conflict` | critical_escalation | platform_admin + compliance_admin | per_event |
| `immediate_sanctions_pep` | reason includes `sanctions_pep_adverse_result_review` | critical_escalation | platform_admin + compliance_admin | per_event |
| `immediate_bank_issue` | reason includes `bank_detail_verification_issue` | critical_escalation | platform_admin + compliance_admin | per_event |
| `immediate_payment_anomaly` | reason includes `payment_confirmation_issue` | critical_escalation | platform_admin + compliance_admin | per_event |
| `immediate_duplicate_notification` | reason includes `duplicate_notification` | critical_escalation | platform_admin + compliance_admin | per_event |
| `immediate_amount_mismatch` | reason includes `amount_currency_mismatch` | critical_escalation | platform_admin + compliance_admin | per_event |
| `immediate_audit_tamper` | reason includes `audit_trail_issue` or `tamper_evidence_issue` | critical_escalation | platform_admin + compliance_admin | per_event |
| `dispute_rejection` | `dispute_open=true` | critical_escalation | platform_admin + executive_approver | per_event |
| `waiver_request` | `waiver_requested=true` | critical_escalation | platform_admin + executive_approver | per_event |
| `override_request` | `override_requested=true` | critical_escalation | platform_admin + executive_approver | per_event |

### Notification routing

- Uses existing `notification_dispatches` table — no competing system.
- One row per recipient role per action.
- `channel='in_app'`, `status='pending'` (matches
  `notification_dispatches_status_check`).
- `metadata.p5_sla_idempotency_key` carries the deterministic key.
- `metadata.p5_sla_message` carries the customer/funder-safe message
  emitted by the pure rules engine; messages are sweep-tested against
  `assertCustomerSafeWording` on customer / funder / public_api
  surfaces (`p5-batch1-notifications.test.ts`).
- No notification carries internal reviewer notes, raw provider
  payloads, credentials, risk scores, AI reasoning, legal comments,
  raw bank fields or other customers' data.

### Idempotency

Deterministic key `p5_sla:{case_id}:{rule_code}:{bucket}` where bucket
is `YYYY-MM-DD` for daily rules, an event token for per_event rules,
and the literal `once` for the 14-day stale_block. Before any insert,
the monitor queries `notification_dispatches` for a matching key on the
same `reference_id`+`event_type` and skips if found, incrementing
`skipped_dupes`.

### Audit summary

Every triggered SLA action writes an immutable row to
`p5_governance_audit_events`:

- `event_type = 'sla.<rule_code>'`
- `actor_type = 'system'`
- `previous_status`, `new_status` (`new_status` set only for the
  stale_block rule; otherwise mirrors current status)
- `reason_code` from the rule
- `note` = customer-safe message
- `correlation_id` = monitor `run_id`
- `metadata` includes `p5_sla_rule_code`, `p5_sla_severity`,
  `p5_sla_notify_roles`, `p5_sla_idempotency_key`, `p5_sla_bucket`.

The SQL proof verifies that `UPDATE` and `DELETE` against an
existing system-generated row are both rejected by the Stage 1
append-only trigger.

### Test command / result

```
bunx vitest run src/tests/p5-batch1-
psql -f supabase/tests/p5_batch1_sla_monitor_proof.sql
```

- TypeScript: **127 / 127 P-5 Batch 1 tests pass** (15 files):
  - Stage 1 enum-drift: 6
  - Stage 2 readiness / transitions / wording: 22 + 14 + 12
  - Stage 3 api-scoping: 6
  - Stage 4 admin permissions / dashboard / actions / wording: 8 + 4 + 6 + 3
  - Stage 5 subject card / customer / funder / wording: 7 + 6 + 6 + 6
  - **Stage 6 SLA monitor: 16**, **notifications: 5**
- SQL proof: emits `NOTICE: P5_STAGE6_PROOF_OK` and rolls back cleanly.
- Edge function smoke: unauthorised POST returns
  `{"ok":false,"error":"Unauthorized"}`.
- Cron registration verified live:
  `cron.job` row exists with `schedule='*/15 * * * *'`, `active=true`.

### Stage 6 invariants — confirmed

- **No forbidden wording.** Every SLA action's `message` is sweep-tested
  against `assertCustomerSafeWording` on customer + funder + public_api
  surfaces (`p5-batch1-notifications.test.ts`).
- **No admin-only leaks.** Notification metadata carries rule code,
  severity, idempotency key, safe message and routing — no raw provider
  payloads, risk scores, legal comments or internal notes.
- **No existing trade / POI / WaD / billing / payment /
  business-decision rows mutated.** The migration only adds nullable /
  default-false columns to `p5_governance_readiness_cases`. The monitor
  only writes to `notification_dispatches`,
  `p5_governance_audit_events` and (for the 14-day stale rule)
  `p5_governance_readiness_cases.readiness_status` /
  `is_escalated` / `escalated_at`. The SQL proof confirms no
  `p5_sla_*` columns leaked into `matches`, `trade_requests`,
  `trade_orders`, `pois`, `wads`, `token_purchases`, `token_ledger`,
  `payment_disputes`, `refund_requests`, `business_decisions`.
- **Heartbeat evidence.** Row seeded in `cron_heartbeats` at migration
  time; `cron_invoke()` updates `last_run_at`, `last_request_id`,
  `last_status`, `last_http_status`, `last_error` on every invocation
  via the standard reconciler (no bespoke writer in the edge function).

---

## Batch 1 Final Acceptance Checklist

| # | Criterion | Met | Evidence |
| - | --------- | --- | -------- |
| 1 | Statuses implemented consistently | ✅ | Stage 1 `P5_STATUSES` SSOT + `p5_status` DB enum + drift guard (6/6) |
| 2 | Transition rules coded and tested | ✅ | `src/lib/p5-governance/transitions.ts` + 14 tests |
| 3 | RBAC / RLS implemented | ✅ | Stage 1 RLS + GRANTs + `has_role`; Stage 3 RPC role checks |
| 4 | Admin dashboard built | ✅ | Stage 4 `/admin/p5-governance` + 21 tests |
| 5 | Subject / customer / funder views built | ✅ | Stage 5 `P5ReadinessCard`, `MyCompanyReadiness`, `FunderEvidencePack` + 25 tests |
| 6 | Hard blockers vs warnings separated | ✅ | `P5_RULE_SEVERITIES` SSOT + readiness engine; `blocker_count` / `warning_count` columns |
| 7 | Deterministic readiness implemented | ✅ | Stage 2 `calculateReadiness` + 22 tests + Stage 3 SQL mirror |
| 8 | Governance / compliance actions implemented | ✅ | Stage 3 — 19 `SECURITY DEFINER` RPCs, each audited |
| 9 | Provider dependency implemented with cautious wording | ✅ | Stage 2 wording guard + Stage 4 `ProviderDependencyPanel` + Stage 5 `P5ReadinessCard` |
| 10 | Notifications / tasks / escalations implemented | ✅ | Stage 6 SLA monitor + 20 rule codes + idempotent dispatches |
| 11 | API returns scoped fields | ✅ | Stage 3 `p5-governance-readiness-summary` + 6 scoping tests |
| 12 | Internal-only fields excluded from unsafe contexts | ✅ | Edge function strips raw payloads / risk scores / notes; Stage 5 viewer gating |
| 13 | Every material action audited | ✅ | All Stage 3 RPCs + Stage 6 SLA actions write `p5_governance_audit_events`; append-only trigger |
| 14 | Forbidden wording blocked | ✅ | Stage 2 `assertCustomerSafeWording` + 12 + 6 + 5 sweep tests |
| 15 | UAT evidence available | ✅ | This README — all six stages documented with file lists, test results and SQL proofs |

**P-5 Batch 1 — Governance, Compliance & Readiness: COMPLETE.**

Test totals: **127 / 127** TypeScript tests passing across 15 files (pre-audit).
SQL proofs: Stage 3 (`P5_STAGE3_PROOF_OK`) + Stage 6
(`P5_STAGE6_PROOF_OK`).

No Batch 2 work has been started.

---

## Final Embarrassment-Prevention Audit (post-Stage 6, pre-Batch 2)

Status: **P5_BATCH_1_FINAL_EMBARRASSMENT_PREVENTION_AUDIT_COMPLETE**

### Files checked
- `src/lib/p5-governance/{constants,readiness,transitions,wording-guard,rpc,sla-rules,summary-types,summary-client}.ts`
- `src/pages/admin/p5-governance/{CasesDashboard,CaseDetail}.tsx`
- `src/pages/admin/p5-governance/components/{P5StatusBadge,P5AuditTimeline,EvidenceReviewPanel,ProviderDependencyPanel}.tsx`
- `src/pages/admin/p5-governance/components/dialogs/{ReasonedActionDialog,HoldDialog,WaiverDialog,OverrideDialog,EscalateDialog,RejectDialog,RequestMoreInfoDialog}.tsx`
- `src/components/p5-governance/P5ReadinessCard.tsx`
- `src/pages/registry/MyCompanyReadiness.tsx`
- `src/pages/funder/FunderEvidencePack.tsx`
- `supabase/functions/p5-governance-readiness-summary/index.ts`
- `src/hooks/useP5Permissions.ts`
- `evidence/p5-batch1-governance-readiness/README.md` (self-reflection)
- Full `src/` tree scanned for direct mutation of `p5_governance_*` tables.

### Tests / scripts added
- `src/tests/p5-batch1-final-cross-surface-audit.test.tsx` — 18 tests covering
  status drift, reason-code coverage, badge/timeline render, provider-dependent
  truth wording, SLA message safety, direct-mutation bypass guard and README
  reflectivity.
- `src/tests/p5-batch1-final-permission-leak-audit.test.tsx` — 11 tests covering
  funder/auditor/customer/developer/reviewer/operator/admin permission matrix
  via `deriveP5Permissions`.
- `scripts/check-p5-batch1-final-consistency.mjs` — static sweep for forbidden
  wording in external surfaces, direct mutation bypass, reasoned-dialog reason
  code wiring, status-label coverage and dashboard filter completeness.

### Commands run + results

```
node scripts/check-p5-batch1-final-consistency.mjs
→ P5_BATCH_1_FINAL_CONSISTENCY_OK (exit 0)

bunx vitest run \
  src/tests/p5-batch1-final-cross-surface-audit.test.tsx \
  src/tests/p5-batch1-final-permission-leak-audit.test.tsx
→ 2 files passed · 29 / 29 tests passed

bunx vitest run src/tests/p5-batch1-*.test.*
→ 17 files passed · 156 / 156 tests passed
  (127 prior + 29 new audit tests)
```

### Issues found
None. The audit was clean on first green run after a minor regex fix in the
README reflectivity assertion (tightened to match `.test.ts(x)` filenames).
No source, edge function, dialog, badge, panel, summary surface, SLA rule or
permission derivation required changes.

### Fixes applied
None — see above.

### Confirmations
- No Batch 2 work has been started.
- No existing trade, POI, WaD, billing, payment or business-decision rows were
  read, written, mutated or referenced. The audit is pure module inspection +
  React render + static grep over P-5 files only.
- No new SQL migrations applied.
- All P-5 mutating UI paths continue to go through Stage 3 `p5Rpc.*` wrappers;
  the bypass guard test failed-loud audit confirms zero direct
  `insert|update|delete|upsert` on `p5_governance_readiness_cases`,
  `p5_governance_evidence_items` or `p5_governance_audit_events` outside
  `src/lib/p5-governance/rpc.ts`.
- Append-only audit triggers from Stage 1 remain in place; no audit row
  mutation paths were introduced.
- Forbidden wording sweep (string literals only) across customer, funder,
  notification (SLA) and shared P-5 components: zero hits.
- Funder is strictly read-only (`canFunderMutate = false`); developer /
  technical admin remains diagnostics-only; auditor remains read-only;
  customer cannot reach admin surfaces; reviewers cannot waive/override or
  release holds; operator cannot approve final readiness.
- Provider-dependent surfaces never imply pass / verified / cleared / bankable
  / compliant — checked for every `p5_provider_status` value.

