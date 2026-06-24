P-5 Batch 1 is a large, cross-cutting build (schema + RBAC + UI + API + wording guards + tests). It cannot land safely in a single shot. Below is a staged plan that respects the existing codebase (registry_*, business_decisions, compliance_cases, audit_logs, event_store, user_roles, app_role enum) and the project's hard constraints (RLS + GRANTs, append-only audit, conservative wording, no silent deletes, no overclaim).

Each stage ends with green tests and an evidence/ README before the next begins. Nothing in this batch mutates existing trade/POI/WaD/billing rows.

## Stage 1 — Foundation schema + reason-code SSOT (migration only)

Migration: `p5_batch1_governance_readiness_foundation`.

Creates (all under `public`, with GRANTs in same migration):

- `p5_governance_readiness_cases` — exact fields from the prompt. FKs nullable to entities/organizations/matches/counterparties so it can attach to any subject.
- `p5_governance_evidence_items` — case_id FK, evidence_type, required, status, expiry, reason codes.
- `p5_governance_audit_events` — append-only (INSERT-only policy + revoke UPDATE/DELETE from authenticated; service_role only for admin tooling). Trigger blocks UPDATE/DELETE on this table to match existing `audit_logs` / `event_store` immutability convention.
- Postgres enums: `p5_status`, `p5_provider_status`, `p5_reason_code`, `p5_rule_severity`, `p5_actor_type`. Adding enum values is cheap later.
- Helper SECURITY DEFINER fns: `p5_has_role(_uid, _role text[])`, `p5_can_view_case(_uid, _case)` — reuse existing `has_role` pattern, no recursion.
- RLS:
  - cases: platform_admin / compliance_analyst / auditor read all; org members read where their org owns the subject; service_role full.
  - evidence_items: same scoping via parent case.
  - audit_events: read = same scoping; INSERT via SECURITY DEFINER RPC only; no UPDATE/DELETE.
- TS SSOT module `src/lib/p5-governance/constants.ts` exporting:
  - `P5_STATUSES`, `P5_STATUS_LABELS`
  - `P5_REASON_CODES` (exact list from prompt)
  - `P5_PROVIDER_STATUSES`
  - `P5_FORBIDDEN_WORDS` (Verified, Certified, Compliant, Sanctions Cleared, PEP Clear, AML Cleared, KYC Complete, Bankable, Guaranteed, Risk-free, etc.)
  - `P5_ALLOWED_WORDS`
- Build-time drift guard test mirroring `wad-status-drift-guard`: TS enums ↔ DB enums.

Exit: migration approved + applied; drift test green; nothing rendered yet.

## Stage 2 — Deterministic readiness engine + transition guard (pure TS, fully tested)

- `src/lib/p5-governance/readiness.ts` implementing `calculateReadiness()` exactly as specified (worst-outstanding-issue logic).
- `src/lib/p5-governance/transitions.ts` — allowed transitions table; `assertTransition(from, to, actor, reasonCode?)` throws on illegal moves and on missing reason code for: rejection / hold / release hold / waiver / override / escalation / request more info.
- `src/lib/p5-governance/wording-guard.ts` — `assertCustomerSafeWording(text, context)` rejects forbidden words. Exported for use in UI + edge functions + tests.
- `src/tests/p5-batch1-readiness.test.ts`, `p5-batch1-transitions.test.ts`, `p5-batch1-wording-guard.test.ts` covering every case enumerated in §16 of the prompt.

Exit: vitest green for the new files; no UI yet.

## Stage 3 — Server-side RPCs + edge function (single source of truth for actions)

Migration `p5_batch1_action_rpcs` adds SECURITY DEFINER functions, each writing the case row AND an immutable audit event in one transaction:

- `p5_create_case`, `p5_submit_case`, `p5_start_review`, `p5_request_more_info`,
- `p5_approve_internally`, `p5_mark_provider_dependent`, `p5_record_provider_result`,
- `p5_approve_ready_to_proceed` (executive_approver / platform_admin only),
- `p5_apply_hold`, `p5_release_hold`,
- `p5_reject`, `p5_escalate`, `p5_waive`, `p5_override`, `p5_reopen`, `p5_archive_superseded`,
- `p5_assign_owner`, `p5_upload_evidence_meta`, `p5_review_evidence`.

Each fn:

- re-validates allowed transition + role + reason-code requirement server-side,
- recomputes status via SQL mirror of `calculateReadiness`,
- inserts `p5_governance_audit_events` row,
- never deletes anything.

Edge function `p5-governance-readiness-summary` (verify_jwt validated in code) returns the public/API-scoped shape from §13. Strips all internal-only fields per role. Reuses `wording-guard` server-side before returning `next_action` text.

Tests:

- `supabase/tests/p5_batch1_action_rpcs_proof.sql` — permission denies, audit-row-created, immutable audit, illegal transitions rejected.
- `src/tests/p5-batch1-api-scoping.test.ts` — mocks edge fn response and asserts forbidden fields are absent for each role.

Exit: SQL proofs green; api-scoping test green.

## Stage 4 — Admin surfaces

Under `src/pages/admin/p5-governance/`:

- `CasesDashboard.tsx` — list view with filters (status, blockers, warnings, provider-dependent, on hold, escalated, overdue, ready to proceed, MIR). Uses `StatusBadge` extended with P5 statuses.
- `CaseDetail.tsx` — full lanes (governance / compliance / readiness), evidence checklist, audit timeline, action buttons (Stage 3 RPCs) gated by `useChallengePermissions`-style hook `useP5Permissions`.
- `EvidenceReviewPanel.tsx`, `HoldDialog.tsx`, `WaiverDialog.tsx`, `OverrideDialog.tsx`, `EscalateDialog.tsx`, `RequestMoreInfoDialog.tsx`, `ProviderDependencyPanel.tsx` — every one enforces reason-code + note where required.
- Route registered in `src/lib/constants.ts` (`ADMIN_P5_GOVERNANCE`) and admin nav.

No customer-safe wording yet — admin-only.

## Stage 5 — Subject pages + customer/funder/API-client views

- Extend existing Entity / Match / Counterparty pages with a `P5ReadinessCard` (badge + missing items + next action). Reuses `ReadinessBanner` look.
- `src/pages/registry/MyCompanyReadiness.tsx` — customer view: simple badge, missing items, allowed wording only. Wording-guard test asserts no forbidden text rendered.
- `FunderEvidencePack.tsx` — read-only approved pack view; gated on `funder_external_reviewer` role (new value added to `app_role` enum in Stage 1 migration if missing).
- E2E: `e2e/journeys/p5-governance-readiness.spec.ts` covering admin approve flow, customer missing-item view, funder pack view, and forbidden-word absence.

## Stage 6 — SLA escalation cron + notifications

- New job via `cron_invoke('p5-governance-sla-monitor', '*/15 * * * *')` mirroring C6.2 pattern (heartbeat row in `cron_heartbeats`, no hard-coded JWT). Implements §12 timers exactly.
- Notifications routed through existing `notification_dispatches` / Resend.
- Evidence README under `evidence/p5-batch1-governance-readiness/`.

## Acceptance gate (per §17)

Each stage ends with vitest + SQL proof + e2e green. Final stage closes the batch by checking off the §17 acceptance list inside the evidence README, with file:line citations per the project's QA precheck rule.

## Technical notes

- New `app_role` values needed: `executive_approver`, `governance_reviewer`, `operator_case_manager`, `developer_technical_admin`, `customer_entity_owner`, `funder_external_reviewer`, `auditor_read_only`. Added via Stage 1 migration; existing `platform_admin` keeps super-admin precedence per RBAC Stage 1+2 memory.
- Wording guard runs at three layers: TS unit tests, edge-function response builder, and a build-time grep over `src/pages/registry/` + customer-safe components.
- No business rows mutated by this batch — only the new `p5_*` tables and enum additions.
- Reuses existing patterns: `has_role` SECURITY DEFINER, `cron_invoke` wrapper, append-only triggers, `StatusBadge`, `BackButton`, `ReadinessBanner`.

## What I need from you before starting

1. Confirm I should add the seven new `app_role` enum values listed above (vs. mapping to existing roles like `compliance_analyst` / `org_admin`).
2. Confirm the subject scope for Stage 1: attach P5 cases to (a) `organizations` only, (b) organizations + matches + counterparties, or (c) all four including projects/programmes.
3. Confirm I should proceed stage-by-stage and pause for review after Stage 1 migration before continuing.  
  
Yes — proceed. My answers to the three points are below.
  P-5 Batch 1 — Build Approval / Stage 1 Instruction
  Approved to proceed with **Stage 1: Foundation schema + reason-code SSOT**, using the client-approved Batch 1 answers as the controlling build instruction set.
  Answers:
  1. **New** `app_role` **enum values**
  Yes, add the seven new role values:
  - `executive_approver`
  - `governance_reviewer`
  - `operator_case_manager`
  - `developer_technical_admin`
  - `customer_entity_owner`
  - `funder_external_reviewer`
  - `auditor_read_only`
  Do not collapse these into existing roles. They should exist as explicit roles because P-5 depends on clear separation between executive approval, governance review, compliance review, operations, technical access, customer ownership, funder visibility and read-only audit access.
  Existing roles such as `platform_admin`, `compliance_analyst` and `org_admin` may retain their current meaning, but P-5 should use the new role values where the Batch 1 permissions require more precise separation.
  2. **Subject scope for Stage 1**
  Use option **(c): all four including projects/programmes**.
  P-5 cases must be attachable to:
  - organizations/entities
  - matches
  - counterparties
  - projects/programmes
  - transactions where already represented in the existing schema
  Keep the foreign keys nullable so a P-5 case can attach to the relevant subject without forcing all subject types to exist at once.
  This is important because the client’s Batch 1 answers expressly refer to company, counterparty, project and transaction readiness, not just organization-level readiness.
  3. **Proceed stage-by-stage**
  Yes. Proceed stage-by-stage.
  Start with **Stage 1 only** and pause after the Stage 1 migration, enum additions, RLS/GRANTs, append-only audit protection and TS SSOT/drift guard are complete.
  Do not begin Stage 2 until Stage 1 has:
  - migration applied cleanly
  - RLS and GRANTs confirmed
  - append-only audit protection proven
  - TS constants created
  - DB enum ↔ TS SSOT drift guard passing
  - evidence README created
  Important constraints for Stage 1:
  - Do not mutate existing trade, POI, WaD, billing, payment or business-decision rows.
  - Do not weaken any existing RLS.
  - Do not introduce silent delete/update paths for audit events.
  - Use least privilege by default.
  - Preserve conservative wording and do not introduce any “verified”, “certified”, “compliant”, “bankable”, “cleared” or “finality” claims into customer/funder/API-facing paths.
  - If there is any conflict between implementation convenience and the client-approved Batch 1 answers, the client-approved answers control.
  Proceed with Stage 1.
  The key reason I would **not** map these to existing broad roles is that the client explicitly asked for least-privilege separation between admin, executive approver, compliance reviewer, governance reviewer, operator, developer, customer, funder, API client and auditor roles.  