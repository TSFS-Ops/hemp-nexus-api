# P-5 Batch 3 — Funder Workflow & Funder Access

Disciplined 6-stage build mirroring P-5 Batch 2. Each stage stops for sign-off.

## Stage 1 — DB foundation, enums, RLS, GRANTs, drift guard

**Marker:** `P5_BATCH_3_STAGE_1_COMPLETE`

### Scope (delivered)
- New enums (all under `p5_batch3_*`):
  - `p5_batch3_funder_role`
  - `p5_batch3_funder_org_status`
  - `p5_batch3_funder_user_status`
  - `p5_batch3_access_grant_status`
  - `p5_batch3_funder_status`
  - `p5_batch3_request_status`
  - `p5_batch3_request_category`
  - `p5_batch3_outcome_type`
  - `p5_batch3_exit_reason`
- New tables (all under `p5_batch3_*`, all RLS-enabled, all granted):
  - `p5_batch3_funder_organisations`
  - `p5_batch3_funder_users`
  - `p5_batch3_funder_access_grants` — per-transaction scoped, role-bound,
    evidence-pack-version-bound, expiry-bound, revocation-aware.
  - `p5_batch3_funder_requests` — preserves `original_message`; admin
    moderates via `admin_external_message` and `admin_decision`.
  - `p5_batch3_funder_outcomes` — funder-specific outcomes that require
    admin review before they can feed finality.
  - `p5_batch3_funder_audit_events` — append-only.
  - `p5_batch3_funder_downloads` — append-only download log with watermark.
- SECURITY DEFINER helpers (search_path locked, EXECUTE revoked from
  `PUBLIC`/`anon`, granted to `authenticated` + `service_role`):
  - `p5b3_is_platform_admin()`
  - `p5b3_current_funder_org()`
  - `p5b3_has_active_grant(text)`
- Updated-at trigger helper `p5b3_set_updated_at()` (service_role only).

### Access rules
- **Platform admin** — full read/write on all 7 tables.
- **Funder user** — only sees:
  - own funder organisation row;
  - fellow funder-org users;
  - access grants where they are the named user AND the grant is
    `status='active'` AND `expiry_at > now()` AND `revoked_at IS NULL`;
  - requests / outcomes / audit / downloads tied to one of their own
    active, non-expired grants (cross-funder leakage impossible).
- **No funder user has any INSERT/UPDATE/DELETE policy.** All Stage 3
  writes will route through SECURITY DEFINER RPCs.
- Audit and download tables have **no DML policies at all** for
  authenticated; only `service_role` can write.

### Guards & tests added
- `src/tests/p5-batch3-stage1-enum-drift.test.ts` — TS ↔ Postgres enum
  drift guard for all 9 enums.
- `src/tests/p5-batch3-stage1-schema-isolation.test.ts` — proves table
  prefix, RLS, GRANT shape, no DML policies for funders, audit/downloads
  append-only, no Batch 1/2/business-row mutation.
- `scripts/check-p5-batch3-isolation.mjs` — static guard: no Batch 3
  edge function, no Batch 3 UI/hook/route present yet, no Batch 1/2
  internal-RPC imports inside Batch 3 source.

### Out of scope for Stage 1 (intentionally NOT delivered)
- No UI, no routes, no hooks, no React components.
- No RPCs, no edge functions, no notifications, no cron.
- No funder API endpoints, no `/api/v1/funder/*`.
- No Batch 1 readiness wiring, no Batch 2 RPC/edge/summary-client changes.
- No mutation of any trade / POI / WaD / billing / payment / ledger /
  token / business-decision row.

### Verification
- Migration applied successfully (two migration files for tables + EXECUTE
  lockdown).
- Security linter reduced from 242 → 239 issues post-Batch-3 (the three
  new `0028_anon_security_definer_function_executable` warnings raised
  for the Batch 3 helpers were closed by the EXECUTE lockdown migration).
  All remaining 239 issues are pre-existing project-wide warnings that
  predate Batch 3 and are out of scope for this stage.

## Stage 2 — Pure TypeScript Logic (COMPLETE)

Marker: **P5_BATCH_3_STAGE_2_COMPLETE**

### Modules added (`src/lib/p5-batch3/`)
- `roles.ts` — internal vs funder vs api-client categorisation; funder roles never inherit internal permissions.
- `permissions.ts` — funder capability matrix (view/do/never) per role; never-list enforced.
- `access-grants.ts` — active/expired/revoked/pending + org/user/tx/pack-version scoping + cross-funder isolation.
- `visibility.ts` — released-field allow-list, blocked raw/admin/internal/provider/other-funder fields, default bank masking.
- `downloads.ts` — released-PDF only, admin release + watermark, 7-day TTL, revocation invalidation, raw export hard block.
- `request-lifecycle.ts` — 11-state transition table; original request text preserved on admin edit.
- `outcomes.ts` — outcome → funder-status map; funding/term-sheet/conditional flagged for admin review.
- `exit-revocation.ts` — exit triggers, reinstatement gated on platform_admin + reason + new expiry.
- `multi-funder.ts` — per-funder scoping; sibling funders never visible or mutated.
- `provider-wording.ts` — safe label allow-list, unsafe label block unless live provider result or approved manual decision.
- `api-fields.ts` — API allow-list ⊆ dashboard allow-list; raw/internal fields blocked.
- `readiness-eligibility.ts` — funder action feeds but never alone reaches finality; Memory excludes private/unreleased credit material.

### Tests
- `src/tests/p5-batch3-stage2-logic.test.ts` — 40 tests across all modules.
- `src/tests/p5-batch3-stage2-isolation.test.ts` — 2 tests asserting Stage 1 + Stage 2 isolation guards pass.

### Guard
- `scripts/check-p5-batch3-stage2-isolation.mjs` — forbids UI, RPCs, edge fns, summary clients, notifications, cron, supabase client/rpc/invoke imports, App.tsx route changes, and limits Batch 3 migrations to the two Stage 1 files.

### Results
- Stage 2 + Stage 1 Batch 3 suite: **59/59 green** (40 + 2 + 9 + 8).
- `P5_BATCH_3_STAGE_2_ISOLATION_OK` ✅
- `P5_BATCH_3_STAGE_1_ISOLATION_OK` ✅ (re-checked, still green).
- Stage 3 NOT started.
