# Registry Operating Rules — Developer Handover (Batch 31)

This is the entry point for any developer touching the Izenzo Business
Registry operating-rules stream (Batches 24–30). Read this BEFORE
changing any SSOT, edge function, UI label, route, evidence README,
release-gate row or guard.

The client decisions encoded here come from two signed questionnaires:

- `Izenzo_Business_Registry_Operating_Rules_Client_Questionnaire_Completed.docx`
- `Izenzo_Business_Registry_Claim_Rules_Client_Questionnaire_Completed.docx`

Do not change anything that contradicts those documents without a new
recorded business decision.

## 1. Where the SSOTs live

Every rule has a browser SSOT under `src/lib/` and a byte-identical
Deno mirror under `supabase/functions/_shared/`. The pair is held
together by a per-batch parity guard.

| Batch | Topic                                        | Browser SSOT                                                  | Deno mirror                                                                   | Parity guard                                                              |
| ----- | -------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 24    | Readiness, business decisions, wording       | `src/lib/registry-operating-rules.ts`                         | `supabase/functions/_shared/registry-operating-rules.ts`                      | `scripts/check-registry-operating-rules-parity.mjs`                       |
| 25    | Provenance, country coverage, imports, dupes | `src/lib/registry-provenance-import-rules.ts`                 | `supabase/functions/_shared/registry-provenance-import-rules.ts`              | `scripts/check-registry-provenance-import-rules-parity.mjs`               |
| 26    | Search, typeahead, profile, corrections      | `src/lib/registry-search-profile-rules.ts`                    | `supabase/functions/_shared/registry-search-profile-rules.ts`                 | `scripts/check-registry-search-profile-rules-parity.mjs`                  |
| 27    | Claim + authority                            | `src/lib/registry-claim-authority-rules.ts`                   | `supabase/functions/_shared/registry-claim-authority-rules.ts`                | `scripts/check-registry-claim-authority-rules-parity.mjs`                 |
| 28    | Bank details                                 | `src/lib/registry-bank-operating-rules.ts`                    | `supabase/functions/_shared/registry-bank-operating-rules.ts`                 | `scripts/check-registry-bank-operating-rules-parity.mjs`                  |
| 29    | Institutional API                            | `src/lib/registry-api-operating-rules.ts`                     | `supabase/functions/_shared/registry-api-operating-rules.ts`                  | `scripts/check-registry-api-operating-rules-parity.mjs`                   |
| 30    | Outreach, notifications, ops, dashboard      | `src/lib/registry-operations-outreach-rules.ts`               | `supabase/functions/_shared/registry-operations-outreach-rules.ts`            | `scripts/check-registry-operations-outreach-rules-parity.mjs`             |

Trade Desk shell + profile-level claim entry: `src/lib/use-registry-base.ts`
(`useRegistryBase`, `rebaseRegistryPath`). Source-pinned by
`src/tests/batch-22-registry-shell-claim-entry.test.ts` and
`src/tests/batch-23-registry-typeahead.test.ts`.

## 2. What each SSOT controls

- **Batch 24** — `REGISTRY_READINESS_STATES`, `REGISTRY_PUBLIC_SEARCH_BLOCKED_STATES`,
  `REGISTRY_API_OUTPUT_BLOCKED_STATES`, `REGISTRY_FIELD_GROUPS`,
  `REGISTRY_BUSINESS_DECISION_TYPES`, `REGISTRY_PROTECTED_WORDING`,
  `REGISTRY_ALWAYS_BLOCKED_WORDING`, `REGISTRY_FALLBACK_WORDING`.
- **Batch 25** — source types, licensed-dataset wording, manual-review
  fields, source priority, country capability × workflow state matrix,
  pre-import checklist, quarantine fields, duplicate thresholds.
- **Batch 26** — field classification, public/officer/email/phone search
  rules, typo floor 0.85 / public floor 0.75, public match reasons,
  no-result CTA, public profile field tiers, correction versioning.
- **Batch 27** — registered+email-verified gate, claimant role
  dispositions, evidence matrix per legal form, claim approval
  limitations, 7-scope authority allow-list, 12-month / 6-month
  expiries, two-person approval for bank/API/manage_users, no
  self-approval, expired/revoked/disputed blocks.
- **Batch 28** — bank submission requires `authority_active` +
  `submit_bank_details` / `bank_submit`; country-specific fields;
  multi-account limits; third-party account governance; verification
  label rules; mask/unmask tiers (AAL2 + reason + audit for unmask);
  manual ≠ provider; payment-status usability.
- **Batch 29** — `DEFAULT_ENVIRONMENT=sandbox`; 16-item production gate;
  sensitive scopes; search-key classification; raw-bank API blocked;
  rate limits + suspension; canonical logging fields.
- **Batch 30** — AI draft categories (`REGISTRY_OPS_AI_DRAFT_ONLY=true`,
  `REGISTRY_OPS_AI_MAY_AUTO_SEND=false`), do-not-contact, queue order,
  SLAs, alerts-but-no-auto-approval, readiness audience projection,
  build-vs-data split, `SMS not configured` / `WhatsApp not configured`
  pinned labels.

## 3. Guards that must stay green

Per-batch parity + content guards (wired in `package.json` under
`check:batch-21` through `check:batch-30`):

```
npm run check:batch-21   # UAT hygiene
npm run check:batch-22   # shell + profile-level claim entry
npm run check:batch-23   # typeahead allow-lists
npm run check:batch-24   # operating rules parity
npm run check:batch-25   # provenance/import parity + no generic country-covered
npm run check:batch-26   # search/profile parity + allow-lists
npm run check:batch-27   # claim/authority parity
npm run check:batch-28   # bank operating rules parity
npm run check:batch-29   # API operating rules parity
npm run check:batch-30   # outreach/ops/notifications parity
npm run check:batch-31   # cross-surface consistency sweep (Batch 31)
```

The `prebuild` script in `package.json` also runs the wider registry
guard fleet (parity, audit names, no-raw-bank leaks, no-verified
wording, no-auto-send, route-safe, etc.). Do not delete entries.

## 4. How to run the registry slice

```
npm run check:batch-24 && \
npm run check:batch-25 && \
npm run check:batch-26 && \
npm run check:batch-27 && \
npm run check:batch-28 && \
npm run check:batch-29 && \
npm run check:batch-30 && \
npm run check:batch-31

# Source-pin tests for Batches 22–31:
npx vitest run \
  src/tests/batch-2[2-9]*.test.ts \
  src/tests/batch-30*.test.ts \
  src/tests/batch-31*.test.ts
```

## 5. How legacy tests are separated

Batch 21 quarantined stale source-pin tests under
`src/tests/_quarantine/` (see `docs/registry/uat-execution-summary.md`).
The CI-only UAT journey suite is gated on
`UAT_PROVISIONING_ENABLED=1`. Client-facing evidence READMEs
(`evidence/batch-2[1-9]*/README.md`, `evidence/batch-30*/README.md`,
`evidence/batch-31*/README.md`) carry no raw failed-test counts.

## 6. What must not be changed without a new client/business decision

- Production-ready default — registry final status is **not**
  `production_ready` (Batch 18 / Batch 20).
- Sample / seed / demo records — always carry the sample chip and the
  exact `Sample record` / `Demo only` wording (Batches 19A / 22 / 24).
- SMS and WhatsApp — pinned `not configured` (Batches 19B / 30).
- AI outreach — draft-only, never auto-send (Batches 6 / 7 / 30).
- Claim approval — `claim_approved_limited` (Batches 19A / 27).
- Bank verification — manual ≠ provider, raw fields never returned by
  default, unmask requires AAL2 + reason + audit (Batches 13–14B / 28).
- Institutional API — sandbox is the default; production requires the
  16-item gate (Batches 15 / 15B / 29).
- Trade Desk shell — every `/desk/registry/*` route is wrapped in
  `<DeskLayout>`, no `<DeskFullBleed>` (Batch 22).

If you need to change one of the above, raise it as a new operating-rule
decision, capture it in the relevant Batch SSOT, update the matching
guard, refresh the evidence README, and only then change the UI.

## 7. Cross-surface matrix

The Batch 31 cross-surface matrix —
`docs/registry/operating-rules-cross-surface-matrix.md` — is the
canonical view of every registry state and how it should appear in the
SSOT, edge function, admin UI, company/user UI, public UI, API
response and evidence. Use it as the lookup before touching any label.
