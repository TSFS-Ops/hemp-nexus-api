# P-5 Batch 8 — Provider-Ready Structures & External Dependency Labelling

Evidence pack — Phases 1 and 2.

Current status marker: `P5_BATCH8_PHASE_2_DEPLOYED`

---

## Phase 2 — DB persistence (additive only)

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
