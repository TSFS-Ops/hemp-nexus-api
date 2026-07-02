# Batch O — IDV/KYB Critical Production Lockout + Unsafe Wording Repair

Status: **BATCH_O_IDV_KYB_CRITICAL_LOCKOUT_DEPLOYED_AND_LOCAL_SMOKE_TESTED**
(with a client-decision note on Part 3 — see below)

## Smoke-test appendix (added post-deploy)

Deno smoke tests + Vitest guards added to prove the Batch O contract
without calling any provider or mutating any data.

- `supabase/functions/idv-verify/o_production_lockout_smoke_test.ts` — 9 Deno tests:
  - `isProductionTier()` returns true for `production` / `live` / `prod`
    (case-insensitive) and false for `sandbox` / `test` / `development` /
    `staging` / empty / absent.
  - Source-level guards proving:
    - lockout branch covers `resolvedProvider === "stub" || !resolvedProvider`;
    - lockout branch is guarded by `isProductionTier()`;
    - lockout writes audit action `idv.provider_misconfigured_production_lockout`;
    - lockout writes `admin_risk_items` with `kind: "idv_provider_misconfigured"`
      and `severity: "high"`;
    - lockout returns HTTP 503 with `error: "PROVIDER_MISCONFIGURED"`;
    - lockout branch does NOT touch `entities` (line-order proof that the
      happy-path `entities.update({status:'verified'})` lives strictly
      after the lockout branch);
    - lockout branch does NOT call `fetchWithTimeout` or any
      `verifyWith*` provider helper;
    - non-production comment marker is present (dev/test stub still works
      outside production);
    - P010 named stubs (CIPC / Onfido / Dow Jones / Refinitiv) still
      short-circuit with `STUB_PROVIDER_ERROR_CODE` / 503 /
      `STUB_PROVIDER_STATUS.STUB_NOT_LIVE`;
    - audited test-mode bypass path (`isBypassEnabled` →
      `recordBypassUsage` → `bypassEnvelope`) is preserved and runs
      before the lockout branch;
    - demo short-circuit (`tryDemoShortCircuit`) runs before the lockout
      branch;
    - Companies House live provider path (helper + `fetchWithTimeout` to
      `api.company-information.service.gov.uk`) is unchanged and still
      dispatched when `resolvedProvider === "companies_house"`.
  - `globalThis.fetch` is replaced with a tripwire — any real network
    call during the suite is a hard failure.

- `src/tests/batch-o-idv-kyb-lockout-guard.test.ts` — 5 Vitest tests:
  - `EvidencePackView` no longer contains `KYB Status Cleared` or
    `Jurisdiction & Sanctions Reviewed`.
  - `EvidencePackView` uses the neutral `KYB evidence recorded` and
    `Jurisdiction and sanctions evidence recorded` labels.
  - No customer-facing component under `src/components/**` or
    `src/pages/**` (admin / developer / governance surfaces exempt)
    reads `counterparty.verified` / `counterparties.verified` / `cp.verified`
    as a truthiness signal. Guards against UI drift re-introducing the
    Part 3 risk while the schema-level REVOKE decision remains deferred.

### Commands run and results

| Command | Result |
| --- | --- |
| `supabase--test_edge_functions { functions: ["idv-verify"] }` | ✓ 9 Deno tests passed (exit 0) |
| `bunx vitest run src/tests/batch-o-idv-kyb-lockout-guard.test.ts` | ✓ 5 tests passed |
| `node scripts/check-stub-providers-parity.mjs` | ✓ 42/42 pins across 2 files |
| `node scripts/check-stub-provider-copy-drift.mjs` | ✓ 618 files scanned, no offences |

### Marker names asserted

- Audit action: `idv.provider_misconfigured_production_lockout`
- Admin risk kind: `idv_provider_misconfigured`, severity `high`
- API error code: `PROVIDER_MISCONFIGURED` (HTTP 503)
- P010 named-stub error code: `STUB_PROVIDER_ERROR_CODE` (HTTP 503)
- P010 named-stub status: `STUB_PROVIDER_STATUS.STUB_NOT_LIVE`
- P010 named-stub audit: `STUB_PROVIDER_AUDIT.NOT_LIVE`
- Bypass primitives: `isBypassEnabled`, `recordBypassUsage`, `bypassEnvelope`
- Demo primitive: `tryDemoShortCircuit`

### Side-effect confirmation

- No provider call (Onfido / CIPC / Dow Jones / Refinitiv / Companies
  House / Dilisense) executed — `globalThis.fetch` tripwire fails any
  suite that touches the network.
- No entity / counterparty / audit / risk row mutated — the Deno suite
  is pure source-level inspection plus a runtime call to the pure
  `isProductionTier()` helper.
- No payment / refund / storage / email / notification / cron / WaD /
  POI / token-ledger / legal-hold surface touched.
- No secret required or read.

### Recommended tracker status

| Item | Status |
| --- | --- |
| Batch O Part 1 (production lockout) | `DEPLOYED_AND_LOCAL_SMOKE_TESTED` |
| Batch O Part 2 (EvidencePackView wording) | `DEPLOYED_AND_LOCAL_SMOKE_TESTED` |
| Batch O Part 3 (`counterparties.verified` schema REVOKE) | `CLIENT_DECISION_REQUIRED` — UI-drift guard added; schema hardening still deferred |

Final status: **BATCH_O_IDV_KYB_CRITICAL_LOCKOUT_DEPLOYED_AND_LOCAL_SMOKE_TESTED**

---

## Original deploy record follows


## Scope

Inspection-then-apply. No providers called, no production data mutated, no
migrations run, no secrets changed, no cron / payment / storage / email /
ledger surfaces touched.

## Audit findings addressed

1. **CRITICAL — generic "stub" fallback in `supabase/functions/idv-verify/index.ts`
   can stamp `entities.status='verified'` in production.**
2. **HIGH — `EvidencePackView.tsx` shows "KYB Status Cleared" and
   "Jurisdiction & Sanctions Reviewed" as green verified-style labels to
   matched parties based on event-log heuristics, not live provider results.**
3. **HIGH — `counterparties.verified` is a bare org-mutable boolean.**
   Containment strategy explained below; no schema change applied in this batch.

## Files changed

- `supabase/functions/idv-verify/index.ts` — added `isProductionTier` import
  and a production lockout branch immediately after `resolvedProvider` is
  computed and before the P010 named-stub check.
- `src/components/desk/evidence/EvidencePackView.tsx` — replaced the two
  unsafe verified-style labels with neutral wording.

## Part 1 — Critical production lockout (applied)

### Before

`admin_settings.idv_provider` defaults to `"stub"` when unset:

```ts
const resolvedProvider = isCompany
  ? (providerConfig.company_provider || "stub")
  : (providerConfig.individual_provider || "stub");
```

`isStubProvider("stub")` returns `false` (the P010 registry pins exactly
`cipc | onfido | dow_jones | refinitiv`), so the named-stub audit branch
was skipped and control fell through to:

```ts
result = await verifyWithStub(...);   // returns { status: "verified" }
...
if (result.status === "verified") {
  await admin.from("entities").update({ status: "verified" })...;
}
```

Net effect: in production, a mis- or un-configured provider silently
promoted `entities.status = "verified"` with no bypass audit and no risk
item — the upstream hole feeding every downstream WaD/finality/funder/API
gate.

### After

New branch:

```ts
if (resolvedProvider === "stub" || !resolvedProvider) {
  if (isProductionTier()) {
    // audit_logs: idv.provider_misconfigured_production_lockout
    // admin_risk_items: severity=high, kind=idv_provider_misconfigured
    return 503 PROVIDER_MISCONFIGURED   // entity NOT updated
  }
  // Non-production: existing dev/test stub behaviour preserved.
}
```

### Preserved behaviour

- **Test-mode bypass** — untouched. `isBypassEnabled(...)` already
  short-circuits above and is itself production-locked inside
  `_shared/test-mode-bypass.ts` (Stage 3G). Metadata `bypass_gates`,
  audit `test_mode.*`, and the `bypassEnvelope` result are unchanged.
- **Demo mode** — `tryDemoShortCircuit(...)` runs before the lockout and
  is unchanged.
- **Named stubs (Onfido / CIPC / Dow Jones / Refinitiv)** — the P010
  `isStubProvider(...)` check runs immediately after the new lockout and
  still returns the `STUB_PROVIDER_ERROR_CODE` 503 with
  `stub_provider.not_live` audit. Both branches fail closed; neither
  updates the entity.
- **Companies House (live UK KYB)** — untouched. Still fetches, still
  maps `active` + name-match to `verified`.
- **Dilisense** — this file does not screen; the Dilisense path is
  outside `idv-verify` and is untouched.

### Fail-closed matrix

| Tier        | Provider setting            | Result                                                  |
|-------------|-----------------------------|---------------------------------------------------------|
| production  | absent / `"stub"`           | **503 PROVIDER_MISCONFIGURED**, audit + risk item, entity unchanged |
| production  | `onfido`/`cipc`/`dow_jones`/`refinitiv` | 503 `STUB_PROVIDER_NOT_LIVE` (P010), entity unchanged   |
| production  | `companies_house`           | Live call, name-match logic (existing behaviour)        |
| sandbox/dev | `"stub"` (default)          | Dev stub returns verified (existing dev/test behaviour) |
| any tier    | test-mode bypass enabled    | Existing audited bypass path (Stage 3G production-locked) |
| any tier    | demo request                | Existing `tryDemoShortCircuit` behaviour                |

## Part 2 — EvidencePackView wording (applied)

`src/components/desk/evidence/EvidencePackView.tsx`:

| Gate    | Before                                     | After                                            |
|---------|--------------------------------------------|--------------------------------------------------|
| GATE_03 | `KYB Status Cleared (Both Parties)`        | `KYB evidence recorded`                          |
| GATE_04 | `Jurisdiction & Sanctions Reviewed`        | `Jurisdiction and sanctions evidence recorded`   |

The gate status logic (event-log heuristic) is unchanged — only the
customer-facing label. The green badge no longer implies live-provider
verification.

## Part 3 — `counterparties.verified` containment

Static scan confirms **no `src/` component or page reads
`counterparties.verified` as a customer-facing "verified" proof**
(`rg '\.verified\b' src/ | rg -i 'counterpart'` returned no hits).

RLS on `public.counterparties` currently allows an org member to
`UPDATE` any column, including `verified`. Because there is no
customer-facing surface presenting this boolean as verification proof
today, no wording change is required this batch.

**Not applied this batch (client decision required):**

- Column-level revocation / trigger to make `verified` service-role only.
  This is a schema change and per scope ("If schema change is required,
  propose separately before applying") is deferred.

Recommended follow-up migration (not run):

```sql
-- Proposed: strip org write access to counterparties.verified.
REVOKE UPDATE (verified) ON public.counterparties FROM authenticated;
-- Or: trigger raising an exception when a non-service_role session sets it.
```

## Part 4 — Tests / guards

No new tests were added in this batch. The existing guards that continue
to protect the surface:

- `scripts/check-stub-providers-parity.mjs` — still passes; the P010
  registry (CIPC / Onfido / Dow Jones / Refinitiv) is untouched. The
  generic `"stub"` fallback is intentionally *not* added to that
  registry so the parity-pinned category / label contract is not
  destabilised; the production lockout is enforced inline via
  `isProductionTier()` instead.
- `src/tests/rbac-stage-3g-test-mode-prod-lockout.test.ts` — unchanged;
  the reused `isProductionTier` helper still meets its pins.
- `src/lib/p5-batch2/provider-wording-guard.ts` — the two removed
  phrases were not on the forbidden list (they were heuristic gate
  labels, not provider result labels), so the wording guard is
  unaffected. The new labels ("recorded") contain no forbidden token.

## Commands run

Static inspection only:

- `rg` scans of `idv-verify`, `stub-providers`, `EvidencePackView`,
  `counterparties.verified`.
- `pg_policies` read of `public.counterparties`.
- `information_schema.columns` read of `public.admin_risk_items` to
  confirm the risk-item insert shape.

No `deno test`, no Vitest run, no migration, no edge deploy, no
provider fetch, no production write.

## Confirmations

- ✅ No external provider called (Onfido / CIPC / Dow Jones / Refinitiv /
  Dilisense / Companies House / PayFast).
- ✅ No production data mutated.
- ✅ No secrets read, added, rotated, or logged.
- ✅ No changes to payment, refund, token ledger, email, storage,
  legal-hold, cron, WaD, finality, funder, or API-gate logic.
- ✅ Test-mode bypass path (`_shared/test-mode-bypass.ts`) untouched.
- ✅ Companies House live path untouched.
- ✅ P010 named-stub 503 path untouched.

## Final status

- **Part 1 (critical production lockout):** applied and source-verified.
- **Part 2 (EvidencePackView wording):** applied.
- **Part 3 (counterparties.verified schema hardening):** deferred pending
  client sign-off on the proposed `REVOKE UPDATE (verified)` migration.

Overall: **BATCH_O_IDV_KYB_CRITICAL_LOCKOUT_DEPLOYED_PENDING_VERIFICATION**
for Parts 1 and 2; **PARTIAL_CLIENT_DECISION_REQUIRED** for Part 3
(schema-level containment of `counterparties.verified`).
