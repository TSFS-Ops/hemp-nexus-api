# Batch 17 — Registry Admin Operations Centre

Status: BATCH_17_REGISTRY_ADMIN_OPERATIONS_CENTRE_COMPLETE

## What this batch delivers

A single admin cockpit for the controlled Business Registry. Builds on Batches
1–16 without weakening any accepted guardrail. Read-only aggregation only —
assignment writes are intentionally deferred to a follow-up so this batch
does not introduce new write paths.

### Routes (platform_admin guarded)

- `/admin/registry/operations` — cockpit dashboard (tiles)
- `/admin/registry/operations/queue` — unified work-item queue
- `/admin/registry/operations/slas` — SLA / age view
- `/admin/registry/operations/risk` — risk view
- `/admin/registry/operations/readiness` — readiness blocker view
- `/admin/registry/operations/audit` — safe audit activity view
- `/admin/registry/operations/legacy` — preserved access to the Batch 6 ops summary

### Edge functions (verify_jwt = false; admin-role enforced in code)

- `registry-operations-summary` → dashboard tiles
- `registry-operations-queue` → unified work-item queue (cursor paged, filterable)
- `registry-operations-risk` → safe risk items
- `registry-operations-slas` → SLA view (computed, never auto-approves)
- `registry-operations-readiness` → readiness blockers (uses Batch 1 readiness SSOT)
- `registry-operations-audit` → safe audit activity, payload-stripped

All edge functions require `platform_admin` OR `compliance_owner` (see
`supabase/functions/_shared/registry-operations-auth.ts`). Each emits a
`registry_operations_*_viewed` audit event into `event_store`.

### SSOT

- Browser: `src/lib/registry-operations-centre-ssot.ts`
- Deno mirror: `supabase/functions/_shared/registry-operations-centre.ts`
- Parity pinned by `scripts/check-batch-17-operations-ssot-parity.mjs`.

Covers: work item types, source modules, SLA states + default SLA hours,
severity, risk categories, tile codes, blocked reasons, dashboard labels,
empty-state copy, forbidden wording, forbidden raw-field list, accepted
specialist route map.

## Safety proofs

- **No raw bank exposure** — `scripts/check-batch-17-operations-no-raw-bank.mjs`
  scans all operations UI + edge functions for `account_number`, `iban`,
  `branch_code`, `swift`, `bic`, `account_holder`, `bank_code` in `.select(...)`
  calls and for `provider_payload`, `raw_provider_result`,
  `raw_provider_payload` references.
- **No full API key exposure** — same guard scans for `full_api_key`,
  `api_key_secret`, `secret_key`.
- **No provider payload exposure** — `registry-operations-audit` strips raw
  payload keys via the `FORBIDDEN_PAYLOAD_KEYS` allow-list approach and
  excludes nested objects.
- **No automatic approval wording** —
  `scripts/check-batch-17-operations-forbidden-words.mjs` bans
  `auto-approve`, `auto approve`, `automatically approve`, `auto-verify`,
  `guaranteed`.
- **No off-namespace links** —
  `scripts/check-batch-17-operations-route-safe.mjs` ensures every `<Link to="..."/>`
  in the operations centre points at `/admin/registry/*`.

## Role protection proof

Every operations route is wrapped in `<RequireAuth role="platform_admin" />`
in `src/App.tsx`. Every edge function calls `requireOpsAdmin(req)` which
checks `user_roles` for `platform_admin` or `compliance_owner` and returns
`401` / `403` otherwise. Ordinary authenticated users and API clients
therefore receive `403 forbidden` from every operations endpoint.

## Tests

`src/tests/batch-17-registry-admin-operations-centre.test.ts` covers:

- SSOT shape parity (every type has a label, tone, SLA hours entry)
- SLA computation: `within_sla`, `approaching_sla`, `sla_breached`,
  `not_applicable`, `blocked`, `paused` precedence
- Forbidden wording detection
- Safe label fallbacks for unknown types

## Guard list

- `scripts/check-batch-17-operations-ssot-parity.mjs`
- `scripts/check-batch-17-operations-no-raw-bank.mjs`
- `scripts/check-batch-17-operations-forbidden-words.mjs`
- `scripts/check-batch-17-operations-route-safe.mjs`

All wired into `package.json` `prebuild` chain.

## Out of scope (intentional)

- Assignment/ownership writes (read-only aggregation first, per spec).
- New SQL tables (`registry_operations_work_items`, etc.) — the unified
  queue is derived from accepted Batch 1–16 tables and therefore inherits
  their RLS unchanged.
- Live provider verification, external notifications, outreach sends.

## Specialist page coverage

The cockpit links to: imports, records, claims (+ review + conflicts +
activation), authority (+ review), bank details (+ review), bank
verification, API clients, API usage, corrections, readiness, decisions,
and the Batch 7 audit log. Where a specialist page is not yet available,
the SSOT exposes `REGISTRY_OPS_EMPTY_COPY.specialist_unavailable`.

Final status: **BATCH_17_REGISTRY_ADMIN_OPERATIONS_CENTRE_COMPLETE**
