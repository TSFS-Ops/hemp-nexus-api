# P011 — Counterparty Rating Methodology Visibility

**Final status:** `P011_COUNTERPARTY_RATING_METHODOLOGY_VISIBILITY_COMPLETE`

Methodology version: **1.0** (`COUNTERPARTY_RATING_METHODOLOGY_VERSION`)

## What this batch delivered

A new **evidence-confidence** counterparty rating that runs in parallel to
the existing four-pillar deal-history reputation rating, with build-time
guards, role-aware visibility, audited overrides, and an internally tested
acceptance suite that encodes the five client-approved examples.

The rating is an evidence-confidence signal only — not a credit assessment,
compliance clearance, bank verification, or guarantee.

## Five bands (exact strings)

1. `limited_information` — Limited Information
2. `public_source_supported` — Public-Source Supported
3. `admin_reviewed` — Admin-Reviewed
4. `verification_complete` — Verification Complete
5. `flagged` — Flagged

## Files created / changed

### Schema
- migration `…_p011_counterparty_evidence_ratings` — `counterparty_evidence_ratings`, `counterparty_rating_overrides`, enums `evidence_rating_band` / `evidence_rating_freshness` / `evidence_rating_override_reason`, RLS, GRANTs, validation trigger.

### SSOT
- `src/lib/evidence-rating.ts` — browser SSOT: bands, user wording, disclaimer, forbidden words, override reasons, freshness windows, audit names, methodology version, pure `computeEvidenceRating`.
- `supabase/functions/_shared/evidence-rating.ts` — edge mirror, parity-enforced.

### Edge functions (added to deploy manifest)
- `supabase/functions/compute-evidence-rating/index.ts` — event-driven recalculation, role-gated, never thrown to caller, preserves last rating on failure.
- `supabase/functions/evidence-rating-override/index.ts` — apply / change / remove (single endpoint with `action`), role-gated, reason ≥30 chars, expiry ≤90 days unless `admin_block`, never permits `verification_complete`, never hides an active critical flag.

### UI
- `src/components/ratings/EvidenceRatingBadge.tsx` — 5-band badge, click opens drawer.
- `src/components/ratings/EvidenceRatingDrawer.tsx` — reusable "Why this rating?" drawer.
- `src/pages/docs/CounterpartyRatingMethodology.tsx` — public methodology page.
- `src/App.tsx` — route `/docs/counterparty-rating-methodology`.

### Build guards (wired into `prebuild`)
- `scripts/check-evidence-rating-parity.mjs` — 48 pins across SSOT and edge mirror.
- `scripts/check-counterparty-rating-audit-names.mjs` — 12 canonical names; forbids drifted `counterparty_rating.*` literals in the two edge functions.
- `scripts/check-evidence-rating-forbidden-words.mjs` — scans rating components for the 9 forbidden user-facing words.
- `scripts/check-stub-provider-copy-drift.mjs` — methodology page added to exempt list (it must name the four stubs to explain the exclusion rule).

### Manifest & docs
- `scripts/edge-function-deploy-manifest.json` — added `compute-evidence-rating` and `evidence-rating-override`.
- `RELEASE_GATE.md` — documented both edge functions and the three new prebuild guards.

### Tests
- `src/tests/p011-counterparty-rating-methodology.test.ts` — 21 tests covering pins, forbidden wording, five client examples, stub-provider exclusion, stale-input rule, public-source threshold, missing-data default, flagged precedence.

## Role × band visibility matrix (V1)

| Role | View badge | Open drawer | See admin block | Apply override |
|---|---|---|---|---|
| Anonymous | No | No | No | No |
| Counterparty user | No (V1) | No | No | No |
| Requester / Trader | Yes | Yes | No | No |
| Compliance analyst | Yes | Yes | Yes (read overrides) | No |
| Compliance owner | Yes | Yes | Yes | Yes |
| Platform admin | Yes | Yes | Yes | Yes |

RLS enforces:
- `counterparty_evidence_ratings` read = members of the owning org or `platform_admin`.
- `counterparty_evidence_ratings` write = `platform_admin` / `compliance_owner` only.
- `counterparty_rating_overrides` read = `platform_admin` / `compliance_owner` / `compliance_analyst`.
- `counterparty_rating_overrides` write = `platform_admin` / `compliance_owner` only.

## 12 canonical audit events

```
counterparty_rating.rating_calculated
counterparty_rating.rating_refreshed
counterparty_rating.rating_changed
counterparty_rating.rating_marked_stale
counterparty_rating.rating_flag_added
counterparty_rating.rating_flag_removed
counterparty_rating.rating_viewed_by_admin
counterparty_rating.rating_override_applied
counterparty_rating.rating_override_changed
counterparty_rating.rating_override_removed
counterparty_rating.rating_recalculation_failed
counterparty_rating.methodology_version_changed
```

## Constraints preserved

- The existing four-pillar `counterparty_ratings` table and badge are unchanged.
- Stub providers (CIPC / Onfido / Dow Jones / Refinitiv) cannot support `verification_complete` (P010 contract preserved).
- No real provider integrations added.
- No counterparty-user can read either table.
- Overrides cannot set `verification_complete` (enforced at the edge function AND at the BEFORE-INSERT trigger).
- Overrides cannot hide an active critical flag (edge function returns `cannot_hide_active_critical_flag`).
- Override expiry is ≤90 days unless reason is `admin_block` (enforced at edge function AND trigger).
- Reason text ≥30 chars (enforced at edge function AND trigger).
- Drawer never recalculates — recalculation is event-driven server-side only.
- All audit emissions go through canonical names; the build guard fails on drift.

## Internal acceptance results

```
[check-evidence-rating-parity] OK (48 pins across 2 files)
[check-counterparty-rating-audit-names] OK (12 canonical names)
[check-evidence-rating-forbidden-words] OK (3 files scanned)
[check-stub-provider-copy-drift] OK (scanned 397 files across 3 roots)
[check-edge-function-deploy-coverage] OK (29 required functions)
[check-release-gate-sync] OK (93 scripts documented)
vitest src/tests/p011-counterparty-rating-methodology.test.ts → 21/21 passed
```

## Out of scope (explicit)

- Live CIPC / Onfido / Dow Jones / Refinitiv integrations (P010 covers their non-live status).
- Retiring or restyling the existing four-pillar reputation badge.
- Real-time recalc subscriptions; recalc remains event-driven via the trigger list documented in the methodology.
- Surface wiring on every list / profile page — the badge + drawer are now mountable and consistent; per-surface placement will follow as those surfaces are individually opened for changes.
