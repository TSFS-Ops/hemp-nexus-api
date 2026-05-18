# MT-009 Controlled Production Demo Mode

Narrow, audited, allowlisted production exception for the **five MT-009 Phase 2 fixtures only**. Does not weaken `is_production_environment()`, does not change the existing `seed-daniel-fixtures` production guard, does not touch MT-008 / MT-012 / POI / WaD / payment / credit / token / notification / email / rating / compliance / lifecycle code.

## Scope (hard-coded constants)

`ALLOWED_FIXTURE_SCOPE = "MT-009 Phase 2 Daniel UAT"`
`ALLOWED_FIXTURE_HASHES = [`
  `"DEMO-MT009-NC-BUYERMISSING-001",`
  `"DEMO-MT009-NC-SELLERMISSING-002",`
  `"DEMO-MT009-NC-BOTHMISSING-003",`
  `"DEMO-MT009-NC-REPLACEBUYER-004",`
  `"DEMO-MT009-NC-CLEAN-005",`
`]`

Anything outside these constants is rejected at the function boundary in production — no exceptions.

## What gets built

### 1. DB migration

- Add row to `admin_settings`: `key='allow_controlled_production_demo_fixtures'`, `value={ enabled: false, scope: 'MT-009 Phase 2 Daniel UAT', allowed_hashes: [...5...] }`.
- Default **disabled**. Operator must explicitly flip `enabled=true` to seed in production.
- No schema changes, no new tables, no RLS changes, no triggers, no functions.

### 2. New edge function `seed-mt009-controlled-prod`

- Auth: identical to `seed-daniel-fixtures` (INTERNAL_CRON_KEY OR service-role OR platform_admin JWT).
- Body: `{ confirm: "RUN_SEED_MT009_CONTROLLED_PROD", password: <>=12 chars>, scope: "MT-009 Phase 2 Daniel UAT", hashes: [<subset of the 5>] }`.
- Production path: allowed **only** if `admin_settings.allow_controlled_production_demo_fixtures.enabled === true` AND `scope` exact-match AND every `hashes[i]` is in the allowlist.
- Non-production: always allowed (mirrors current seeder behaviour for staging/test).
- Reuses the **existing** `ensureMatch` / `ensureSeededNamedContact` / Daniel account upsert logic from `seed-daniel-fixtures` by importing the shared helpers into `_shared/mt009-fixtures.ts` (refactor extracts only the MT-009 block + helpers it needs; original seeder keeps its public contract unchanged).
- Forces on every match insert:
  - `is_demo = true`
  - `metadata.demo_fixture = true`
  - `metadata.fixture_scope = "MT-009 Phase 2 Daniel UAT"`
  - `metadata.fixture_code = <hash>`
  - `metadata.production_demo_mode = true`
  - `metadata.seeded_at`, `metadata.seeded_by`, `metadata.expires_at` (default = now + 30 days)
- Refuses if any insert would produce `is_demo=false`, a non-allowlisted hash, a POI / WaD / payment / credit / token / notification / email side effect, or touch an MT-008 hash.
- Audit log: `demo.fixture_seeded_controlled_production` with `{ fixture_scope, fixture_hashes, seeded_by, seeded_at, expires_at, production_demo_mode: true, request_id }`.

### 3. New edge function `unseed-mt009-controlled-prod`

- Symmetric to the seeder.
- Production cleanup gated by the same flag.
- Deletes **only** rows where `hash IN (5 allowlist)` AND `is_demo=true` AND `metadata->>'fixture_scope' = 'MT-009 Phase 2 Daniel UAT'`.
- `match_named_contacts` removed via existing ON DELETE CASCADE.
- Never touches auth users, profiles, orgs (those stay; reused by other Daniel fixtures).
- Audit log: `demo.fixture_unseeded_controlled_production`.

### 4. Tests (`src/tests/mt009-controlled-prod.test.ts`)

Source-pin tests in the same style as `phase2-daniel-fixtures.test.ts`:

1. Production seeding refused when flag disabled.
2. Production seeding works when flag enabled AND scope+hashes match.
3. Only the five hashes are accepted; any other hash returns 400.
4. Every match insert path sets `is_demo=true` + the six metadata fields.
5. MT-008 hashes are not present anywhere in the new function.
6. No email / notification / POI / WaD / payment / credit / token symbols imported.
7. Hard MT-009 progression guard is **not** wired (assert by absence in match-state / engagement-state / completion-engine).
8. Unseeder only deletes the five allowlisted hashes with both `is_demo=true` and metadata scope match.

### 5. Readiness report (returned in chat, no seeding yet)

- Files changed
- Exact safeguards
- Tests run + pass/fail
- How to enable the flag (one `supabase--insert` UPDATE)
- Exact seed command (curl body)
- Exact unseed command (curl body)
- Rollback / cleanup steps
- OPS-010 controlled demo-data compliance confirmation

## Out of scope (explicit)

- No change to `seed-daniel-fixtures` production guard.
- No change to `unseed-daniel-fixtures` production guard.
- No change to `is_production_environment()`.
- No new auth users.
- No emails / invites / notifications.
- No POI / WaD / payment / credit / token / rating / lifecycle / compliance code.
- No MT-008 fixture changes.
- No MT-012 changes.
- No hard MT-009 progression blocking.

## Stop condition

After implementation: return readiness report. **Do not seed until explicit approval.**  
  
Approved with two additions.

Proceed to implement the controlled production demo mode exactly as designed.

Add these two requirements:

1. Expiry guard

- Every seeded match must have `metadata.expires_at`.

- Default expiry is now + 30 days.

- Seeder must reject any requested expiry beyond 30 days.

- Readiness report must include how to find expired controlled demo fixtures.

- Unseed function must support cleaning the five allowlisted MT-009 fixtures.

2. Post-seed verification response

Seeder response must return, per fixture:

- fixture hash;

- match_id;

- route path `/desk/match/<match_id>`;

- whether created or reused;

- active named-contact count;

- requiresNamedContact result if available.

Proceed with implementation.

Still do not seed production.

Return readiness report only after tests pass.