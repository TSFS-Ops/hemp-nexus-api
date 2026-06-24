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
