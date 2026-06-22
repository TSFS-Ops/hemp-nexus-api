# Batch 22 — Company Registry Shell and Profile-Level Claim Entry Alignment

## Purpose

Bring the Company Registry surfaces inside the Trade Desk shell, and
move the "Claim this company" entry point onto the company profile
page (B2BHint-style pattern). No accepted guardrail is weakened.

## What changed

### 1. Trade Desk shell wraps the registry

`src/pages/Desk.tsx` mounts every registry sub-route inside the
existing `<DeskLayout>` block so the Trade Desk sidebar remains
visible at all times:

```
/desk/registry                                       → RegistryLanding
/desk/registry/search                                → RegistrySearch
/desk/registry/new-company-request                   → NewCompanyRequest
/desk/registry/company/:id                           → CompanyProfile
/desk/registry/company/:id/claim                     → Claim
/desk/registry/my-companies                          → MyCompanies
/desk/registry/my-companies/:companyId               → MyCompanyDetail
/desk/registry/my-companies/:companyId/claim         → ClaimStatus
/desk/registry/my-companies/:companyId/authority     → AuthorityList
/desk/registry/my-companies/:companyId/bank-details  → BankDetailSubmit
/desk/registry/my-companies/:companyId/verification  → BankDetailStatus
/desk/registry/my-companies/:companyId/evidence      → MyCompanyEvidence
/desk/registry/my-companies/:companyId/corrections   → MyCompanyCorrections
/desk/registry/my-companies/:companyId/disputes      → MyCompanyDisputes
/desk/registry/my-companies/:companyId/revocations   → MyCompanyRevocations
```

No registry surface is mounted under `DeskFullBleed`. The standalone
`/registry/*` routes in `src/App.tsx` are left intact for the
public/embedded surface — they are unchanged.

### 2. Shell-aware internal links

New helper `src/lib/use-registry-base.ts` exposes `useRegistryBase()`
and `rebaseRegistryPath()`. Pages updated:

- `src/pages/registry/Landing.tsx`
- `src/pages/registry/Search.tsx` (no-result CTA, profile link, claim CTA)
- `src/pages/registry/CompanyProfile.tsx` (claim CTA, new-company link)

Result: links inside `/desk/registry/*` stay in the desk shell; links
on the standalone `/registry/*` surface keep their existing targets.

### 3. Profile-level "Is this your company?" claim panel

`src/pages/registry/CompanyProfile.tsx` now renders a prominent claim
panel near the top of the profile:

- Title: **Is this your company?**
- Body wording (verbatim):
  > Claim this company to start the review process. You will be asked
  > to provide documents showing your connection to the company. Claim
  > approval confirms only that your connection has passed review. It
  > does not verify the company profile, grant authority-to-act or
  > verify bank details.
- Primary CTA: **Claim this company** → company-specific route
  `${base}/company/:id/claim`
- Sample-only warning when `readiness_label === "imported_unverified"`:
  > This is a sample record for workflow testing. It is not
  > independently verified by Izenzo.
- Claim-blocked state continues to show the blocked reason badge with
  no claim CTA.

The previous duplicate bottom CTA card was reduced to a small
compliance footer (source-not-vetted note + no-raw-bank reminder).

### 4. Claim-entry page — selected company + evidence explanation

`src/pages/registry/Claim.tsx` now:

- Shows a "Claiming: {company name}" card at the top with safe fields
  (country, registration number, sample notice).
- Includes an evidence-explanation paragraph with the limited wording
  ("does not verify the company profile, grant authority-to-act or
  verify bank details").
- The form continues to require declaration + consent gates before
  evidence upload; nothing in evidence upload, authority, bank-detail
  verification or claim-approval wording changed.

### 5. Guardrails (unchanged)

- No raw bank details are rendered or fetched.
- No personal email, phone or residential address is rendered publicly.
- No live-provider integration is enabled.
- No outreach is sent.
- Claim approval wording remains limited (`claim_approved_limited`).
- Sample records remain clearly labelled.
- Production-readiness wording remains forbidden.

## Tests & guards

- `src/tests/batch-22-registry-shell-claim-entry.test.ts` — 11 source
  pins covering shell mounting, no DeskFullBleed leakage, shell-aware
  links, the profile claim panel + limited wording, the sample-only
  warning hook, no raw-bank/personal-contact references, and the
  claim-entry selected-company card + evidence explanation.
  ✅ 11 passed.
- `src/tests/desk-registry-sidebar-persistence.test.tsx` — re-verified.
  ✅ 4 passed.
- `scripts/check-batch-22-registry-shell-claim-entry.mjs` — new
  prebuild guard; wired into `npm run prebuild` and exposed as
  `npm run check:batch-22`. ✅ passes.

## Evidence map

| Requirement                                          | Evidence                                                   |
| ---------------------------------------------------- | ---------------------------------------------------------- |
| Trade Desk sidebar visible on `/desk/registry`       | `Desk.tsx` DeskLayout block + sidebar persistence test     |
| Sidebar visible on search shell                      | `path="registry/search"` inside `<DeskLayout>` block       |
| Sidebar visible on company profile                   | `path="registry/company/:id"` inside `<DeskLayout>` block  |
| Sidebar visible on claim entry/upload/status         | All `my-companies/:companyId/*` routes inside DeskLayout   |
| Profile-level claim CTA                              | `data-testid="profile-claim-panel"` + `Claim this company` |
| Company-specific claim route                         | `` `${base}/company/${r.id}/claim` `` in CompanyProfile    |
| Sample-only claim CTA warning                        | `data-testid="profile-claim-sample-warning"`               |
| Limited claim wording (no verification implication)  | Verbatim panel body + guard string match                   |
| No raw bank exposure on profile                      | Guard: forbidden field regex panel + existing batch checks |
| No personal contact exposure on profile              | Same guard                                                 |

## Acceptance

- Company Registry remains inside the Trading Desk shell. ✔
- Sidebar remains visible through search, profile and claim journey. ✔
- "Claim Your Company" entry point appears on the company profile. ✔
- Claim route is company-specific. ✔
- Claim upload flow shows the selected company. ✔
- Claim CTA wording is safe and does not imply verification. ✔
- Sample_only records remain clearly labelled. ✔
- Claim approval remains limited. ✔
- No sensitive data is exposed. ✔
- All tests and guards pass. ✔

**Status: BATCH_22_REGISTRY_SHELL_PROFILE_CLAIM_ENTRY_COMPLETE**
