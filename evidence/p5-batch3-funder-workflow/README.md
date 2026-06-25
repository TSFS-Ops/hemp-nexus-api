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

## Stage 3 — Server-authoritative RPC layer (COMPLETE)

Marker: **P5_BATCH_3_STAGE_3_COMPLETE**

### Migration
- `supabase/migrations/<timestamp>_p5_batch3_stage3_rpcs.sql` (approved
  and applied) adds:
  - Helper `p5b3_actor_role()` — funder ↔ internal disjoint actor model.
  - Internal audit writer `p5b3_audit(...)` (service_role only).
  - Admin RPCs: `p5b3_admin_create_funder_org_v1`, `_update_funder_org_v1`,
    `_invite_funder_user_v1`, `_assign_funder_role_v1`,
    `_set_funder_user_status_v1`, `_create_access_grant_v1`,
    `_release_pack_version_v1`, `_change_grant_expiry_v1`,
    `_revoke_grant_v1`, `_reactivate_grant_v1`,
    `_edit_request_external_text_v1`, `_decide_request_v1`,
    `_review_outcome_v1`, `_exit_review_v1`.
  - Funder RPCs: `p5b3_funder_submit_request_v1`,
    `p5b3_funder_submit_outcome_v1`,
    `p5b3_funder_record_download_v1`.
  - All RPCs are `SECURITY DEFINER`, `SET search_path = public`, with
    `EXECUTE` revoked from `PUBLIC`/`anon` and granted only to
    `authenticated, service_role`.
  - All admin RPCs assert `p5b3_is_platform_admin()`.
  - Access grant RPC rejects missing expiry, missing release reason,
    missing evidence_pack_id+version, and past-dated expiry.
  - Funder outcome RPC explicitly emits `finality_created: false` in
    audit — funder approval never creates finality directly.
  - Deactivating a funder user cascades to revoking that user's active
    grants (reason recorded).

### Edge function (Stage 3 scope)
- `supabase/functions/p5-batch3-funder-summary/index.ts` — internal
  dashboard/funder-readiness use only. **Not** a public funder API
  endpoint. Validates the caller JWT, looks up an active non-expired
  grant via RLS-protected SELECTs, returns only allow-listed fields,
  applies the provider-wording allow-list, and default-masks bank
  values. Expired/revoked grants return `{ denied: true, … }`.

### RPC client
- `src/lib/p5-batch3/rpc.ts` — thin TS wrappers. The `P5B3_RPC_NAMES`
  list is the SSOT used by Stage 3 contract tests.

### SQL proof
- `supabase/tests/p5_batch3_rpc_proof.sql` — `BEGIN … ROLLBACK` block
  with 12 assertions. Final notice on success: **`P5B3_STAGE3_PROOF_OK`**.
- Run command:
  ```sh
  psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/p5_batch3_rpc_proof.sql
  ```
- Expected tail:
  ```
  NOTICE:  P5B3_STAGE3_PROOF_OK
  DO
  ROLLBACK
  ```

### Tests added
- `src/tests/p5-batch3-stage3-rpc-contracts.test.ts` (8) — RPC names,
  SECURITY DEFINER + search_path, admin gating, validation invariants,
  EXECUTE lockdown.
- `src/tests/p5-batch3-stage3-edge-summary-static.test.ts` (7) — no
  public API path, JWT required, no raw sensitive column selection,
  expired/revoked grant denial, provider-wording allow-list, default
  bank masking, allow-list filter.
- `src/tests/p5-batch3-stage3-isolation.test.ts` (7) — Stage 1/2/3
  isolation guards green, no notifications/cron/UI/finality-bridge
  added.

### Guard
- `scripts/check-p5-batch3-stage3-isolation.mjs` — forbids Stage 4+
  surfaces (UI, hooks, notifications, sla-rules, finality/readiness
  bridge), pins the Batch 3 edge-function allow-list to
  `["p5-batch3-funder-summary"]`, blocks any real
  `/api/v1/funder` route registration, blocks mutation references to
  Batch 1/2 business tables, and blocks Batch 3 cron blocks in
  `supabase/config.toml`.
- Stage 1 + Stage 2 guards updated to permit the legitimate Stage 3
  additions (one extra migration, the safe summary edge fn, and
  `rpc.ts`) — no other Batch 3 surfaces are allowed.

### Results
- Batch 3 cumulative test suite: **82/82 green** (17 + 42 + 23, all
  files under `src/tests/p5-batch3-*`).
- `P5_BATCH_3_STAGE_3_ISOLATION_OK` ✅
- `P5_BATCH_3_STAGE_2_ISOLATION_OK` ✅ (re-checked, still green)
- `P5_BATCH_3_STAGE_1_ISOLATION_OK` ✅ (re-checked, still green)
- No Batch 1/2 files, tables, RPCs, edge functions or summary clients
  modified.
- No `trade_requests` / `pois` / `wads` / `token_ledger` /
  `token_balances` / `business_decisions` / `payment_disputes` rows
  mutated by any Batch 3 path (negatively asserted in SQL proof
  Assertion 11).
- Stage 4 NOT started.
