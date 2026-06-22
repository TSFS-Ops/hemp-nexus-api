# Batch 23 — Registry Typeahead Company Search

## Summary

Adds a keyboard-accessible typeahead dropdown to the Company Registry
search experience. The dropdown appears as the user types (≥2 chars,
~200ms debounce), updates as the query changes, supports full keyboard
navigation, and opens the company profile on selection while preserving
the Trade Desk shell (Batch 22).

No new edge function is introduced; the typeahead reuses the existing
`registry-company-search` function with `limit: 8`, inheriting all the
public-tier safety rails already locked in (admin-tier match
suppression, sample/imported_unverified gating, no raw bank, no
personal contacts, no provider payloads).

## Files

- `src/components/registry/CompanyTypeahead.tsx` — combobox/listbox UI
- `src/pages/registry/Search.tsx` — mounts the typeahead, reads `?q=` / `?country=`
- `src/tests/batch-23-registry-typeahead.test.ts` — source-pin tests
- `scripts/check-batch-23-registry-typeahead.mjs` — prebuild guard

## Evidence checklist

- [x] **Typeahead proof** — dropdown panel rendered conditionally via
  `showPanel`; opens on input/focus when query length ≥ 2.
- [x] **Safe field proof** — only `company_name`, `country_code`,
  `registration_number`, `legal_form`, `readiness_label`, `match_reasons`
  rendered (see `CompanyTypeahead.tsx`).
- [x] **Safe match reason proof** — `SAFE_MATCH_FIELDS` allow-list
  filters server-returned match reasons to name/registration/VAT/
  address/activity/officer only.
- [x] **Sample_only chip proof** — `isSampleReadiness` adds a
  "Sample record" `Badge` for `imported_unverified` and `sample_only`.
- [x] **Shell persistence proof** — `useRegistryBase` + `rebaseRegistryPath`
  rewrite `profile_link` to `/desk/registry/...` when the user is inside
  the Trade Desk shell.
- [x] **Selected company route proof** — `pick()` calls
  `navigate(rebaseRegistryPath(r.profile_link, base))`.
- [x] **No-results proof** — explicit safe message + review-gated
  "request a new company record" link to `${base}/new-company-request`.
- [x] **Keyboard navigation proof** — ArrowDown / ArrowUp / Enter /
  Escape implemented in `onKeyDown`; `aria-activedescendant` reflects
  active option; Tab is not trapped.
- [x] **No unsafe data exposure proof** — guard script and test forbid
  bank/IBAN, personal email/phone/address, provider payloads, raw
  evidence, compliance notes.
- [x] **Guard summary** — `scripts/check-batch-23-registry-typeahead.mjs`
  pinned in `npm run prebuild`.
- [x] **Test summary** — `src/tests/batch-23-registry-typeahead.test.ts`
  covers debounce, ARIA, keyboard, safety rails, shell integration.

## Acceptance

`BATCH_23_REGISTRY_TYPEAHEAD_COMPANY_SEARCH_COMPLETE`
