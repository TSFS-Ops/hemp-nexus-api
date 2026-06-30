# C8 — Client-facing wording and status honesty (safe subset)

**Date:** 2026-06-30
**Status:** `C8_CLIENT_FACING_WORDING_AND_STATUS_HONESTY_SAFE_SUBSET_DEPLOYED`
**Predecessor status:** `C8_CLIENT_FACING_WORDING_AND_STATUS_HONESTY_READY_TO_APPLY`
**Scope:** Frontend-only. 10 safe items applied. Deferred verifier-wording items held for client decision.

## Inspection findings (recap)

The earlier inspection batch (`evidence/c6-chron-observability/lifecycle-scheduler-timeout-remediation/README.md` ran in parallel) catalogued 15 candidate items across five themes:

- **Audit Ledger** — `Start verifying mathematics.` and `independently re-verifiable deal records` (deferred).
- **Landing** — `independently verifiable execution` (deferred). Ticker badges and `Landing.tsx` itself: already safe.
- **ComplianceEngine** — 5 safe copy items applied below.
- **WaD** — already safe; uses "tamper-evident" with explicit "not a contract" disclaimer; status badges go through `deriveConsequenceState`/`statusLabel` (no raw enum leakage).
- **Registry verification status display** — 5 raw-enum leakage points applied below.

Items classified `NEEDS_CLIENT_DECISION` were not touched.

## 10 safe items applied

### ComplianceEngine wording (`src/pages/products/ComplianceEngine.tsx`)

| # | Before | After |
|---|--------|-------|
| 1 | `<span …>Verified</span>` (IdentityMockup demo badge, L98) | `<span …>KYB reviewed</span>` |
| 2 | `… Within seconds, the engine reads, structures, and SHA-256 seals …` (L410) | `… The engine reads, structures, and SHA-256 seals …` |
| 3 | `OFAC · EU · UK HMT · DPL · Continuous screening` (L371) | `OFAC · EU · UK HMT · DPL · Periodic screening` |
| 4 | `Three primitives. One verified counterparty.` (L391) | `Three primitives. One reviewed counterparty.` |
| 5 | `One verified counterparty record, reused across every deal.` (L535) | `One reviewed counterparty record, reused across every deal.` |

The body copy at L430 already correctly states *"Continuous re-screening is planned hardening"* — the hero eyebrow no longer contradicts it.

### Registry status display mapping

New SSOT: **`src/lib/registry-status-labels.ts`** — exports `humanizeStatus()` + six formatters (`formatClaimWorkflowStatus`, `formatEvidenceState`, `formatReadinessLabel`, `formatClaimStatus`, `formatAuthorityStatus`, `formatProfileVerificationStatus`). Unknown values fall back to a title-cased neutral label via `humanizeStatus`; null/undefined falls back to `"Status pending"` (or `"Submitted"` for evidence). No raw snake_case ever reaches the DOM.

Backend payloads are unchanged. The SSOT lives outside `src/components/registry/` / `src/pages/registry/` / `src/pages/admin/registry/`, so it does not collide with the existing `check-registry-readiness-forbidden-words.mjs` guard.

| # | File | Before | After |
|---|------|--------|-------|
| 6 | `src/pages/registry/CompanyProfile.tsx` L104-110 | 4 raw `<Badge>{profile.*_status}</Badge>` | 4 mapped badges via `formatReadinessLabel`, `formatClaimStatus`, `formatAuthorityStatus`, `formatProfileVerificationStatus`. `bank_detail_status_label` now nullable-safe. |
| 7 | `src/pages/registry/ClaimStatus.tsx` L61 | `<Badge>{c.workflow_status}</Badge>` | `<Badge>{formatClaimWorkflowStatus(c.workflow_status)}</Badge>` |
| 8 | `src/pages/registry/ClaimStatus.tsx` L99 + `src/pages/registry/MyCompanyEvidence.tsx` L100 | raw `{e.evidence_state}` / `{e.evidence_state ?? "submitted"}` | `formatEvidenceState(e.evidence_state)` |
| 9 | `src/pages/registry/ClaimsList.tsx` L76 | `<Badge>{r.workflow_status}</Badge>` | `<Badge>{formatClaimWorkflowStatus(r.workflow_status)}</Badge>` |
| 10 | `src/pages/registry/Search.tsx` L241 | inline `<Badge variant="secondary" className="text-[10px] font-mono">{r.readiness_label}</Badge>` | `<ReadinessBadge state={r.readiness_label} />` |

### `ReadinessBadge` hardening

`src/components/registry/ReadinessBadge.tsx` now accepts any string for `state`. Known module-readiness states render with the existing `REGISTRY_READINESS_LABEL` map and tone; unknown values (e.g. record-lifecycle values like `imported_unverified` flowing in from the registry-company-search edge function) render with the C8 readiness display map and a neutral tone. Existing callers (`MyCompanies.tsx`, etc.) continue to type their prop as `RegistryReadinessState` — no caller is broken.

### Hedged label policy

- `approved` (claim workflow / public profile) → `"Claim reviewed"` / `"Reviewed claim on file"`. Never `"verified"`.
- `accepted` (evidence) → `"Accepted"`. `approved` (legacy alias) → `"Accepted"`. Never `"verified"`, never `"approved"` as a company-level claim.
- `profile_verified` → `"Profile reviewed"`. `profile_not_verified` → `"Profile not independently reviewed"`.
- `imported_unverified` → `"Imported, not independently confirmed"`.
- Unknown enum values → `humanizeStatus()` (title-cased, underscores stripped). Empty / null → `"Status pending"` (or `"Submitted"` for evidence).

## Deferred — NOT touched

Per scope, the following remain as-is pending a client decision on whether a public hash-verification endpoint exists or will exist:

- `src/pages/products/AuditLedger.tsx` — `"Start verifying mathematics."` (L249).
- `src/pages/products/AuditLedger.tsx` — `"… independently re-verifiable deal records"` (L166-167).
- `src/components/landing/HeroStripeGlow.tsx` — `"… independently verifiable execution."` (L79).

Test guard `C8 deferred verifier wording — left untouched` will fail if any of these are silently removed before the decision lands.

## Files changed

```
src/lib/registry-status-labels.ts                       (created — SSOT)
src/components/registry/ReadinessBadge.tsx              (extended to accept arbitrary string with safe fallback)
src/pages/products/ComplianceEngine.tsx                 (5 copy edits)
src/pages/registry/CompanyProfile.tsx                   (4 badge formatters wired)
src/pages/registry/ClaimStatus.tsx                      (workflow_status + evidence_state formatters)
src/pages/registry/MyCompanyEvidence.tsx                (evidence_state formatter)
src/pages/registry/ClaimsList.tsx                       (workflow_status formatter)
src/pages/registry/Search.tsx                           (ReadinessBadge import + use)
src/tests/c8-client-wording-status-honesty.test.ts      (created — 17 guards)
evidence/c8-client-facing-wording-and-status-honesty/README.md  (this file)
```

## Confirmation — no backend / data / runtime change

- ❌ No migration created.
- ❌ No edge function source changed or deployed.
- ❌ No `cron.job` row altered.
- ❌ No RLS / GRANT / policy / index / schema change.
- ❌ No mutation of any business table (no writes to `registry_company_records`, `registry_company_claims`, `registry_company_claim_evidence`, `acceptance_receipts`, `notification_dispatches`, `email_send_log`, `token_ledger`, `payments`, `refunds`, etc.).
- ❌ No emails / notifications sent. No provider calls.
- ❌ Pending C6 / C7 / runtime-verification items untouched (lifecycle scheduler 15s timeout, reconciliation deploy repair, burn-POI source repair, C6.5 / C6.7 dry-run heartbeats, C7.2 admin-alert queue).
- ❌ Same API payloads consumed by the same callers; only presentation changed.
- ❌ Backend enum values, column names, and field names are unchanged. `data-testid` attributes were added in places to support the new guard, but no field rename or shape change.

## Tests / guards run

| Suite | Result |
|---|---|
| `src/tests/c8-client-wording-status-honesty.test.ts` (17 assertions, new) | ✅ 17 pass |
| `scripts/check-registry-readiness-forbidden-words.mjs` (73 files scanned) | ✅ pass |
| `scripts/check-registry-batch11-no-verified-claim-wording.mjs` | ✅ pass |

The C8 guard pins:
- 5 ComplianceEngine copy changes (positive + negative assertions).
- 5 registry surface mappings (formatter call present, raw enum interpolation absent).
- 7 formatter behaviour assertions: `humanizeStatus` strips underscores; `approved` → `"Claim reviewed"`; `accepted`/`approved` evidence → `"Accepted"`; `imported_unverified` → hedged label; null → safe fallbacks; no formatter label asserts the word "verified".
- 2 deferred wording assertions: AuditLedger "Start verifying mathematics." and "re-verifiable deal records" still present; HeroStripeGlow "independently verifiable execution" still present.

## Runtime status

Deployed. Pure presentation change — no scheduled tick required to verify. The C8 guard suite is the runtime gate for this batch.

**Final status:** `C8_CLIENT_FACING_WORDING_AND_STATUS_HONESTY_SAFE_SUBSET_DEPLOYED`
