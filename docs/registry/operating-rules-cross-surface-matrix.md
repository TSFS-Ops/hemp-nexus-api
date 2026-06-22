# Registry Operating Rules — Cross-Surface State Matrix (Batch 31)

Pre-client embarrassment audit reference. For every important registry
state, this matrix pins:

- the canonical SSOT label / constant;
- the user-facing wording that must appear;
- which viewers may see it;
- whether the state is action-permitting or action-blocking;
- which guard / test pins it.

Source documents: signed client operating-rules and claim-rules
questionnaires (`docs/registry/`). SSOT files: see
`docs/registry/operating-rules-developer-handover.md`.

> No state in this matrix may be relabelled, surfaced to a wider
> audience, or have its action gate relaxed without a new recorded
> business decision.

## 1. Readiness states (Batch 24)

| State                  | UI label                  | Public UI | Logged-in UI | Admin UI | API output | Notes / pin |
| ---------------------- | ------------------------- | --------- | ------------ | -------- | ---------- | ----------- |
| `not_started`          | Not started               | hidden    | hidden       | shown    | excluded   | Batch 1 readiness SSOT |
| `shell_ready`          | Shell only                | hidden    | hidden       | shown    | excluded   | Carries "not a record of truth" copy |
| `test_data_ready`      | Test data only            | hidden    | hidden       | shown    | excluded   | Internal walkthroughs only |
| `provider_pending`     | Provider pending          | hidden    | hidden       | shown    | excluded   | "external provider check is not live or not approved" |
| `data_pending`         | Data pending              | hidden    | hidden       | shown    | excluded   | Licence/source not yet loaded |
| `licence_pending`      | Licence pending           | hidden    | hidden       | shown    | excluded   | Held back until decision register confirms |
| `admin_only`           | Admin only                | hidden    | hidden       | shown    | excluded   | No end-user surface |
| `sample_only`          | Sample record             | chip      | chip         | chip     | sandbox `verified_by_izenzo=false` / production excluded | Batch 19A / 22 |
| `imported_unverified`  | Sourced — not independently verified by Izenzo | chip | chip | chip | sandbox only | Batch 22 |
| `seed_only`            | Seed data — internal      | hidden    | hidden       | shown    | excluded   | Never public-search-ready |
| `client_demo_ready`    | Client demo only          | hidden    | label        | label    | excluded   | "Not production verified" |
| `production_ready`     | Production ready          | shown     | shown        | shown    | included   | Never the default |
| `disabled`             | Disabled                  | hidden    | hidden       | shown    | excluded   | Switched off by recorded decision |

Forbidden words (Batch 18 / 20 / 24): `verified`, `live`, `guaranteed`,
`production-ready`, `bank verified`, `API ready`, `cleared`,
`risk-free`. Allowed only when the SSOT gate is satisfied OR inside a
controlled internal test name.

## 2. Country capability states (Batch 25)

For each country × workflow: `not_configured`, `data_pending`,
`data_loaded_workflow_not_active`, `public_search_ready`, `claim_ready`,
`authority_ready`, `correction_ready`, `bank_capture_ready`,
`bank_verification_ready`, `api_sandbox_ready`, `api_production_ready`,
`provider_pending`.

- Public UI never says "country covered" (Batch 25 guard
  `check-registry-provenance-no-generic-country-covered.mjs`).
- Each row uses the SSOT label verbatim. Anything below
  `public_search_ready` is hidden from public search.
- `api_production_ready` requires the 16-item Batch 29 gate.

## 3. Claim states (Batch 27)

| State                    | User UI                                 | Admin UI | Unlocks |
| ------------------------ | --------------------------------------- | -------- | ------- |
| `enquiry_started`        | Enquiry started                         | queued   | none |
| `claim_started`          | Claim started — evidence required       | queued   | none |
| `evidence_submitted`     | Evidence submitted — under review       | queued   | none |
| `under_review`           | Under review                            | active   | none |
| `more_evidence_required` | More evidence required                  | active   | none (claimant action) |
| `unlisted_claimant_review` | Under compliance review               | active   | blocks edit / bank / API / sensitive authority |
| `competing_claim`        | Competing claim — compliance review     | active   | blocks self-approval |
| `disputed_claim`         | Disputed — compliance review            | active   | blocks claim-derived actions |
| `claim_approved_limited` | Claim approved — limited                | closed   | non-sensitive profile edit + authority request only |
| `rejected`               | Not approved                            | closed   | none |

`claim_approved_limited` never unlocks bank submission, API consent or
`manage_users`. Pinned by Batch 19A and Batch 27 guards.

## 4. Authority states (Batch 27)

States: `requested`, `evidence_submitted`, `authority_active`,
`authority_disputed`, `authority_expired`, `authority_revoked`,
`compliance_review`.

- Scopes: closed allow-list of 7. Bank / API / `manage_users` require
  two-person approval (`platform_admin` + `compliance_owner`).
- Default expiry: 12 months. Bank / API: 6 months.
- Self-approval blocked. `expired` / `revoked` / `disputed` /
  `compliance_review` block sensitive actions.
- Authority is **never full by default**.

## 5. Bank-detail states (Batch 28)

`submitted`, `company_confirmed`, `manually_checked`,
`manual_bank_check_complete`, `provider_verified`, `bank_confirmed`,
`institution_confirmed`, `pending`, `disputed`, `revoked`, `expired`,
`failed`, `third_party_account_pending_review`,
`third_party_account_blocked`, `re_verification_required`.

- `company_confirmed` is **not** "verified".
- `manually_checked` / `manual_bank_check_complete` are **not** provider
  verification and carry the canonical demo copy.
- Manual validity: 90 days. Provider / bank / institution: 180 days.
- Raw bank fields are never returned by default. Unmask requires AAL2 +
  reason + audit. Payment-status API usable only for the four approved
  verification states + evidence + authority/consent + permitting
  business decision.

## 6. API states (Batch 29)

`sandbox_only`, `production_requested`, `production_blocked`,
`production_approved`, `api_output_ready`, `api_pending`, `suspended`,
`quota_warning`, `quota_exceeded`, `payment_status_usable`,
`payment_status_not_usable`.

- `DEFAULT_ENVIRONMENT=sandbox`. `PUBLIC_SELF_SERVE_PRODUCTION=false`.
- Production requires the 16-item gate. `expired` / `disputed` /
  `licence_pending` / `provider_pending` decisions block production.
- Raw-bank endpoint does not exist.
- API clients see only their own logs. Company-visible logs limited to
  4 safe fields. Sensitive endpoints: 10/min, 1,000/day.

## 7. Outreach / notification states (Batch 30)

`drafted`, `approved`, `sent_email`, `manual_contact_logged`,
`sms_not_configured`, `whatsapp_not_configured`,
`do_not_contact_active`.

- AI is draft-only (`REGISTRY_OPS_AI_DRAFT_ONLY=true`,
  `REGISTRY_OPS_AI_MAY_AUTO_SEND=false`).
- `SMS not configured` and `WhatsApp not configured` are the exact
  required UI labels and are pinned at
  `REGISTRY_OPS_SMS_DISABLED_LABEL` /
  `REGISTRY_OPS_WHATSAPP_DISABLED_LABEL`.
- Do-not-contact blocks drafting, approval and sending. Removal
  requires `platform_admin` + `compliance_owner`.
- Overdue SLAs raise alerts but never auto-approve.

## 8. Audience-scoped readiness dashboard (Batch 30)

External viewers (`requester`, `counterparty`, `public`) NEVER see:

- internal notes;
- risk comments;
- source licence details;
- reviewer names;
- import confidence scores;
- import batch IDs;
- provider payloads;
- raw bank or personal contact fields.

The dashboard separates **Build Readiness** from **Data Readiness** and
projects through `projectReadinessForAudience()` (Batch 30).

## 9. Route / shell invariants (Batch 22 / 23)

Every `/desk/registry/*` route is inside `<DeskLayout>` — sidebar
visible, no `<DeskFullBleed>` wrapping registry routes. Profile-level
"Is this your company?" panel lives on `CompanyProfile.tsx`. Typeahead
uses the safe `registry-company-search` edge function and the
`SAFE_MATCH_FIELDS` allow-list.

## 10. Canonical client-safe fallback wording

- "This information is sourced from the records shown and has not been
  independently verified by Izenzo."
- "Sourced from licensed dataset — not independently verified by
  Izenzo."
- "Demo-ready — controlled demonstration data. Not production
  verified."
- "Demo only — shown for controlled demonstration. Not production
  data or verification."
- "Provider pending — the external provider check is not live or not
  approved for this record."
- "Manual evidence reviewed — no live provider check performed."
- "Not available for production API output."
- "Built — data/use approval pending."
- "Data loaded — workflow not active."
- "SMS not configured."
- "WhatsApp not configured."

Any deviation from these strings is a Batch 31 finding.
