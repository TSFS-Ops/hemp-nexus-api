# P-5 Batch 1 — Governance, Compliance & Readiness

## Stage 1 — Foundation schema + reason-code SSOT (COMPLETE)

Status: **STAGE_1_FOUNDATION_DEPLOYED**

### Scope landed

- Extended `public.app_role` with the seven new P-5 roles: `executive_approver`,
  `governance_reviewer`, `operator_case_manager`, `developer_technical_admin`,
  `customer_entity_owner`, `funder_external_reviewer`, `auditor_read_only`.
  No existing role values changed.
- Added five P-5 enums:
  - `p5_status` (17 values, exact list in `src/lib/p5-governance/constants.ts:9`).
  - `p5_provider_status` (8 values).
  - `p5_rule_severity` (`hard_blocker`, `warning`).
  - `p5_actor_type` (`user`, `system`, `api`, `provider`).
  - `p5_reason_code` (48 values, mirrors §3 of the build prompt verbatim).
- Created three tables under `public`:
  - `p5_governance_readiness_cases` — polymorphic subject (entity / organization
    / counterparty / match / programme / trade_request) per Stage 1 scope
    decision (c). Trigger `p5_cases_subject_required` enforces ≥1 subject FK.
  - `p5_governance_evidence_items` — one row per required/optional evidence
    item per case.
  - `p5_governance_audit_events` — append-only audit row per material action.
- Append-only guarantee: triggers `p5_audit_no_update` and `p5_audit_no_delete`
  raise on any UPDATE or DELETE. No GRANT of UPDATE/DELETE was issued to any
  role on this table.
- GRANTs explicit per project standard:
  - `authenticated` → `SELECT` on all three tables (writes flow through
    SECURITY DEFINER RPCs in Stage 3, never direct DML from the client).
  - `service_role` → full on cases/evidence, `SELECT, INSERT` on audit.
- RLS enabled on all three tables. Read scoping:
  - Privileged roles (`platform_admin`, `executive_approver`,
    `compliance_analyst`, `governance_reviewer`, `operator_case_manager`,
    `auditor`, `auditor_read_only`, `developer_technical_admin`) — read all.
  - Org members — read cases where `organization_id` matches their
    `profiles.org_id`.
  - Evidence and audit visibility derive from parent case (same predicate).
  - Funders/customers get **no** direct read on cases; their views are added
    in Stage 5 via scoped server-side functions only.
- Helper `public.p5_has_any_role(uuid, text[])` is SECURITY DEFINER, with
  `EXECUTE` revoked from `PUBLIC` and `anon`, granted only to `authenticated`
  and `service_role`.
- TS SSOT at `src/lib/p5-governance/constants.ts`. Drift guard at
  `src/tests/p5-batch1-enum-drift.test.ts` fails the build if TS and DB enums
  ever diverge.

### Constraints honoured

- No existing trade, POI, WaD, billing, payment, business-decision or
  registry rows were mutated. Migration consists of `CREATE TYPE`,
  `ALTER TYPE ... ADD VALUE`, `CREATE TABLE`, `CREATE INDEX`,
  `CREATE FUNCTION`, `CREATE TRIGGER`, `GRANT`, `REVOKE`, `CREATE POLICY`.
- No existing RLS weakened. No silent delete or update path exists for
  `p5_governance_audit_events`.
- No customer/funder/API surface ships in Stage 1; no "verified",
  "certified", "compliant", "bankable", "cleared" or "finality" wording
  introduced. Forbidden-word list seeded in
  `src/lib/p5-governance/constants.ts:150` for Stage 2 enforcement.
- Least-privilege defaults: no `anon` grants on any P-5 table; helper
  function not callable by anonymous visitors.

### Linter delta

Pre-existing project linter findings: 186. The Stage 1 migration introduced
zero new findings after the follow-up `REVOKE EXECUTE ... FROM PUBLIC, anon`
on `p5_has_any_role`.

### Files

- `supabase/migrations/*p5_batch1*` — two migrations (foundation + helper
  lockdown).
- `src/lib/p5-governance/constants.ts` — TS SSOT.
- `src/tests/p5-batch1-enum-drift.test.ts` — drift guard.

### Pending

Stage 2 (deterministic readiness engine + transition + wording guards) does
not begin until you confirm Stage 1 is signed off.

Expected next status: **STAGE_1_FOUNDATION_RUNTIME_CONFIRMED** once you have
spot-checked the migration in the Lovable Cloud backend and the drift-guard
test reports green locally.
