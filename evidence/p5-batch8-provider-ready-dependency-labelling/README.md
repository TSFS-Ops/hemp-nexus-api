# P-5 Batch 8 — Provider-Ready Structures & External Dependency Labelling

Evidence pack — Phases 1 and 2.

Current status marker: `P5_BATCH8_PHASE_2_DEPLOYED`

---

## Phase 2 — DB persistence (additive only)

Phase 2 ships the persistence layer that mirrors the Phase 1 SSOT.
It is **additive only** — no destructive schema changes, no UI, no
RPC write path, no API-safe projection, no edge functions, no cron,
no live provider calls, no provider credentials, no payment-provider
behaviour changes, no Batch 6 / Batch 7 changes, no Memory or
finality mutation, no `app_role` enum widening.

### Migration

| File | Purpose |
| --- | --- |
| `supabase/migrations/20260626165809_816d0395-b66b-4492-84a0-8e7f4fb2a2ef.sql` | Creates the 10 `p5b8_*` tables, append-only triggers, `updated_at` trigger, CHECK constraints mirroring the SSOT, RLS, GRANTs and read policies. |

### Tables created (all `public.p5b8_*`)

| Table | Append-only | Sensitive admin-only columns | Purpose |
| --- | --- | --- | --- |
| `p5b8_provider_configs` | no | — | One row per provider category, including ownership, preferred providers, fallback, `live_now` (gated by sign-off). |
| `p5b8_provider_activation_signoffs` | yes | — | Append-only sign-off history (who/when/note/evidence ref). |
| `p5b8_provider_dependency_status` | no | — | Per-subject / per-case dependency state, environment, stale flag. |
| `p5b8_provider_requests` | no | — | Outbound provider request log; no credentials stored. |
| `p5b8_provider_results` | no | `raw_provider_payload_admin_only` | Provider result records; raw payload kept off API-safe column grant. |
| `p5b8_provider_decisions` | no | — | Decision state per result; `is_fallback`, `is_final`. |
| `p5b8_webhook_events_ledger` | yes | `raw_webhook_payload_admin_only` | Webhook intake with idempotency key, signature status. |
| `p5b8_audit_events` | yes | — | Append-only `p5b8.*` audit log. |
| `p5b8_provider_retry_state` | no | — | Retry, failure and fallback tracking. |
| `p5b8_memory_finality_links` | yes | — | Link-only references to existing Memory / finality rows. Never mutates Batch 5 tables. |

### Constraints, functions, triggers

- **CHECK constraints** mirror the Phase 1 SSOT vocabulary literally:
  9 provider categories, 10 dependency states, 10 decision states,
  17 webhook events, 30 audit events (also enforced via the `p5b8.*`
  prefix constraint).
- `p5b8_pc_live_requires_signoff` ensures `live_now = true` is only
  possible with `activation_signed_off_at` and `activation_signed_off_by`
  populated — preserving the **provider-ready vs live-connected vs
  result-received vs provider-verified** distinction at the DB layer.
- `p5b8_block_mutation_append_only()` — `SECURITY DEFINER`,
  `SET search_path = public`, `REVOKE EXECUTE FROM PUBLIC` — blocks
  `UPDATE` / `DELETE` on every append-only table.
- `p5b8_set_updated_at()` — same hardening — maintains `updated_at` on
  mutable tables.

### SSOT mirroring

The Phase 1 SSOT (`src/lib/p5-batch8/registry.ts`) is the single
source of vocabulary; the migration's CHECK constraints reproduce
each value literally. The guard script
(`scripts/check-p5-batch8-phase-2-db.mjs`) re-reads the registry and
fails if any term is missing from the SQL.

### RLS & GRANT summary

- Every new table has RLS enabled.
- Every new table has `GRANT … TO authenticated` and
  `GRANT ALL … TO service_role`.
- **No `anon` grants on any p5b8 table.**
- Read policies are gated on `has_role(auth.uid(), 'platform_admin')`
  (and where relevant `compliance_analyst`, `api_admin`). Funder users
  and tenant users have no read access in this phase.
- **No client-side write policies on any p5b8 table.** All writes are
  reserved for the service role; the RPC write path is a Phase 3
  concern.

### Sensitive-field handling

- `raw_provider_payload_admin_only` and `raw_webhook_payload_admin_only`
  use the `_admin_only` suffix and are **excluded from the column-level
  GRANT to `authenticated`** — only `service_role` can read them.
- The forbidden-external-field list (Phase 1 SSOT) remains the
  authoritative blocklist for any future API-safe projection.

### Memory / finality link-only confirmation

- `p5b8_memory_finality_links` stores foreign keys to Memory or
  finality rows only.
- The migration contains **no `INSERT` / `UPDATE` / `DELETE` against
  `p5_batch5_memory_records` or `p5_batch4_finality_records`** —
  verified by the Phase 2 guard.

### Guards / tests run

- `node scripts/check-p5-batch8-phase-2-db.mjs` → **OK** (10 tables, 10 policies, 4 append-only triggers, 2 SECURITY DEFINER helpers, 76 SSOT terms mirrored, no client-writes, no anon, no Memory/finality mutation, no Batch 6/7 leakage).
- `bunx vitest run src/tests/p5-batch8-phase-2-db.test.ts` → **21 / 21 pass**.
- `node scripts/check-p5-batch8-phase-1-registry.mjs` → **OK** (Phase 1 still clean; Phase 2 migration was excluded from the Phase 1 leakage check by using the `p5b8_` table-prefix and the registry SSOT unchanged).

### Non-scope confirmation (Phase 2)

- No UI routes, pages or components.
- No RPC write path.
- No API-safe projection / read layer.
- No edge functions.
- No `pg_cron` schedules.
- No live provider calls.
- No provider credentials, keys or secrets stored.
- No payment-provider behaviour changes.
- No Batch 6 or Batch 7 surfaces modified.
- No Memory or finality table mutation.
- No `app_role` enum widening (Phase 2 reuses existing
  `platform_admin`, `compliance_analyst`, `api_admin`).

### Status marker

`P5_BATCH8_PHASE_2_DEPLOYED`

---

## Phase 1 — SSOT registry

Status marker: `P5_BATCH8_PHASE_1_DEPLOYED`

## Scope of Phase 1

Phase 1 ships **only** the single source of truth (SSOT) registry plus
its contract tests, drift guard and this evidence README.

Phase 1 **does not** include any of the following:

- DB migrations
- RPCs / stored procedures
- UI routes, pages or components
- Edge functions
- pg_cron jobs
- Live provider calls
- Provider credentials, keys or secrets
- Payment-provider configuration changes
- Memory or finality mutations
- Batch 6 modifications
- Batch 7 surfaces

## Source of truth

Client-signed answers to the Batch 8 questionnaire:
*"Izenzo P-5 Batch 8 — Provider-Ready Structures and External
Dependency Labelling — Client Input Questionnaire"*.

## Artefacts created in Phase 1

| Path | Purpose |
| --- | --- |
| `src/lib/p5-batch8/registry.ts` | SSOT — provider categories, provider-ready definition, dependency states, decision states, webhook events, audit events, allowed wording, banned wording, API-safe fields, forbidden external fields, ownership roles, Memory/finality gating, failure policy, hidden-until-live items, Phase-1 scope guard. |
| `src/tests/p5-batch8-phase-1-registry.test.ts` | Contract tests pinning registry shape, prefixes, uniqueness and cross-references. |
| `scripts/check-p5-batch8-phase-1-registry.mjs` | Drift guard — verifies required exports, scans for banned wording / forbidden fields in Batch 8 source, and confirms no DB / RPC / UI / edge / cron / Batch 6 / Batch 7 leakage. |
| `evidence/p5-batch8-provider-ready-dependency-labelling/README.md` | This file. |

## SSOT vocabulary counts

| Registry | Count |
| --- | --- |
| `P5_BATCH8_PROVIDER_CATEGORIES` | 9 |
| `P5_BATCH8_PROVIDER_DEPENDENCY_STATES` | 10 |
| `P5_BATCH8_PROVIDER_RESULT_DECISION_STATES` | 10 |
| `P5_BATCH8_WEBHOOK_EVENTS` | 17 |
| `P5_BATCH8_AUDIT_EVENTS` | 30 |
| `P5_BATCH8_ALLOWED_EXTERNAL_WORDING` | 16 |
| `P5_BATCH8_BANNED_EXTERNAL_WORDING` | 21 |
| `P5_BATCH8_API_SAFE_FIELDS` | 17 |
| `P5_BATCH8_FORBIDDEN_EXTERNAL_FIELDS` | 24 |
| `P5_BATCH8_OWNER_ROLES` | 18 |
| `P5_BATCH8_HIDDEN_UNTIL_LIVE` | 14 |

## Memory / finality gating rules

Captured in `P5_BATCH8_MEMORY_AND_FINALITY_GATING`:

- A provider result alone is never sufficient to drive finality.
- A provider result alone is never sufficient to write Memory.
- Test-mode results never feed Memory, finality or external readiness.
- Test webhooks never update readiness.
- Memory-eligible decision states (when final): `clear`,
  `confirmed_match`, `false_positive`, `waived`, `blocked`.
- Decision states blocked from Memory: `potential_match`,
  `manual_review`, `incomplete`, `provider_unavailable`, `superseded`.
- Manual fallback decisions must be labelled "manual fallback
  decision", never "live provider verified".

## Known limitations

- **No live providers connected.** Every provider category has
  `live_now: false`. Live integration requires a separate phase with
  credentials, activation sign-off and webhook verification.
- **Funder dependency** is treated as a provider-style external
  dependency, but is not a verification provider in the conventional
  sense.
- **Bank verification** ownership is shared with the bank; activation
  sign-off cannot be completed by Izenzo alone.

## Guards / tests

- `node scripts/check-p5-batch8-phase-1-registry.mjs`
- `bunx vitest run src/tests/p5-batch8-phase-1-registry.test.ts`

## Final marker

`P5_BATCH8_PHASE_1_DEPLOYED`
