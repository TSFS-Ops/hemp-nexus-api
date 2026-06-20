# Batch 1 — Business Registry Foundation (M001 / M018 / M019)

Scope strictly limited to:

- **M001** — Business Registry shell (routes only, no records, no claim, no
  authority, no bank capture, no API, no outreach).
- **M018** — Business Decision Register (CRUD + audit history for governance
  decisions about country / data source / provider / public display /
  API output / outreach use / commercial use / institutional demo / wording).
- **M019** — Module Readiness / Product Truth Layer (10-state SSOT,
  matrix view, audited transitions).

No real or seed registry data has been ingested. No `verified` / `live` /
`production-ready` / `guaranteed` wording appears on any shell surface
(enforced by `scripts/check-registry-readiness-forbidden-words.mjs`).

## Shell routes

| Route | Purpose | Readiness |
| --- | --- | --- |
| `/registry` | Module landing | shell_ready |
| `/registry/search` | Public company search shell (no records) | shell_ready |
| `/registry/company/:id` | Company profile shell (no records) | shell_ready |
| `/registry/claim` | Claim placeholder | not_started |
| `/registry/readiness` | Client-safe readiness placeholder | not_started |
| `/admin/registry` | Admin registry tab shell | shell_ready |
| `/admin/registry/readiness` | M019 readiness matrix | shell_ready |
| `/admin/registry/decisions` | M018 business decision register | shell_ready |

## Seeded readiness matrix

All 19 modules are seeded. M001, M018, M019 are at `shell_ready`. The other
sixteen modules (M002–M017) are at `not_started` and may only be advanced by
`platform_admin` or `compliance_owner` via the
`registry-readiness-transition` edge function.

## Audit events

| Event name | Emitter | Aggregate |
| --- | --- | --- |
| `registry_readiness_state_changed` | `registry-readiness-transition` | `registry_module` |
| `business_decision_recorded` | `business-decision-record` (create) | `business_decision` |
| `business_decision_status_changed` | `business-decision-record` (update_status) | `business_decision` |
| `business_decision_superseded` | `business-decision-record` (supersede) | `business_decision` |

Every transition writes:

1. An append-only row in `registry_readiness_states` or
   `business_decision_events`.
2. A best-effort row in `event_store` for cross-aggregate replay.

## RLS posture

- `registry_modules` — read: all authenticated; write: `platform_admin` /
  `compliance_owner`.
- `registry_readiness_states` — read: all authenticated; insert: admin roles.
- `business_decisions` — read: admin/auditor roles, plus `is_public = true`;
  write: admin roles only.
- `business_decision_events` — read: admin/auditor roles; insert: admin roles.

## Guards

- `scripts/check-registry-readiness-parity.mjs` — TS ↔ Deno SSOT.
- `scripts/check-registry-readiness-forbidden-words.mjs` — blocks
  `verified` / `live` / `guaranteed` / `production-ready` on shell surfaces.
- `scripts/check-business-decision-audit-names.mjs` — SSOT parity + writer
  references all three canonical audit names.

## Tests

- `src/tests/batch-1-registry-foundation.test.ts` — SSOT integrity, parity,
  edge-function wiring, migration grants & RLS, shell copy hygiene.

## Out of scope (rejected if attempted in this batch)

- Real or seed company records, search results, profile data.
- Claim / authority / bank capture / API facade / outreach / human approval queue.
- Country coverage (M011), provenance (M010), import batches (M012).
- Provider integrations (CIPC, Onfido, bank verification, etc.).

These are explicitly deferred to Batches 2–6 and may only proceed once a
recorded business decision is in place for the relevant country, data source
or provider.
