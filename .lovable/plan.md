# P-5 Batch 7 — API, Dashboards & Visibility — Phased Plan

**Status:** Plan only. No code until approved.
**Scope lock:** Batch 7 only. No Batch 8 leakage. No cron. No new write models for Batch 6 surfaces. Reuse Batch 5 finality/Memory and Batch 6 exceptions as read-only sources.

---

## Phase 1 — SSOT / Status / Visibility Registry

**Deliverable:** A single TypeScript registry file (`src/lib/p5-batch7/registry.ts`) plus a drift guard, with zero runtime side effects.

Locks:

- The seven approved dashboards and their routes
- Role → dashboard access matrix (platform_admin, operations_admin, compliance_owner, reviewer, org_user, funder_user, api_client, auditor)
- API-visible field allow-list (stable, versioned `v1`)
- Hidden / internal-only field block-list (raw provider payloads, internal notes, private risk commentary, credentials, unapproved AI output, hidden audit metadata, sensitive Memory internals)
- Status vocabulary (case, evidence, blocker, exception, hold, finality, Memory, API key, export)
- Approved external wording + banned wording list
- Audit event names for dashboard actions, exports, overrides, key actions, config changes, finality events
- Export/report types and their allowed roles
- Stale-data thresholds and refresh rules
- Saved-view shapes

Guards added: `scripts/check-p5-batch7-registry-parity.mjs`, `scripts/check-p5-batch7-forbidden-wording.mjs`, `scripts/check-p5-batch7-no-batch8.mjs`.

No DB, no UI.

---

## Phase 2 — DB / RLS / Audit / Visibility Foundations

**Deliverable:** One additive migration. No changes to prior-batch tables.

New tables (all `public.p5b7_*`, all RLS enabled, all with explicit GRANTs):

- `p5b7_saved_views` — per-user saved dashboard filters
- `p5b7_dashboard_actions_audit` — append-only audit of dashboard actions
- `p5b7_export_jobs` — controlled export records (metadata only, no payload)
- `p5b7_export_audit` — append-only export audit
- `p5b7_api_field_visibility` — registry mirror, for runtime API enforcement
- `p5b7_provider_dependencies` — provider/dependency status snapshot (read source for admin dashboard)
- `p5b7_stale_data_thresholds` — config table seeded from registry

All write paths through `SECURITY DEFINER` RPCs with pinned `search_path=public`, `REVOKE EXECUTE FROM PUBLIC`, GRANT to `authenticated` (or `service_role` for admin-only).

Append-only triggers on audit/export tables. No new finality / Memory / dispute tables — Batch 5 + Batch 6 remain authoritative.

---

## Phase 3 — API Visibility Layer (v1)

**Deliverable:** Versioned read-only projection layer for API clients.

- `p5b7_api_v1_*` SECURITY DEFINER read functions returning only the Phase 1 allow-listed fields
- Stable status values mapped from internal vocab to external vocab
- Stale-data flagging in API response (`is_stale`, `as_of`)
- Error envelope for not-found / forbidden / stale / unavailable-provider
- Scope enforcement: api_client sees only own org's cases; funder_user sees only granted scope
- Tests proving zero internal-only fields appear in any v1 RPC output

No edge functions added beyond what already exists for API surface. No auto-send. No write endpoints.

---

## Phase 4 — Dashboard Shells & Role-Based Routes

**Deliverable:** Seven dashboards registered in `src/App.tsx`, all wrapped in `RequireAuth` with role guards.

Routes:

- `/admin/p5-batch7/control-dashboard` — platform_admin, operations_admin, compliance_owner
- `/admin/p5-batch7/compliance-dashboard` — compliance_owner, reviewer
- `/admin/p5-batch7/api-dashboard` — platform_admin
- `/admin/p5-batch7/provider-dashboard` — platform_admin, operations_admin
- `/desk/p5-batch7/org-dashboard` — org_user
- `/funder/p5-batch7/funder-dashboard` — funder_user
- `/admin/p5-batch7/audit-dashboard` — auditor, platform_admin

Shared components: summary cards, filter bar, saved-view selector, detail-section frame, safe empty/loading/error states, stale-data banner, sensitive-field masked renderer.

Reads only via Phase 3 projections + Batch 4/5/6 safe projections. Zero direct `p5b7_*` table reads.

---

## Phase 5 — Dashboard Actions, Exports & Audit

**Deliverable:** Permitted actions wired through Phase 2 SECURITY DEFINER RPCs.

- Save / load / delete saved views (per-user only)
- Trigger export (metadata only; allowed types per role; reason required for admin exports ≥10 chars)
- Sensitive-field reveal (audited, role-gated)
- Acknowledge stale-data warning (audited)
- No bulk overrides, no waiver mutations, no finality mutations, no Memory mutations (Batch 5/6 remain authoritative)

Every action writes a `p5b7_dashboard_actions_audit` row. Every export writes a `p5b7_export_audit` row plus the existing generic export audit.

---

## Phase 6 — Cross-Consistency QA & Final Guards

**Deliverable:** Test + guard suite, all green, plus evidence README.

- `scripts/check-p5-batch7-phase-6-qa.mjs` — aggregate guard (no cron, no edge-fn additions, no Batch 8 tokens, all 7 routes registered & role-wrapped, zero direct `p5b7_*` UI reads, zero forbidden-field references in UI, zero banned wording)
- `src/tests/p5-batch7-*.test.ts` — vitest suite covering registry parity, RBAC matrix, API non-leakage (every internal field absent from v1 output), export role gating, stale-data behaviour, audit coverage
- `.github/workflows/batch-7-guards.yml` — extend existing workflow to include Phase 6 guard + new tests
- Evidence folder `evidence/p5-batch7-api-dashboards-visibility/README.md` with phase-by-phase artefact list
- Final status marker `P5_BATCH7_DEPLOYED`

Stop after Phase 6. No Batch 8 work.

---

## Non-goals (explicit)

- No changes to Batch 1–5 behaviour
- No changes to Batch 6 write paths
- No new cron jobs
- No new edge functions for auto-send / provider calls
- No duplicate finality / Memory / dispute systems
- No raw payloads, credentials, internal notes, private risk commentary or hidden audit metadata in any API or dashboard surface
- No Batch 8 dashboards, RPCs, tables or routes

---

## Approval requested

Please reply **"approved — start Phase 1"** to begin, or send edits to any phase.  
  
I would reply with this:

approved — start Phase 1

Please proceed with **Phase 1 — SSOT / Status / Visibility Registry** only.

The phased plan is approved on the basis that:

- Batch 7 remains strictly limited to API, Dashboards and Visibility;
- no Batch 8 work is started;
- no cron jobs are added;
- no new edge functions are added unless explicitly approved later;
- Batch 5 finality/Memory remains authoritative;
- Batch 6 exceptions remain authoritative;
- Batch 7 must not create duplicate finality, Memory, dispute or exception systems;
- all dashboard/API/export/status/wording rules must be locked into the Phase 1 registry first;
- all later phases must derive from that registry to prevent drift.

Please begin with the Phase 1 registry and guards, then report back with:

1. files created/changed;
2. registry contents summary;
3. guard scripts added;
4. test/guard results;
5. any conflicts found between the client’s answers and existing P-5 Batch 1–6 structures.

Do not proceed to Phase 2 until Phase 1 has been reported and accepted.