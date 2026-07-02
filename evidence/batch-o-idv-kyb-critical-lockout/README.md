# Batch O — IDV/KYB Critical Production Lockout + Unsafe Wording Repair

Status: **BATCH_O_IDV_KYB_CRITICAL_LOCKOUT_DEPLOYED_PENDING_VERIFICATION**
(with a client-decision note on Part 3 — see below)

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
