# Batch 30 — Operations, Outreach, Notifications & Readiness Operating Rules

## Client decision source

`docs/registry/Izenzo_Business_Registry_Operating_Rules_Client_Questionnaire_Completed.docx`

## SSOT and guards

- `src/lib/registry-operations-outreach-rules.ts` (browser SSOT)
- `supabase/functions/_shared/registry-operations-outreach-rules.ts` (Deno mirror, byte-identical)
- `scripts/check-registry-operations-outreach-rules-parity.mjs` (parity + required exports + invariants + queue-priority pin)
- `src/tests/batch-30-operations-outreach-notifications-readiness.test.ts`
- `evidence/batch-30-operations-outreach-notifications-readiness/README.md`

## Scope

This document is the human-readable mirror of the Batch 30 SSOT. The
SSOT (`registry-operations-outreach-rules.ts`) is authoritative.

### AI drafting

- Allowed categories (9): `claim_invite`, `evidence_request`,
  `authority_reminder`, `bank_evidence_reminder`, `correction_request`,
  `dispute_notice`, `no_result_company_addition_response`,
  `api_onboarding_reminder`, `support_follow_up`.
- AI is draft-only. AI must never auto-send, approve, change readiness,
  verify data, clear disputes, or unlock workflows.
- Every draft must carry: source fields used, draft category, target
  company/case, intended recipient type, required approver,
  forbidden-word scan result.
- Field access tiers: allowed / masked (needs case-level approval) /
  admin-only / blocked. Raw bank, identity documents, passwords,
  unapproved personal data, unverified allegations and provider
  credentials are always blocked.
- Always-forbidden phrases (and conditional phrases) are blocked at
  draft time; the two required safe phrases are pinned.

### Outreach approval

- `support_user` may prepare drafts.
- `platform_admin` may approve ordinary claim/evidence/correction.
- `compliance_owner` is required for bank, authority, dispute, adverse,
  sensitive, legal/compliance and institutional outreach.
- Two-person approval is required for bank/authority/dispute outreach,
  do-not-contact override, institutional/API outreach and any
  non-template outreach.
- AI-generated text never bypasses human approval.

### Sending modes

- Sending mode is `mixed_with_exact_gates`.
- Real email requires approved channel + approved template + human
  approval.
- WhatsApp and SMS remain disabled with canonical labels
  `WhatsApp not configured` and `SMS not configured`.
- Manual contact logs are never represented as system-sent SMS or
  WhatsApp.

### Do-not-contact

- Scopes: person, email, phone, company, channel.
- Effect: blocks AI draft, approval and sending in scope unless
  `compliance_owner` approves an exception.
- Add roles: `platform_admin`, `compliance_owner`, or `support_user`
  with a recorded reason.
- Removal requires both `platform_admin` and `compliance_owner`.
- No default expiry; review every 12 months or on company-authorised
  request. Add/remove/change require audit with reason, actor,
  timestamp and scope.

### Day-one admin queues and SLAs

Priority order (1–10) and owner roles match the client decision:

1. Bank-detail review — `compliance_owner` / `finance_operations`
2. Authority-to-act review — `compliance_owner`
3. Claim review — `data_governance_owner` / `platform_admin`
4. Data disputes / corrections — `data_governance_owner`
5. Import batch review / quarantine — `data_governance_owner` / `technical_admin`
6. Duplicate review / merge — `data_governance_owner`
7. API client approval — `platform_admin` / `compliance_owner`
8. Provider / country readiness — `data_governance_owner`
9. Outreach approval — `support_user` / `platform_admin`
10. Stale / expired readiness review — `data_governance_owner`

SLAs (business days, SAST): bank-detail 1 (initial) / 3 (escalated),
authority 2, claim 2, disputes 3 triage + 10 resolution, import 2,
duplicate 3, API client 5, provider/country 5, outreach 1, stale 5.

Overdue items raise admin alerts; they never auto-approve.

### Alerts

- Admin alerts (12): import failure, duplicate high-confidence,
  public/API decision expiring 14 days, readiness expired, quota
  breach, suspicious API use, failed auth spike, provider down,
  country/provider pending, no-result request, correction submitted,
  SLA overdue.
- Compliance alerts (9): bank/authority dispute, third-party bank
  account, sensitive-field exposure request, do-not-contact override,
  raw bank detail request, payment-status API exception, adverse
  dispute, suspected misuse.
- Commercial alerts (7): API client 80/100/120 % usage, production
  access request, new institutional client pending, billing/credit
  threshold, contract expiry.
- Alerts are admin-visible and role-scoped; no automatic external
  sending.

### Notification event matrix

- Channels: `in_app`, `email`, `none`. Future-disabled: `whatsapp`,
  `sms`.
- Claim/authority/correction events: in-app + email to the involved
  party (and owner role).
- Bank events: in-app + email to authorised company users only.
- API events: in-app + email to API client admin and `platform_admin`.
- Operational events (import failure, provider down, SLA overdue):
  admin-only.

### Readiness dashboard audience rules

- Default audience: `internal_admin`. Internal users see full
  blockers and admin notes.
- Company directors / authorised users see only their own company
  readiness summary.
- Banks / institutional clients see only contract / API-scope
  readiness fields.
- Prospects see only demo-safe aggregate readiness.
- Public users see only public profile labels and the report /
  correction link.
- External viewers never see internal notes, risk comments, source
  licence detail, raw bank data or reviewer names.

### Build vs data readiness

- Required sections (13) cover build, country, source/licence,
  dataset/import, public-search, claim, authority, bank capture,
  bank verification, provider integration, API sandbox, API
  production, and commercial/billing readiness.
- Required labels: `Built - data/use approval pending` and
  `Data loaded - workflow not active`.
- Build readiness and data readiness must not be collapsed.

### Client-safe wording

`REGISTRY_OPS_CLIENT_SAFE_WORDING` pins the exact strings for
"not independently verified", "demo only", "provider pending",
"manual evidence reviewed", "API not ready", "SMS not configured" and
"WhatsApp not configured".

## Release status

Registry remains UAT/demo-ready. Batch 30 is a SSOT + guards + tests
batch. No edge functions, schema, UI components or RLS changed; all
prior batch evidence remains current.
