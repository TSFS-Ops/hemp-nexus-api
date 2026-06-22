# Batch 31 — Operating Rules Pre-Client Embarrassment Audit

## 1. Audit scope

Cross-surface verification, consistency, copy, route, UI, backend,
edge-function, API, evidence and release-gate audit across the
operating-rules stream delivered in Batches 24–30, plus the carried
invariants from Batches 21–23. No new features were built. No accepted
guardrail was weakened.

Surfaces re-verified:

- Batch 24 — readiness, business decisions, protected wording.
- Batch 25 — provenance, country coverage, imports, duplicates.
- Batch 26 — search, typeahead, public profile, corrections.
- Batch 27 — claim and authority.
- Batch 28 — bank details.
- Batch 29 — institutional API.
- Batch 30 — outreach, notifications, operations queues, readiness
  dashboard.
- Batch 22 — Trading Desk sidebar persistence.
- Batch 22 — company-profile-level Claim Your Company entry point.
- Batch 23 — typeahead allow-lists.
- Batch 21 — UAT / test hygiene separation.

## 2. Client decision source

Controlling documents (signed):

- `Izenzo_Business_Registry_Operating_Rules_Client_Questionnaire_Completed.docx`
- `Izenzo_Business_Registry_Claim_Rules_Client_Questionnaire_Completed.docx`

Every rule in this audit traces back to one of those documents through
the relevant Batch 24–30 SSOT.

## 3. Cross-surface state matrix

Canonical matrix: `docs/registry/operating-rules-cross-surface-matrix.md`.

Covers readiness states (Batch 24), country capability × workflow
states (Batch 25), claim states (Batch 27), authority states (Batch
27), bank states (Batch 28), API states (Batch 29), outreach /
notification states (Batch 30), audience-scoped dashboard projection
(Batch 30), route / shell invariants (Batches 22 / 23) and the
canonical client-safe fallback wording.

## 4. Frontend / backend consistency result

| Area                            | Result | Pin |
| ------------------------------- | ------ | --- |
| Readiness labels / states       | aligned | Batch 24 SSOT + parity guard |
| Provenance + country coverage   | aligned | Batch 25 SSOT + guards |
| Search / typeahead / profile    | aligned | Batch 26 SSOT + Batch 23 typeahead |
| Claim + authority workflows     | aligned | Batch 27 SSOT + Batch 22 profile CTA |
| Bank capture / verification     | aligned | Batch 28 SSOT (raw never returned) |
| Institutional API               | aligned | Batch 29 SSOT (`DEFAULT_ENVIRONMENT=sandbox`, raw-bank blocked) |
| Outreach / AI / DNC             | aligned | Batch 30 SSOT (`AI_DRAFT_ONLY=true`, `AUTO_SEND=false`) |
| SMS / WhatsApp disabled labels  | aligned | `SMS not configured`, `WhatsApp not configured` |
| Trading Desk shell wrapping     | aligned | Batch 22 source-pin test |
| Release-gate default            | aligned | not `production_ready` |

## 5. Role-based user-view result

Public / anonymous, registered-unverified, registered-verified,
claim-only, claim-approved-limited, authority-active (general / bank /
API), authority expired / disputed / revoked, company-authorised,
API client admin, support_user, data_governance_owner,
finance_operations, technical_admin, platform_admin, compliance_owner.

All representative roles behave per their Batch 27 / 28 / 29 / 30 SSOT
definitions. Public viewers do not see internal notes, risk comments,
licence details, reviewer names, import confidence or import batch IDs
(Batch 30 audience projection). Bank account numbers are masked by
default; unmask requires AAL2 + reason + audit (Batch 28).

## 6. Route / shell result

Every `/desk/registry/*` route resolves inside `<DeskLayout>` — sidebar
persists, no `<DeskFullBleed>` wrapper, no shell escape. Pinned by
`src/tests/batch-22-registry-shell-claim-entry.test.ts` and
`src/tests/batch-31-operating-rules-pre-client-audit.test.ts`.

## 7. Wording scan result

The wider registry guard fleet (see `package.json` `prebuild`) plus
this batch's new `check-batch-31-cross-surface-consistency.mjs` rerun
the forbidden-wording sweeps from Batches 18 / 20 / 24 / 30 — no
unsafe `verified` / `live` / `guaranteed` / `production-ready` /
`bank verified` / `API ready` strings appear on client-facing
surfaces. Canonical fallback strings (Section 10 of the cross-surface
matrix) are used.

## 8. Sensitive data leakage result

No surface exposes raw bank numbers, BVN, identity documents, raw
claim / authority / bank evidence, provider payloads or credentials,
full API keys / secrets, personal emails / phones / addresses, source
licence details to external users, internal notes, risk comments,
reviewer names, import confidence to public users, import batch IDs to
public users, raw dispute notes to public users, or unapproved old
correction values to public users.

## 9. Backend enforcement result

Every frontend promise from §10 of the prompt is backed by the
relevant SSOT helper. The browser SSOT and the Deno mirror are held
byte-identical by the per-batch parity guards listed in
`docs/registry/operating-rules-developer-handover.md`.

## 10. Evidence / documentation result

- `RELEASE_GATE.md` — default final status is **not**
  `production_ready`.
- `evidence/registry-evidence-index/README.md` — Batches 24–31 rows
  present.
- `docs/registry/api-operating-rules.md`,
  `docs/registry/bank-detail-operating-rules.md`,
  `docs/registry/claim-authority-operating-rules.md`,
  `docs/registry/operations-outreach-notifications-readiness-rules.md`,
  `docs/registry/provenance-country-import-duplicate-rules.md`,
  `docs/registry/search-profile-correction-rules.md`,
  `docs/registry/client-safe-limitations.md` — aligned, no overclaim.

## 11. Developer handover result

`docs/registry/operating-rules-developer-handover.md` created. Lists
every SSOT pair, every parity guard, the per-batch `check:batch-21..31`
scripts, the registry slice test command, the legacy test quarantine
location, and the items that may not be changed without a new
recorded business decision.

## 12. User-view checklist result

All six checklists in §13 of the prompt (public, registered,
claim-approved-limited, authority-active, company bank-scope, API
client admin, admin / compliance) match the SSOT-defined behaviour.

## 13. Fixes made in this batch

- Added `docs/registry/operating-rules-developer-handover.md`.
- Added `docs/registry/operating-rules-cross-surface-matrix.md`.
- Added `scripts/check-batch-31-cross-surface-consistency.mjs` and
  wired it as `check:batch-31`.
- Added `src/tests/batch-31-operating-rules-pre-client-audit.test.ts`.
- Wired the previously-missing `check:batch-30` package script.
- Appended Batch 31 row to
  `evidence/registry-evidence-index/README.md`.

## 14. Unresolved items

None.

- `client_blocking` count: **0**
- `uat_blocking` count: **0**
- `internal_followup` count: 0
- `non_blocking` count: 0

Deferred items unchanged from Batch 20: live provider verification,
production API issuance, SMS / WhatsApp sending — all remain
`accepted_limitation` and continue to be labelled per the canonical
fallback wording.

## 15. Test summary

- `src/tests/batch-31-operating-rules-pre-client-audit.test.ts`
  source-pins SSOT presence, Batch 30 disabled labels, Batch 29
  sandbox / raw-bank-blocked invariants, Trade Desk shell wrapping,
  profile-level claim CTA, typeahead safety, release-gate default,
  evidence-index presence, handover + matrix presence.
- Carried suites still green: `batch-22-registry-shell-claim-entry`,
  `batch-23-registry-typeahead`, `batch-24..30` source-pin tests.

## 16. Guard summary

- New: `scripts/check-batch-31-cross-surface-consistency.mjs`
  (`check:batch-31`).
- Re-asserted (existing): `check:batch-21..30` plus the wider
  registry guard fleet listed in `package.json` `prebuild`.

## 17. Final client-readiness recommendation

**Safe to prepare client-facing summary / UAT / demo note.**

Status: `BATCH_31_OPERATING_RULES_PRE_CLIENT_AUDIT_COMPLETE`
