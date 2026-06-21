# Batch 20 — Pre-UAT Embarrassment Audit and Consistency Sweep

Final status: **BATCH_20_PRE_UAT_EMBARRASSMENT_AUDIT_COMPLETE**

This batch is a pre-UAT quality, logic, wording, security and consistency
sweep across the accepted Business Registry build (Batches 1–19B). It adds
no new product functionality and weakens no accepted guardrail.

## Scope

Audited the 21 areas defined in the Batch 20 brief:

1. Full route smoke audit — registry public, company portal, and admin
   routes confirmed against `scripts/check-routes.mjs` (the same guard that
   blocks any `<Link to=…>` / `navigate(…)` / edge-function URL pointing at
   an unregistered path). Result: clean.
2. Label/wording consistency audit — re-ran the Batch 6 / 9 / 10 / 11 /
   13B / 14B / 17 / 18 / 19A / 19B forbidden-wording guards. Result: clean.
3. State-to-label consistency — SSOT parity guards for batches 4, 5, 6, 7,
   8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 19A, 19B all green.
4. Sample-only / UAT data — `check-batch-19a-sample-only-locked.mjs` and
   `check-batch-19b-sample-only-api.mjs` continue to pass: the five client
   records are locked `sample_only`, excluded from production API, sandbox
   returns `verified_by_izenzo: false`, payment-status never usable verified.
5. Public search embarrassment — `check-batch-19b-forbidden-wording.mjs`
   plus the Batch 7/8 search guards pin forbidden public match reasons
   (email / phone / personal address / bank / evidence) and officer-name
   public-search blocking.
6. Public profile embarrassment — Batch 8 + 19B guards confirm hidden
   personal contact, hidden bank details, hidden provider/risk labels,
   required sourced-record + sample-only labels.
7. Claim workflow — `claim_approved_limited` wording + does-not-unlock
   list pinned by Batches 11 / 19A / 19B guards.
8. Evidence — 5-category matrix + 12-month freshness + exception fields
   pinned by Batch 19A SSOT.
9. Authority — Batch 12 SSOT and wording guards still green; authority
   approval does not imply company verification; representatives blocked
   from bank-detail submission pre-authority.
10. Bank-detail — Batches 13 / 13B guards keep `captured_unverified ≠
    verified`, no raw bank fields anywhere in public/company/API surfaces.
11. Verification — Batches 14 / 14B guards pin no-live-provider, no-raw
    leak, expired/revoked/disputed not rendered as verified.
12. Institutional API — Batches 5 / 15 / 15B guards keep production
    disabled by default, forbidden scopes unselectable, no raw/masked bank
    or personal-contact fields in responses, no full keys after creation.
13. Company portal — Batch 16 next-step parity (17 deterministic steps),
    no-raw-bank, verification-wording, acknowledgement guards green.
14. Admin operations — Batch 17 operations guards (SSOT parity, no-raw
    bank, forbidden words, route-safe) green.
15. Release gate / docs — Batch 18 default-status (`demo_ready` not
    `production_ready`) + 5 docs guards green; Batch 20 adds defensive
    `check-batch-20-release-gate-not-production-ready.mjs`.
16. Security/RLS regression — `check-legacy-admin-rls.mjs`,
    `check-registry-people-personal-contact.mjs`,
    `check-sensitive-table-rls-true.mjs`,
    `check-sensitive-column-open-select.mjs` all green.
17. Dead code / stale copy / old-batch drift — Batch 20 adds
    `check-batch-20-no-debug-in-registry-ui.mjs` which rejects
    TODO/FIXME/XXX/HACK/PLACEHOLDER/`DEBUG:`/`console.log(` in any registry
    UI file (public, company portal, admin). Scan was clean at acceptance.
18. Embarrassment report — this file.
19. Guards — added in section "Guards added" below.
20. Tests — `src/tests/batch-20-pre-uat-embarrassment-audit.test.ts`.
21. Release + evidence — `RELEASE_GATE.md` and central index updated.

## Issues by category

### uat_blocker
- None. All findings during the sweep were already covered by accepted
  Batch 1–19B guards or fixed earlier this batch.

### uat_risk
- None outstanding. The accepted `not_available` default on bank
  verification + `sample_only` lock on the five client records remain the
  controlling risk fences; both are pinned by existing guards.

### cosmetic
- None outstanding. The two visual-token nudges flagged earlier in the
  publish cycle (`RegistryAlsoFoundPanel.tsx`,
  `UnifiedRegisterLinkSuggestions.tsx`) were corrected before this batch.

### deferred_non_blocking
- Live provider verification (DEFERRED — explicit `accepted_limitation`;
  see §11). Does not block UAT because verification UI explicitly states
  provider integration is not enabled.
- Production API enablement (DEFERRED — explicit `accepted_limitation`;
  see §12). Does not block UAT because production API is disabled by
  default and gated by Batch 15B acknowledgement.
- SMS / WhatsApp outreach (DEFERRED — Phase 1 disabled, pinned by
  `check-batch-19b-sms-whatsapp-disabled.mjs`).

### accepted_limitation
- Claim approval = `claim_approved_limited`. Does not imply company,
  authority, bank-detail, or API-sharing approval. Wording pinned.
- The five client records (bullion_bathrooms_nigeria, dangote_fertiliser_
  limited, harith_holdings, laurium_capital, starfair_162) are
  `sample_only` for UAT. Excluded from production API; sandbox returns
  `verified_by_izenzo: false`; payment-status never usable verified.
- Default final release status is `demo_ready`, not `production_ready`.

## Guards added (wired into `npm run prebuild`)

- `scripts/check-batch-20-no-debug-in-registry-ui.mjs`
- `scripts/check-batch-20-evidence-index-present.mjs`
- `scripts/check-batch-20-release-gate-not-production-ready.mjs`

## Tests added

- `src/tests/batch-20-pre-uat-embarrassment-audit.test.ts` — asserts the
  embarrassment-audit invariants (sample-only excluded from production
  API, claim-approval-limited copy preserved, release-gate default is not
  `production_ready`, no Batch 20 evidence drift).

## Final UAT readiness statement

The Business Registry build is **UAT-ready** as defined by the client's
signed claim/search/profile decisions. Production-readiness is **not**
asserted. Live provider verification and production API access remain
disabled by default and require an explicit Business Decision before
enablement.
