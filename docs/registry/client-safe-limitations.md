# Registry — Client-Safe Limitations (Batch 18)

> Show this list to Izenzo, bank or institutional stakeholders before any
> demo. Canonical strings live in `CLIENT_SAFE_LIMITATIONS` in
> [`src/lib/registry-release-gate-ssot.ts`](../../src/lib/registry-release-gate-ssot.ts).

- Live provider verification is not enabled.
- Production API access is disabled by default.
- Imported registry data requires provenance and freshness controls.
- Claim approval does not itself verify the company. The only accepted
  approved state is `claim_approved_limited` with the client-signed
  wording.
- Authority approval does not itself verify the company.
- Bank-detail capture does not itself verify the bank details.
- Manual verification requires an approved business decision and a
  compliance gate.
- Provider simulation is not real provider verification.
- Raw bank details are not exposed through public or API routes.
- Country readiness is controlled country-by-country.
- Demo / UAT data must not be treated as production data.
- Five attached records (`bullion_bathrooms_nigeria`,
  `dangote_fertiliser_limited`, `harith_holdings`, `laurium_capital`,
  `starfair_162`) are locked as `sample_only`. They are excluded from
  the production API; the sandbox API returns
  `verified_by_izenzo = false` and `readiness_state = sample_only`.
- Officer / director / member name public search is disabled by default
  and only available to logged-in users on public-display-approved
  records sourced from official or licensed records.
- Public profile fields beyond the safe core (officer names, activity,
  filing summaries, event summaries) require public-display approval.
- Evidence older than 12 months requires refresh unless a reviewer
  exception (reason, reviewer, timestamp, audit event) is recorded.
- Representatives may not submit bank details, edit profile fields,
  manage users or consent to API sharing before authority-to-act
  approval.
- Missing-company requests do not auto-create public profiles or
  claimable records.
- Correction requests are review-gated; protected fields (company name,
  registration number, VAT, legal form, officers, members, registered
  address, bank details) are never directly editable by the claimant.
- SMS and WhatsApp outreach are disabled in Phase 1.
- Do-not-contact records suppress outreach immediately; contact details
  remain source data only.
