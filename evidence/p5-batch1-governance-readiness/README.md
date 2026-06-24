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

Expected next status: **STAGE_2_READINESS_ENGINE_AND_GUARDS_RUNTIME_CONFIRMED**.
