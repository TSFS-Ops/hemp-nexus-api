# Batch 19B — Client Decision UI / API / UAT Alignment

Status: accepted (alignment patch on top of Batches 1–19A).

## SSOT
- `src/lib/registry-client-decisions-19b.ts` — UI/API/UAT alignment constants.
- Inherits from `src/lib/registry-client-decisions-19a.ts` (claim categories,
  state flow, sample_only records, evidence matrix).

## Proof points

### 1. Public search alignment
- Safe match reasons pinned: `BATCH_19B_PUBLIC_SEARCH_SAFE_MATCH_REASONS`.
- Forbidden match reasons (personal email/phone/address, bank, claim
  evidence, compliance, source-provider internal): pinned and
  test-asserted.
- Officer-name search forbidden as unrestricted public — logged-in only,
  public-display approved, official/licensed source only.

### 2. Public profile alignment
- Required label: `BATCH_19B_REQUIRED_PUBLIC_PROFILE_LABEL` ("Sourced
  company record - not independently verified by Izenzo unless
  specifically stated.").
- Sample-only label: `BATCH_19B_REQUIRED_SAMPLE_RECORD_LABEL`.
- Hidden-from-public-and-API list inherited from 19A.

### 3. Claim UI alignment
- Claim approval wording: `BATCH_19B_CLAIM_APPROVED_LIMITED_COPY`.
- States: `BATCH_19B_CLAIM_UI_STATES` (enquiry_started → … →
  approved_limited / rejected / more_information_required).
- `BATCH_19B_CLAIM_APPROVAL_DOES_NOT_UNLOCK` enforces no authority / bank
  / API unlock.

### 4. Evidence UI alignment
- 12-month freshness rule: `BATCH_19B_EVIDENCE_REFRESH_LABEL`.
- Exception fields: reason, reviewer, timestamp, audit_event.
- Evidence matrix per company type inherited from 19A.

### 5. Representative UI alignment
- Pre-authority blocked actions: `BATCH_19B_REPRESENTATIVE_BLOCKED_UI_ACTIONS`.
- Notice: `BATCH_19B_REPRESENTATIVE_PRE_AUTHORITY_NOTICE`.

### 6. Competing claim UI alignment
- Neutral wording: `BATCH_19B_CLAIM_CONFLICT_NEUTRAL_COPY` — never reveals
  other claimant details.
- Admin outcomes: `BATCH_19B_CLAIM_CONFLICT_ADMIN_OUTCOMES`.

### 7. Missing-company UI alignment
- Required wording: `BATCH_19B_MISSING_COMPANY_NO_AUTO_PUBLIC_PROFILE_COPY`.
- Intake fields: `BATCH_19B_MISSING_COMPANY_INTAKE_FIELDS`.

### 8. Correction UI alignment
- Required wording: `BATCH_19B_CORRECTION_REVIEW_GATED_COPY`.
- Protected fields list pinned.
- `proposed_contact_update` remains pending (inherited from 19A SSOT).

### 9. Outreach UI alignment
- Email: blocked unless business decision + template + reviewer + audit.
- Phone: admin-only manual, no auto-dial, outcome logged.
- SMS: disabled in Phase 1 — `BATCH_19B_SMS_DISABLED_COPY`.
- WhatsApp: disabled in Phase 1 — `BATCH_19B_WHATSAPP_DISABLED_COPY`.
- Letter / manual research: admin-only lawful logged.
- Do-not-contact: `BATCH_19B_DO_NOT_CONTACT_SUPPRESSION_COPY`.

### 10. API alignment
- `BATCH_19B_SAMPLE_ONLY_API_CONTRACT`:
  - `production_api: "excluded"`
  - `sandbox_readiness_state: "sample_only"`
  - `sandbox_verified_by_izenzo: false`
  - `payment_status_usable_verified: false`
- `BATCH_19B_API_MUST_NOT_IMPLY` blocks sourced=verified,
  claim=verified, authority=verified, bank-captured=verified.
- Claim API copy mirrors UI copy.

### 11. Company portal
- `BATCH_19B_PORTAL_LIMITED_CONNECTION_COPY` — limited connection
  accepted; authority and bank rights remain blocked.

### 12. Admin operations
- `BATCH_19B_OPERATIONS_SURFACED_WORK_ITEMS` lists the 8 work-item types
  the cockpit surfaces, all using safe labels.

### 13. UAT / demo pack
- 14 client-decision scenarios pinned in
  `BATCH_19B_UAT_CLIENT_DECISION_SCENARIOS`.
- Documented in:
  - `docs/registry/uat-scenarios.md`
  - `docs/registry/demo-walkthrough.md`
  - `docs/registry/client-safe-limitations.md`
  - `docs/registry/release-gate-matrix.md`

## Guards (prebuild)
- `scripts/check-batch-19b-ssot-parity.mjs`
- `scripts/check-batch-19b-forbidden-wording.mjs`
- `scripts/check-batch-19b-sample-only-api.mjs`
- `scripts/check-batch-19b-sms-whatsapp-disabled.mjs`
- `scripts/check-batch-19b-docs-present.mjs`

## Tests
- `src/tests/batch-19b-client-decision-ui-api-uat-alignment.test.ts` — 20
  vitest cases covering search, profile, claim, evidence, representative,
  conflict, missing-company, correction, outreach, API, portal and UAT
  pack alignment.

## Cross-cutting guarantees (unchanged from 19A)
- No raw bank details on any public, company, admin or API surface.
- No personal contact leakage on public surfaces.
- No provider payload exposure.
- No automatic approvals.
- No external send / outreach from UAT or demo flows.
- No live verification provider enabled.
- Production API access remains disabled by default.
- Five attached records remain `sample_only` and are excluded from the
  production API.

Final status: BATCH_19B_CLIENT_DECISION_UI_API_UAT_ALIGNMENT_COMPLETE.
