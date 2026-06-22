# Registry API Operating Rules (Batch 29)

This document describes the institutional API operating rules encoded by the
SSOT at `src/lib/registry-api-operating-rules.ts` (Deno mirror at
`supabase/functions/_shared/registry-api-operating-rules.ts`).

## Allowed client types

Banks, DFIs, insurers, regulated platforms, enterprise clients, named pilot
clients approved by `platform_admin`. **No public/self-serve production API
access in V1.** Default environment is `sandbox`.

## Production access gate (16 requirements)

A client may receive production API access only when **all** of the following
are satisfied:

1. Signed contract or written pilot approval
2. Approved client organisation
3. Approved use case
4. Sandbox testing complete
5. Production scope approval
6. API key with expiry and scopes
7. Usage and quota limits set
8. Billing or token rule set
9. Data-use decision approved
10. Security settings complete
11. Audit logging enabled
12. Client owner assigned
13. Support contact assigned
14. Country and field readiness
15. `platform_admin` approval
16. `compliance_owner` approval for sensitive scopes

Production access is **also** blocked when the relevant business decision is
`expired`, `disputed`, `licence_pending`, or `provider_pending`, when the
country is not API-production-ready, when the field scope is not
API-output-ready, when client scope does not cover the request, when the API
key is expired/suspended, when quota is exhausted, or when the client is
suspended.

## Sensitive scopes

`registry.payment_status.read`, `registry.profile.verified.read`,
`registry.bank.raw.read`, `registry.officer.read`, `registry.contact.read`
require explicit `compliance_owner` approval.

## Profile-status usability

A profile-status response is usable only when country readiness, field
provenance, source/licence permits API, no active dispute, no compliance hold,
current business decision, readiness status, source label, last_updated and
stale_date are all present. Missing or stale fields are returned as
`not_available` / `stale` / `not_ready` and **never** as "passed".

## Payment-status usability

Usable only when bank status is `provider_verified`, `bank_confirmed`,
`institution_confirmed`, or `manual_bank_check_complete`; manual checks must
be compliance-approved; evidence must exist; authority must be active with
bank/API consent; business decision must permit. Response fields:
`status, verification_type, last_verified, expires_at, dispute_state, usable,
masked_account_identifier, bank_country, currency`. Raw bank fields are not
returned.

## Raw bank detail rule

API clients do not receive raw bank account details. The raw-bank endpoint
does not exist by default. Any future exception requires a separate contract,
explicit company consent, `compliance_owner` + `platform_admin` approval,
AAL2 admin release, per-request audit, restricted IP/scope, and stated
purpose — and even then, the default build keeps the endpoint disabled.

## Search keys

- **Allowed** — legal_name, trading_name, registration_number,
  local_identifier, country, jurisdiction, approved_public_identifier,
  approved_profile_id, approved_industry_category.
- **Special approval required** — officer/director/member name,
  vat/tax number, website, address, email, phone, claim/authority status,
  bank_status_query.
- **Hidden** — raw bank details, identity documents, private notes, internal
  comments, dispute notes, unsupported personal data, restricted source
  fields.
- **Exact match required** — registration_number, tax_number, vat_number,
  bank_status_query.
- **Fuzzy allowed only for** — legal_name, trading_name.

## Logging and transparency

Every API request is logged with 13 required fields. Logs never store full
API keys, raw IPs, request/response bodies, provider payloads, raw bank
details, or internal error data. Company-visible summaries surface only
`client_name_or_category`, `date`, `endpoint_category`, `purpose_label` and
only when the company dashboard is enabled. API clients see only their own
logs. Automatic company notifications are not enabled in this batch.

## Rate limits & quotas

| Tier | per minute | per day | per month |
| --- | --- | --- | --- |
| Production | 60 | 5,000 | 100,000 |
| Sandbox | 30 | 1,000 | 10,000 |
| Sensitive endpoints | 10 | 1,000 | — |

Suspension/review triggers: ≥5 failed authentications, scraping pattern,
≥120% quota usage, unusual country or endpoint spike, policy breach, disputed
use, payment failure.

## Self-visibility

API clients see only: own organisation, own keys (masked), own scopes, own
quota usage, own logs, own suspension status, own contract/pilot state. They
never see other clients, full keys, internal risk notes, internal reviewer
comments, company evidence, raw bank details, raw provider payloads, or
internal pricing rules.
