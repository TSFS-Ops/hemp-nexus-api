# P-5 Batch 7 — API, Dashboards & Visibility

**Final status:** `P5_BATCH7_DEPLOYED`
**Window:** Phase 1 → Phase 6 (2026-06-26)
**Scope ring-fence:** Strictly additive. No mutations to Batch 1–6 tables,
RPCs, policies, cron jobs or edge functions. No Batch 8 tokens introduced.

---

## Phase-by-phase artefacts

### Phase 1 — SSOT / Status / Visibility Registry
- `src/lib/p5-batch7/registry.ts` — locks dashboards, roles, API v1 allow-list,
  forbidden-field block-list, external status vocabulary, approved/banned
  wording, audit event names, export types and stale thresholds.
- `scripts/check-p5-batch7-forbidden-wording.mjs`
- `scripts/check-p5-batch7-no-batch8.mjs`
- `scripts/check-p5-batch7-registry-parity.mjs`
- `.lovable/plan.md` (Batch 7 plan recorded)

### Phase 2 — DB / RLS / Audit / Visibility Foundations
- Migration `supabase/migrations/20260626111350_*.sql`
- Tables (all `public.p5b7_*`, RLS on, explicit GRANTs, no `anon`):
  `p5b7_saved_views`, `p5b7_dashboard_actions_audit`, `p5b7_export_jobs`,
  `p5b7_export_audit`, `p5b7_api_field_visibility`,
  `p5b7_provider_dependencies`, `p5b7_stale_data_thresholds`.
- Append-only triggers (`p5b7_block_mutation_append_only`) on both audit
  tables (block `UPDATE` and `DELETE`).
- SECURITY DEFINER RPCs (search_path = public, REVOKE FROM PUBLIC):
  `p5b7_upsert_saved_view`, `p5b7_delete_saved_view`,
  `p5b7_record_dashboard_action`, `p5b7_create_export_job`.
- Seeds from the Phase 1 registry (45 visibility rows, 8 stale thresholds,
  4 provider rows).
- `scripts/check-p5-batch7-phase-2-db.mjs`

### Phase 3 — API v1 Visibility Layer (read-only)
- Migration `supabase/migrations/20260626113456_*.sql`
- 8 `p5b7_api_v1_*` SECURITY DEFINER read functions, including
  `p5b7_api_v1_resolve_scope`, `p5b7_api_v1_list_cases`,
  `p5b7_api_v1_get_case`, `p5b7_api_v1_compute_stale`.
- `src/lib/p5-batch7/api-v1.ts` — projection helper (`projectToApiV1`)
  enforcing the Phase 1 allow-list and throwing on any forbidden field.
- `src/tests/p5-batch7-api-v1-no-leak.test.ts` — leak-prevention tests.
- `scripts/check-p5-batch7-phase-3-api.mjs`

### Phase 4 — Dashboard Shells & Role-Based Routes
- `src/components/p5-batch7/DashboardShell.tsx` (shared shell, masked
  sensitive-field renderer, stale banner, loading/empty/error states).
- 7 pages under `src/pages/{admin,desk,funder}/p5-batch7/*Dashboard.tsx`.
- Routes registered in `src/App.tsx` with `RequireAuth` (admin surfaces
  also gated `role="platform_admin"`).
- `scripts/check-p5-batch7-phase-4-ui.mjs`

### Phase 5 — Dashboard Actions, Exports & Audit
- Migration `supabase/migrations/20260626120124_*.sql`
- New SECURITY DEFINER RPCs:
  `p5b7_list_saved_views`, `p5b7_list_my_export_jobs`,
  `p5b7_list_dashboard_audit`, `p5b7_list_export_audit`,
  `p5b7_acknowledge_stale_data`, `p5b7_log_sensitive_field_reveal`.
- `src/lib/p5-batch7/actions.ts` — sole client gateway to Batch 7 RPCs.
- `src/components/p5-batch7/ActionBar.tsx` — saved-view + export UI.
- `src/components/p5-batch7/StaleAckBanner.tsx` — audited stale-data ack.
- `src/pages/admin/p5-batch7/AuditDashboard.tsx` wired to
  `p5b7_list_dashboard_audit` (platform_admin only).
- `src/pages/admin/p5-batch7/ControlDashboard.tsx` wired to ActionBar +
  StaleAckBanner + `p5b7.dashboard.viewed` audit.
- `src/tests/p5-batch7-phase-5-actions.test.ts`
- `scripts/check-p5-batch7-phase-5-actions.mjs`

### Phase 6 — Cross-Consistency QA / Closure
- `scripts/check-p5-batch7-phase-6-qa.mjs`
- This evidence README.

---

## Routes & guards

| Route | Surface | Role gate |
| --- | --- | --- |
| `/admin/p5-batch7/control-dashboard` | admin | `platform_admin` |
| `/admin/p5-batch7/compliance-dashboard` | admin | `platform_admin` |
| `/admin/p5-batch7/api-dashboard` | admin | `platform_admin` |
| `/admin/p5-batch7/provider-dashboard` | admin | `platform_admin` |
| `/admin/p5-batch7/audit-dashboard` | admin | `platform_admin` |
| `/desk/p5-batch7/org-dashboard` | tenant | `RequireAuth` + server-side org scope |
| `/funder/p5-batch7/funder-dashboard` | funder | `RequireAuth` + server-side funder scope |

All seven pages share `P5B7DashboardShell` and never read/write
`p5b7_*` tables directly. Every Batch 7 client RPC call passes through
`src/lib/p5-batch7/actions.ts`.

---

## DB / RLS / RPC summary

- 7 new tables, all `public.p5b7_*`, RLS enabled, explicit GRANTs to
  `authenticated`/`service_role` only. No `anon` grants anywhere.
- 11 SECURITY DEFINER RPCs total (4 Phase 2 write/audit, 8 Phase 3 read,
  6 Phase 5 list/audit-write). Every function pins
  `search_path = public` and `REVOKE EXECUTE FROM PUBLIC`.
- `p5b7_dashboard_actions_audit` and `p5b7_export_audit` are append-only
  via `BEFORE UPDATE/DELETE` triggers.
- No `pg_cron` schedules, no new edge functions, no Batch 1–6 table
  mutations, no changes to existing policies.

---

## API v1 response summary

- Envelope shape: `{ data, page, page_size, total_count, next_cursor, as_of, is_stale, api_version: "v1", error }`.
- Field allow-list (25 fields) and forbidden block-list (20 tokens) live
  in `registry.ts` and are mirrored in DB seeds and in the
  `projectToApiV1` helper. Any forbidden field detected throws.
- Stale state derived from `as_of` and per-surface thresholds.
- Scope: admin/auditor see all (subject to role check); `org_user` is
  restricted to `linked_company_id`; `funder_user` is restricted to
  cases where `funder_status IS NOT NULL` (see *Known limitations*).

---

## Dashboard / action / export summary

- **Audit events emitted:** `p5b7.dashboard.viewed`,
  `p5b7.saved_view.{created,updated,deleted}`,
  `p5b7.export.requested` (server), `p5b7.stale_data.acknowledged`,
  `p5b7.sensitive_field.revealed`. All via append-only audit tables.
- **Saved views:** Per-user scoped via RLS + `auth.uid()` predicate.
  CRUD only via the three Phase 2/5 RPCs. Filters/sort serialised as JSON.
- **Exports:** Metadata-only rows (no payload generation in Batch 7).
  Permission gating: (a) role membership in
  `P5_BATCH7_EXPORT_DEFINITIONS.authorised_roles`, (b) dashboard ↔
  export-type match, (c) reason ≥10 chars where
  `requires_reason: true`. Server re-validates at the RPC boundary.
- **Sensitive-field reveal:** `p5b7_log_sensitive_field_reveal` requires
  `platform_admin` and a ≥10-char reason; emits
  `p5b7.sensitive_field.revealed`. The RPC **never returns the
  underlying value** — no unmask source exists in Batch 7 and none was
  invented.
- **Stale-data acknowledgement:** `p5b7_acknowledge_stale_data` requires
  a ≥5-char reason and emits `p5b7.stale_data.acknowledged`.
- **Audit dashboard:** Reads via `p5b7_list_dashboard_audit`
  (platform_admin only). Provider/API dashboards read via the
  Phase 3 safe projections only.

---

## Known limitations

- **Funder visibility granularity (carried from Phase 3).** Funder
  scoping is currently coarse — any case with
  `funder_status IS NOT NULL` is visible to authenticated funder users.
  No per-case funder grant table has been introduced in Batch 7. The
  Funder Dashboard surfaces a visible disclaimer banner. This must be
  tightened by a future batch with an authoritative per-case grant
  model. Funder users do **not** have access to: dashboard audit,
  export audit, sensitive-reveal RPC, other tenants' saved views,
  other tenants' exports, raw evidence, reviewer-only commentary,
  Memory internals or raw provider payloads.
- **Conceptual auditor role mapping.** Batch 7 introduced the
  conceptual roles `operations_admin`, `compliance_owner`, `reviewer`,
  `auditor`, etc. only at the registry/visibility layer. At the RPC
  boundary they currently map onto `platform_admin` + ownership
  predicates. The `app_role` enum was deliberately not extended. When
  a dedicated `auditor` role exists, `p5b7_list_dashboard_audit` and
  `p5b7_list_export_audit` should be widened without changing callers.
- **Batch 5 / Batch 6 authority preserved.** Finality
  (`p5_batch4_finality_records`), Memory (`p5_batch5_memory_records`)
  and exceptions/disputes (`p5b6_*`) remain owned by their batches.
  Batch 7 only reads safe projections; no mutation, duplication or
  shadow store was introduced.

---

## Final guard / test results

```
node scripts/check-p5-batch7-forbidden-wording.mjs   → OK
node scripts/check-p5-batch7-no-batch8.mjs            → OK
node scripts/check-p5-batch7-registry-parity.mjs      → OK
node scripts/check-p5-batch7-phase-2-db.mjs           → OK
node scripts/check-p5-batch7-phase-3-api.mjs          → OK
node scripts/check-p5-batch7-phase-4-ui.mjs           → OK
node scripts/check-p5-batch7-phase-5-actions.mjs      → OK
node scripts/check-p5-batch7-phase-6-qa.mjs           → OK

vitest src/tests/p5-batch7-api-v1-no-leak.test.ts     → 5/5 passed
vitest src/tests/p5-batch7-phase-5-actions.test.ts    → 6/6 passed
```

---

## Final status

**`P5_BATCH7_DEPLOYED`** — Batch 7 (API, Dashboards & Visibility) is
complete. Batch 8 is explicitly out of scope and has not been
started.
