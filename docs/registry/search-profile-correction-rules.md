# Batch 26 — Search, Typeahead, Public Profile and Corrections Rules

Client decision source:
`docs/registry/Izenzo_Business_Registry_Operating_Rules_Client_Questionnaire_Completed.docx`

The machine-readable SSOT for this document is
[`src/lib/registry-search-profile-rules.ts`](../../src/lib/registry-search-profile-rules.ts),
mirrored at
[`supabase/functions/_shared/registry-search-profile-rules.ts`](../../supabase/functions/_shared/registry-search-profile-rules.ts)
with byte-parity enforced by
`scripts/check-registry-search-profile-rules-parity.mjs`.

## Field classification

Five classes drive every search and profile decision:

| Class | Audience | Examples |
| --- | --- | --- |
| `public_searchable` | anyone | legal name, trading name, registration/local id, country, jurisdiction, city/province (where permitted), industry, source-approved status |
| `logged_in_searchable` | signed-in users | broader address, website, claimed profile name, approved public contacts |
| `admin_only` | platform admins | officers, UBO, personal email/phone, correction/dispute notes, import batch, confidence scores, internal status, provider payloads |
| `api_only_with_approved_scope` | API clients within scope | registration number, country, profile status, approved identifiers, approved readiness label |
| `excluded` | nobody, ever | raw bank details, identity documents, passwords/secrets, private notes, restricted personal data |

## Officer / email / phone restrictions

- Public officer-name search is **disabled** in V1.
- Logged-in officer-name search is allowed only when source licence
  permits, the field group is manually reviewed and approved for
  logged-in search, and no privacy/compliance hold is present.
- API officer-name search requires special approval, a lawful basis,
  matching client contract scope, and compliance_owner approval.
- Officer-name match results display the caution
  "Person relationship may be incomplete or stale - check source and date."
- Public search by email or phone is **excluded**.
- API email/phone search requires special approval, licence/consent,
  rate limits, abuse monitoring, and compliance_owner approval.

## Matching rules

- Partial matches: company legal/trading names only, minimum 3
  characters, country filter recommended, never against bank, tax,
  identity or sensitive fields.
- Typo-tolerant matches: company names only, confidence floor 0.85,
  never on bank/tax/identity fields.
- Abbreviations: only the approved legal-suffix list (`Pty`, `Ltd`,
  `PLC`, `CC`, `SARL`, `LLC`, …).
- Exact identifier matches always outrank fuzzy name matches.
- Results below 0.75 confidence are suppressed for public and ordinary
  logged-in users.

## Safe match reasons

Only the seven labels in `PUBLIC_SAFE_MATCH_REASONS` may appear in
search results or the Batch 23 typeahead. All other match telemetry
(source confidence, duplicate score, officer match, phone/email match,
import batch, provider score, internal note) is admin-only.

## No-result workflow

- Wording: "No matching company found in the currently searchable registry."
- Logged-in users may submit a "Request company addition" form with
  company name, country, registration number if known, website/source
  link, requester reason and optional evidence.
- Submission emits `company_addition_requested` to the admin queue
  only. It must not create a public record, a claim, a POI, or an
  API-ready record.
- Unauthenticated users see a safe prompt to sign in before requesting
  addition. No sensitive evidence is collected anonymously.

## Public profile visibility

`PUBLIC_PROFILE_FIELDS`, `MASKED_OR_LOGGED_IN_PROFILE_FIELDS`,
`ADMIN_ONLY_PROFILE_FIELDS`, `API_ONLY_PROFILE_FIELDS` and
`EXCLUDED_PROFILE_FIELDS` encode the visibility tiers from the client
questionnaire. The profile UI uses the wording strings in
`PROFILE_WORDING` for "not independently verified", "demo only",
"provider pending", "manual evidence reviewed" and "API not ready".

## Corrections workflow

- Submissions capture affected field, reason, source link/document,
  submitter contact and optional evidence.
- Reviewer routing: `data_governance_owner` for ordinary fields,
  `compliance_owner` for officers, directors, members, UBO, authority,
  bank details, dispute status, personal email/phone or identity
  documents.
- Corrections are versioned (`CorrectionVersion[]`) on top of the
  current approved value. Rejected corrections remain in admin-only
  history. Old values are admin-only by default.
- Material disputes mark the field `disputed_under_review`. While that
  state is active the field may be hidden from public and API output.
- No correction replaces the current approved value automatically.

## Trading Desk shell

All search, profile and correction routes already accepted in
Batches 22 and 23 continue to honour the `/desk/registry/*` shell base
and shell-aware navigation helpers. Batch 26 introduces no client-side
component that bypasses `useRegistryBase` / `rebaseRegistryPath`.
