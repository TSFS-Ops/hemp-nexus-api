# Batch 8 — Registry Record Model, Search Index and Working Search

## Scope
Turns the registry from a governed shell into a **working searchable registry experience**, using the rules and guardrails accepted in Batches 1–7.

This batch does **not** mark anything verified, production-ready or institutionally usable, and does not expose raw bank details or raw personal contact details on any public surface.

## What was built

### Record model (migration)
- `registry_company_records` — normalised company record (country, name, registration/local/VAT numbers, legal form, status, registered address, source summary, source generated date, provenance reference, readiness state, claim status, authority/profile/bank-detail status labels, public/API/claim flags, internal confidence notes).
- `registry_company_identifiers` — trading_name, previous_name, vat_number, local_number, registration_number, tax_number, other_number.
- `registry_company_addresses` — registered / trading / postal / residential_admin_only.
- `registry_company_people` — officers/directors/members with column-level grants that withhold `full_name`, `personal_email`, `personal_phone`, `personal_address` from public roles.
- `registry_company_activities`, `registry_company_events`, `registry_company_filings` — public-safe summaries with admin-only `raw_text` / `source_document_reference` fields.
- `registry_company_search_index` — flattened searchable rows tagged `tier='public'` or `tier='admin'`, with a GIN trigram index on `value_normalised` (uses `extensions.pg_trgm`).
- `registry_company_record_events` — per-record audit log.
- `admin_seed_batch8_sample_records()` — `SECURITY DEFINER` seed restricted to `platform_admin`.
- `rebuild_registry_company_search_index(record_id)` — `SECURITY DEFINER` index builder.
- `registry_normalise_search_value(text)` — punctuation/case normaliser shared by indexer and search.

### SSOT
- `src/lib/registry-record-model.ts` and `supabase/functions/_shared/registry-record-model.ts` — pinned by `scripts/check-registry-record-model-parity.mjs`.

### Edge functions
- `registry-company-search` — public, queries public-tier index, returns match reasons, suppresses sensitive admin-only matches.
- `registry-company-profile` — public, hydrates safe envelope (no raw bank, no personal email/phone/address).
- `registry-company-record-manage` — admin-only seed loader (wraps the SECURITY DEFINER RPC).
- `registry-company-search-index-rebuild` — admin-only index rebuild.

### Frontend
- `/registry/search` — working search by name, registration number, VAT/tax number, address, legal form, country. Renders match-reason badges, readiness label, claim availability, and a no-result CTA that links to `/registry/new-company-request`.
- `/registry/company/:id` — public-safe company profile with identifiers, public people summary, activity, filings.
- `/registry/new-company-request` — submits to the Batch 7 `registry-new-company-request` edge function.
- `/admin/registry/records` — admin record inspector with field-visibility tier table, seed loader and index rebuild.

### Guards added
- `scripts/check-registry-record-model-parity.mjs`
- `scripts/check-registry-batch8-no-verified-wording.mjs`

## Public vs admin search

### Public-tier example (search "Greenstone")
Returns `Greenstone Logistics Limited` with match reasons:
- Matched on company name
- Matched on trading name
- Matched on previous name

### Admin-tier (suppression) example
Searching `chinedu@greenstone.example` from a public client returns **0 results**.
The admin-tier index row exists, and the call is audited as `registry_company_sensitive_match_suppressed`. The admin-tier match reason is never returned to a public caller.

### Match reason labels (public, allowed)
- Matched on company name
- Matched on registration number
- Matched on local number
- Matched on VAT/tax number
- Matched on legal form
- Matched on country
- Matched on registered address
- Matched on trading name / previous name
- Matched on activity description
- Matched on officer/director name (public)

## Sample seed
Loaded via `INSERT … RETURNING id` → `rebuild_registry_company_search_index(id)` for each of:
1. **Adebayo Trading Enterprise** — NG Sole Proprietor, `BN-1029384`, local `LAG-44012`.
2. **Greenstone Logistics Limited** — NG Private Limited, `RC-1572044`, VAT `TIN-203-44-5821`, trading name + previous name, public director, activity, filing.
3. **Karoo Solar (Pty) Ltd** — ZA Pty Ltd, `2018/445221/07`, VAT `4880291442`, trading name, public director.
4. **Highveld Bakery CC** — ZA close corporation, `CK1995/088321/23`, public member.

DB state after seed: **4 records / 27 public + admin index rows**.

## Imported_unverified proof
- DB default is `'imported_unverified'`.
- Edge function `registry-company-search` returns `readiness_banner: "imported_unverified"`.
- `/registry/search` and `/registry/company/:id` both display the disclaimer:
  > Source data has not been independently verified by Izenzo unless the profile status says verified.

## Public profile hides
- Raw bank details (only `bank_detail_status_label` is exposed).
- Personal email, phone and residential addresses (column grant + edge function omits them).
- Admin-only source notes, internal confidence notes, raw filing/event text.

## Claim availability gate
Records expose `claim_available = claim_allowed && !claim_blocked_reason`. The UI shows either the Claim CTA or the blocked reason.

## Audit events emitted
- `registry_company_record_created`
- `registry_company_record_indexed`
- `registry_company_search_index_rebuilt`
- `registry_company_public_search_performed`
- `registry_company_public_profile_viewed`
- `registry_company_sensitive_match_suppressed`
- `registry_company_claim_availability_checked`
- `registry_company_no_result_new_request_prompted`

## Out of scope (unchanged)
- No production-scale ingestion.
- No verified / production-ready / institutional wording on public surfaces.
- No external provider integration.
- No outreach sending.
- No weakening of Batches 1–7.
