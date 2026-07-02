# Batch O Remainder — IDV / KYB / screening trust-signal correction

Status: **DEPLOYED_AND_LOCAL_SMOKE_TESTED (schema hardening deferred).**

Closes the residual trust-signal issues identified by the read-only
Batch O verification audit. This batch changes what customer-facing
surfaces are allowed to imply about "verified" state — it does NOT
introduce any new provider integrations, does NOT call live providers,
does NOT mutate production data, and does NOT run destructive migrations.

---

## What was fixed

### Scope A — `EvidencePackView` badge logic (Part 2)

`src/components/desk/evidence/EvidencePackView.tsx`

- `GateStatus` extended with a new neutral state, `"evidence_recorded"`.
- `GATE_03` (KYB), `GATE_04` (jurisdiction/sanctions), and `GATE_05`
  (UBO/authority) **can no longer be promoted to `"verified"`** from:
  - `match.status === "settled" / "completed"` (via the removed
    `isSettled` fallback), or
  - a single `kyc_verified` / `sanctions_screened` / `jurisdiction_resolved`
    / `authority_bound` / `ubo_verified` event.
- When those heuristic events are present, the gate now renders as
  `"evidence_recorded"` — neutral slate dot, `Circle` (not `Check`)
  icon, trailing text `"recorded"`.
- The green `"verified"` badge remains ONLY on cryptographically
  verifiable gates: `GATE_01` (bilateral signatures), `GATE_02` (token
  burn), `GATE_06` (commercial terms hash), `GATE_07` (document
  integrity), `GATE_08` (audit-chain), `GATE_09` (WaD certificate).

**Before:** a settled/completed match with no live-provider evidence
would light up KYB and sanctions gates green.
**After:** those gates stay `pending` / neutrally `recorded` until a
live-provider path writes evidence.

### Scope B — `counterparties.verified` customer-facing containment (Part 3)

Three files, one leak chain, all fixed:

1. `supabase/functions/search/index.ts`
   - `.select(...)` no longer pulls the `verified` column from
     `counterparties`.
   - `source` is now always `"registry_record"` (was `"verified_registry"` /
     `"counterparty_registry"` depending on the boolean).
   - `score` is a flat `0.7` (no `cp.verified ? 0.9 : 0.7` boost).
   - Coherence `score` is `0.7`; `"Verified entity"` factor removed.
   - Response `metadata` no longer includes a `verified` field.

2. `src/components/search/CompactCounterpartyRow.tsx`
   - `Tier` union collapsed to `"registry" | "order_book" | "web" | "unknown"`;
     the standalone `"verified"` tier is gone.
   - `tierFromSource` maps the legacy `"verified_registry"` and
     `"counterparty_registry"` strings to the same neutral `"registry"`
     tier so cached search results served before the edge fn redeploy
     still render safely.
   - `tierLabel` returns `"Registry record"` (was `"Verified registry"`).
   - `tierDotClass` uses slate colours, not emerald, for the registry
     tier.
   - `SearchResult.metadata.verified` removed from the interface.

3. `src/components/CounterpartySearch.tsx`
   - Reducer collapses `registry_record`, `verified_registry`,
     `counterparty_registry` into a single `registered` counter.
   - The emerald `{counts.verified} verified` header chip is removed.
   - The `registered` chip is rendered in sky blue and reads
     `"{N} registry"`.

### Scope C — Extended Batch O guard test

`src/tests/batch-o-idv-kyb-lockout-guard.test.ts`

Rewrote the guard suite to close the audit's structural gap:

- Scan scope extended from `src/components/**` + `src/pages/**` to
  also cover `src/lib/**` and `supabase/functions/**` — the edge-fn
  leak that the previous guard missed is now inside the scan window.
- Adds explicit label bans for `"verified_registry"`, `"Verified
  registry"`, `"Verified entity"`, plus a metadata-block scan that
  fails if `verified` reappears in the counterparty mapper.
- Adds gate-derivation regressions that fail if `GATE_03`, `GATE_04`,
  or `GATE_05` emits the literal `"verified"` status or references
  `isSettled`.
- Includes an admin/developer/governance exemption list so audit /
  diagnostic surfaces are still allowed to reference the underlying
  column.
- Includes a composite regression net (single test) that fails if any
  customer-facing file reintroduces a `counterparties.verified`-derived
  trust label via any of the three banned patterns.

### Scope D — `idv-verify` strict provider allow-list

`supabase/functions/idv-verify/index.ts`

- Explicit constants: `COMPANY_ALLOWED_PROVIDERS = ["companies_house",
  "cipc"]`, `INDIVIDUAL_ALLOWED_PROVIDERS = ["onfido"]`.
- `resolvedProvider` defaults to `null` (not `"stub"`).
- New unified allow-list guard rejects **any** unknown / unsupported
  string — `"stub"`, `"mock"`, `"demo"`, empty string, `null`, typos,
  or unsupported vendor names — with `503 PROVIDER_MISCONFIGURED` in
  **all** tiers.
  - Non-production: audited under `idv.provider_misconfigured`
    (audit_logs only).
  - Production: audited under
    `idv.provider_misconfigured_production_lockout` AND a high-severity
    `admin_risk_items` row is inserted.
  - Response body includes `allowed_providers` so misconfigured
    clients get an actionable diagnostic.
- The generic `verifyWithStub()` helper is **deleted** entirely.
- Dispatch `else` branches now throw
  `ApiException("PROVIDER_MISCONFIGURED", ..., 503)` rather than fall
  through to any stub, giving defence in depth if a new provider is
  ever added to the allow-list without a dispatch branch.
- Audited test-mode bypass path (`isBypassEnabled → recordBypassUsage
  → bypassEnvelope`) is preserved and continues to run BEFORE the
  allow-list guard so audited bypass remains the only non-live path.
- The P010 named-stub 503 branch (`cipc`, `onfido`, `dow_jones`,
  `refinitiv`) is unchanged.

### Scope E — Schema hardening deferred

`counterparties.verified` remains in the schema. This batch does not
migrate `REVOKE UPDATE (verified) ON public.counterparties FROM
authenticated` or add an audit trigger, because:

- No customer-facing surface reads it any more (Scope B).
- The guard test (Scope C) prevents drift.
- Migrations are out of scope for a UI/trust-signal batch and the
  audit explicitly asked for schema hardening only if straightforward
  and low-risk.

Recommended follow-up (separate migration batch):

- `REVOKE UPDATE (verified) ON public.counterparties FROM authenticated;`
- audit trigger on any change to the column;
- audit-only read via a security-definer function for admin surfaces.

---

## What was NOT done (residual risks)

- `ubo-verify` still allows `entities.status = 'verified'` from
  org-driven `ubo_links.verified` flags without a production-tier
  guard. Recommend a separate `Batch O-UBO` mirroring the idv-verify
  allow-list.
- `dilisense-screen` and `run_screening` "hardcoded clear" fallback
  paths were not touched (Batch Q scope).
- `get_test_mode_bypass_state` is still `GRANT EXECUTE ... TO PUBLIC`
  (Batch P scope).
- `org_directors.is_pep` self-mutation lacks audit trail (Batch P
  scope).

---

## Tests

### Vitest — `src/tests/batch-o-idv-kyb-lockout-guard.test.ts`

```
Test Files  1 passed (1)
     Tests  25 passed (25)
```

Coverage:

- `EvidencePackView` neutral wording (4 tests).
- `EvidencePackView` gate-status derivation — GATE_03/04/05 never
  emit `"verified"`, badge renderer distinguishes the three states
  (5 tests).
- `counterparties.verified` containment — no `.verified` accessor,
  no `verified_registry` source, no `"Verified registry"` label, no
  `"Verified entity"` factor across `src/components/**`, `src/pages/**`,
  `src/lib/**`, `supabase/functions/**` (4 tests).
- `search/index.ts` source-level pins — no `verified` in the select,
  source, coherence, metadata, or score (5 tests).
- `CompactCounterpartyRow.tsx` source-level pins (4 tests).
- `CounterpartySearch.tsx` header-chip pins (2 tests).
- Composite regression net (1 test).

### Deno — `supabase/functions/idv-verify/o_production_lockout_smoke_test.ts`

```
ok | 13 passed | 0 failed (14ms)
```

Coverage:

- Runtime coverage of `isProductionTier()` for both true and false
  tiers (2 tests).
- Allow-list constants declared correctly (1 test).
- Guard rejects any unknown / stub / mock / demo / empty provider
  up-front (1 test).
- `resolvedProvider` default is `null` (1 test).
- `verifyWithStub` deleted, no call site remains (1 test).
- Dispatch else-branches throw `PROVIDER_MISCONFIGURED` (1 test).
- `audit_logs` fires unconditionally; `admin_risk_items` is
  production-only (1 test).
- P010 named-stub branch unchanged (1 test).
- Audited bypass path still precedes the guard (1 test).
- Demo short-circuit still runs first (1 test).
- Companies House live path unchanged (1 test).
- Allow-list guard does not attempt any provider fetch (1 test).

### Commands run

```
bunx vitest run src/tests/batch-o-idv-kyb-lockout-guard.test.ts
supabase--test_edge_functions functions=["idv-verify"] pattern="Batch O"
```

Both green.

---

## Side-effect confirmation

- No live provider was called (Deno tests install a `globalThis.fetch`
  tripwire; Vitest guards are pure source scans).
- No production data was mutated. No database migration was executed.
- No email, notification, cron, storage, or refund path was touched.
- No secrets were added, rotated, or read.

---

## Files changed

- `supabase/functions/idv-verify/index.ts` — strict allow-list, deleted
  `verifyWithStub`, hardened dispatch, resolvedProvider defaults to null.
- `supabase/functions/idv-verify/o_production_lockout_smoke_test.ts` —
  rewritten around the new allow-list contract.
- `supabase/functions/search/index.ts` — removed cp.verified column,
  source label, coherence factor, metadata field, score boost.
- `src/components/desk/evidence/EvidencePackView.tsx` — added
  `evidence_recorded` gate status; GATE_03/04/05 downgraded; renderer
  now distinguishes the three states.
- `src/components/search/CompactCounterpartyRow.tsx` — removed
  verified tier, added legacy alias mapping.
- `src/components/CounterpartySearch.tsx` — removed emerald verified
  count chip; unified registry counter.
- `src/tests/batch-o-idv-kyb-lockout-guard.test.ts` — extended scope
  and new regressions.
- `evidence/batch-o-remainder-idv-kyb-trust-signals/README.md` — this file.

## Recommended next batch

- **Batch P** — restrict `get_test_mode_bypass_state` to `authenticated`
  and add an audit trigger on `org_directors.is_pep`.
- **Batch O-UBO** — mirror the allow-list treatment inside `ubo-verify`.
- **Batch Q** — harden `dilisense-screen` / `run_screening` fallback paths.
