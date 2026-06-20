## P011 — Counterparty Rating Methodology Visibility

This is a large enterprise build. Before I start, I need confirmation on **one structural decision** that determines the whole shape of the batch.

## Critical context: there is already a "counterparty rating" in the codebase

`counterparty_ratings` already exists as a **four-pillar deal-history reputation score** (platinum / gold / silver / bronze / new / insufficient_history), surfaced via `CounterpartyRatingBadge` on `MatchHeroCard`. It is derived from settled-deal performance, not from KYB/sanctions/UBO/evidence.

P011 specifies a **different concept**: an *evidence-confidence* signal (Limited Information / Public-Source Supported / Admin-Reviewed / Verification Complete / Flagged) derived from public-source signals, live KYB/sanctions/UBO, evidence completeness, admin review, and flags. It explicitly forbids "Trusted" / "Safe" wording — which clashes with the existing reputation bands' implicit framing.

**Decision needed:** I will build P011 as a **separate, parallel rating** ("Evidence Confidence") rather than renaming or repurposing the existing reputation product. The existing four-pillar rating remains untouched. The new P011 surface is the one referenced in the questionnaire. If you prefer to retire the existing reputation badge, that is a separate batch.

If that decision is not what you want, stop me here. Otherwise, I will execute the plan below in full and only return `P011_COUNTERPARTY_RATING_METHODOLOGY_VISIBILITY_COMPLETE` once every item is green.

## Scope (single batch)

### A. Schema (one migration)

Two new public-schema tables, with GRANTs + RLS + policies:

- `counterparty_evidence_ratings` — durable current rating snapshot per (org_id, counterparty_id). Columns: rating_band (enum), methodology_version, calculated_at, calculation_trigger, freshness_state, supporting_factors_json, input_summary_json, missing_inputs_json, stale_inputs_json, workflow_effect_json, has_admin_override, override_id, audit refs, std timestamps.
- `counterparty_rating_overrides` — controlled admin overrides. Columns: old_rating, override_rating, reason_code (enum: 8 approved codes), reason_text (≥30 chars enforced by trigger), evidence_document_id, expires_at (≤90 days unless admin_block, enforced by trigger), created_by/at, updated_by/at, removed_by/at, removal_reason.
- Postgres enums: `evidence_rating_band`, `evidence_rating_freshness`, `evidence_rating_override_reason`.
- RLS: tenant isolation via org_id, requester/trader/compliance/admin read via existing role helpers, override write only by `platform_admin` / `compliance_owner`, no anon, no counterparty-user read (enforced via `has_role` checks excluding counterparty role).
- Triggers validate reason_text length, expiry window, and prevent override→`verification_complete` unless input_summary shows all live required checks complete + fresh.

### B. SSOT module (`src/lib/evidence-rating.ts` + edge mirror `supabase/functions/_shared/evidence-rating.ts`, parity-checked)

Pins:
- 5 bands (exact strings), user wording, internal rule strings.
- Disclaimer wording (verbatim).
- Allowed/excluded input keys.
- Freshness windows (30d / 7d / 12m / 90d).
- Forbidden UI words (`safe`, `trusted`, `approved`, `compliant`, `low risk`, `high risk`, `guaranteed`, `cleared`, `bank verified`).
- 8 approved override reason codes.
- 12 canonical audit event names (`counterparty_rating.*`).
- Methodology version constant (`COUNTERPARTY_RATING_METHODOLOGY_VERSION = "1.0"`).
- Pure `computeEvidenceRating(inputs)` function — deterministic, used by edge function and by tests.

### C. Edge function `compute-evidence-rating`

- Server-side computation triggered by the 11 declared events (POI state changes, KYB completion, sanctions result, document upload/expiry, admin review change, override change, methodology change, scheduled stale-check).
- Reads inputs from existing tables: `screening_results`, `kyc_status`, `entities`, `dd_risk_scores`, `match_documents`/`match_counterparty_intel`, `disputes`, `pois`, `wads`, `counterparty_rating_overrides`.
- Excludes stub providers (uses existing P010 `isStubProvider`) — they cannot support `verification_complete`.
- Writes one row to `counterparty_evidence_ratings` (upsert by (org_id, counterparty_id)) + audit events `counterparty_rating.rating_calculated` / `rating_refreshed` / `rating_changed` / `rating_marked_stale` / `rating_recalculation_failed`.
- On failure: keeps previous row, sets `freshness_state = error`, emits `rating_recalculation_failed`. Never throws to caller.

### D. Edge functions for overrides

`evidence-rating-override-apply` / `-change` / `-remove`:
- JWT + `has_role('platform_admin')` OR `has_role('compliance_owner')`.
- Validates reason code (one of 8), reason text ≥30 chars, expires_at ≤ now+90d (unless `admin_block`), block on `verification_complete` upgrade when live inputs not satisfied, block on hiding active critical sanctions/PEP.
- Emits `counterparty_rating.rating_override_applied` / `_changed` / `_removed`.
- Triggers a recalc.

### E. UI: reusable "Why this rating?" drawer

`src/components/ratings/EvidenceRatingDrawer.tsx`:
- Reads from `counterparty_evidence_ratings` for given (org_id, counterparty_id).
- Renders: band label, plain-English meaning, methodology version + link, last calculated, top 3 supporting factors, all checks with status chips (Completed / Not Run / Pending / Failed / Expired / Stale / Not Applicable), missing inputs for next band, admin review state (safe wording), workflow effect, next required action, verbatim disclaimer.
- Admin-only block (gated via `useUserRole` + RLS): full input breakdown, override reason, admin notes, audit event IDs, internal flags.
- Counterparty-user role: drawer not opened; badge hidden.

`src/components/ratings/EvidenceRatingBadge.tsx`:
- 5-band badge using semantic tokens (no hardcoded colors).
- Forbidden-word guard at render time (dev-only assertion).
- Click → opens drawer.

### F. Surface integration (consistent badge+drawer everywhere)

Add `EvidenceRatingBadge` on:
- counterparty search results, counterparty profile (`/counterparties/:id`), trade request pages, match pages (alongside but distinct from existing reputation badge), POI pre-gate, WaD readiness/pre-gate, admin counterparty review, compliance review surface.

Role visibility enforced via existing `useUserRole` hook + RLS.

### G. Methodology docs page

`src/pages/docs/CounterpartyRatingMethodology.tsx` + route added in `App.tsx` and `docs/Index`:
- Title: "Counterparty Rating Methodology v1.0".
- Sections: 5 bands, allowed inputs, excluded inputs, missing/stale rules, freshness table, workflow impact, disclaimer, why ratings are not guarantees.
- Linked from the drawer.

### H. Audit-name guard

Extend `scripts/check-ai-review-audit-names.mjs` pattern → new script `scripts/check-counterparty-rating-audit-names.mjs`:
- Pins the 12 canonical event names; fails build if the SSOT drifts or any new emit-site uses an off-spec name.
- Add to `prebuild` and to `RELEASE_GATE.md`.

New script `scripts/check-evidence-rating-forbidden-words.mjs`:
- Scans `src/components/ratings/**`, `src/pages/**` (rating surfaces), `docs/**` for the 9 forbidden words near "rating" context. Wired into `prebuild` + `RELEASE_GATE.md`.

Extend the existing `scripts/check-stub-providers-parity.mjs`-style parity guard with `scripts/check-evidence-rating-parity.mjs` for the new SSOT mirror.

### I. Tests (vitest)

`src/tests/p011-counterparty-rating-methodology.test.ts`:
- 5 fixture examples (TEST Alpha / Beta / Gamma / Delta / Echo) → exact band + correct check chips + disclaimer present.
- Forbidden wording never appears in band labels, drawer copy, methodology page constants.
- Missing data → `limited_information`.
- Negative signal → `flagged`.
- Stale input cannot support `verification_complete`.
- Stub providers (CIPC/Onfido/Dow Jones/Refinitiv) cannot support `verification_complete`.
- Public-source band requires ≥2 approved signals + 1 matched identifier.
- Override: reason text length, expiry window, admin_block allowed >90d, cannot upgrade to `verification_complete` without live inputs, cannot hide active critical sanctions.
- Recalculation does not run on render (component never calls compute function directly; only reads).
- Recalc failure preserves last rating + sets freshness=error.
- Role visibility: requester/trader/compliance/admin/counterparty/anon matrix.
- 12 audit event names pinned.
- Methodology version pinned at "1.0" and preserved on historical rows (snapshot insert never updates the version column of a prior row).
- Cross-tenant isolation (RLS): query with org_a token returns no rows for org_b.

`supabase/functions/compute-evidence-rating/index.test.ts`: 401/403/400 negative paths; idempotent recalc; failure path writes `rating_recalculation_failed`.

`supabase/functions/evidence-rating-override-apply/index.test.ts`: 401/403/400/reason-too-short/expiry-too-far/cannot-hide-sanctions.

### J. Evidence + governance docs

- `evidence/p011-counterparty-rating-methodology/README.md` with the standard structure (files changed, band × role matrix, audit names, test output, final status).
- Update `RELEASE_GATE.md` "Edge functions requiring deploy" with the 4 new functions and the 3 new prebuild scripts under their documentation section.
- Update `mem://index.md` if a new persistent rule is needed (likely yes — to prevent the existing four-pillar badge from being confused with the new evidence rating).

### Constraints I will hold

- No new scopes / roles created; only existing `platform_admin`, `compliance_owner`, `requester`, `trader`, `counterparty`, `compliance_analyst`, `developer` roles used.
- Existing four-pillar `counterparty_ratings` table untouched.
- No stub provider (P010) can support `verification_complete`.
- Ratings never auto-progress POI/WaD; only `flagged` *blocks* WaD progression pending admin/compliance review (gate enforced in WaD function, not in rating function).
- No real provider integrations added.
- No counterparty-user can read either table (RLS).
- All audit writes are append-only; no payload-level secrets stored.

### Out of scope (explicit)

- Live CIPC/Onfido/Dow Jones/Refinitiv integrations (P010 covers their non-live status).
- Retiring / restyling the existing four-pillar reputation badge.
- Building a Playwright role-negative E2E spec (will add only if the area already has one; otherwise vitest matrix is the V1 coverage).
- Real-time recalc subscriptions; recalc is event-driven via the trigger list.

## Confirm with one word

- **proceed** → I implement A-J in full, run all guards + tests, and report final status.
- Anything else → I adjust the plan before any file changes.