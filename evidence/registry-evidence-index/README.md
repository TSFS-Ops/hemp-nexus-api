# Registry Evidence Index (Batches 1–18)

Central index of evidence for the controlled Business Registry build.
Each row lists the batch, accepted status, evidence README path, known
limitations and outstanding production blockers.

> Default final release status across the registry is **not**
> `production_ready`. See `docs/registry/release-gate-matrix.md`.

| Batch | Name | Status | Evidence README | Known limitations / production blockers |
| --- | --- | --- | --- | --- |
| 1 | Registry foundation | accepted | `evidence/batch-1-registry-foundation/README.md` | Readiness held at controlled-test mode. |
| 2 | Provenance, coverage, imports | accepted | `evidence/batch-2-registry-provenance-coverage-imports/README.md` | Coverage controlled country-by-country. |
| 3 | Public registry + claim workflow | accepted | `evidence/batch-3-public-registry-claim-workflow/README.md` | Claim ≠ verification. |
| 4 | Authority + bank-detail status | accepted | `evidence/batch-4-authority-bank-detail-status/README.md` | Authority ≠ verification. |
| 5 | Institutional API management | accepted | `evidence/batch-5-institutional-api-management/README.md` | Production API disabled by default. |
| 6 | Operations / outreach / readiness | accepted | `evidence/batch-6-registry-operations-outreach-readiness/README.md` | No external send. |
| 7 | Search + claim rules hardening | accepted | `evidence/batch-7-registry-search-claim-rules-hardening/README.md` | Review-gated. |
| 8 | Record search / profile | accepted | `evidence/batch-8-registry-record-search-profile/README.md` | No verified wording on profiles. |
| 9 | Source import validation | accepted | `evidence/batch-9-registry-source-import-validation/README.md` | Imported ≠ verified. |
| 10 | Import-to-claim lifecycle | accepted | `evidence/batch-10-import-to-claim-lifecycle/README.md` | Lifecycle remains review-gated. |
| 11 | Real claim submission / review | accepted | `evidence/batch-11-real-claim-submission-review/README.md` | Approval ≠ verification. |
| 12 | Authority-to-act request / review | accepted | `evidence/batch-12-authority-to-act-request-review/README.md` | Personal contacts admin-only. |
| 13 | Bank-detail submission / review | accepted | `evidence/batch-13-bank-detail-submission-review/README.md` | Captured ≠ verified. |
| 13B | Bank-detail UI wiring | accepted | `evidence/batch-13b-bank-detail-ui-wiring/README.md` | Captured ≠ verified. |
| 14B | Bank verification UI / status | accepted | `evidence/batch-14b-bank-verification-ui-status/README.md` | Live provider not yet enabled. |
| 15 | Institutional API hardening | accepted | `evidence/batch-15-institutional-api-hardening/README.md` | Production access disabled by default. |
| 15B | Institutional API admin UI | accepted | `evidence/batch-15b-institutional-api-admin-ui/README.md` | Production approval requires acknowledgement. |
| 16 | Company portal guided journey | accepted | `evidence/batch-16-company-portal-guided-journey/README.md` | Deterministic next-step engine. |
| 17 | Admin operations centre | accepted | `evidence/batch-17-registry-admin-operations-centre/README.md` | Role-gated; read-only aggregations. |
| 18 | End-to-end UAT, release gate, demo pack | accepted | `evidence/batch-18-end-to-end-uat-release-demo/README.md` | Default final status not `production_ready`. |
| 19A | Client claim/search/profile decision alignment | accepted | `evidence/batch-19a-client-claim-search-profile-decisions/README.md` | Five sample records locked `sample_only`; SMS/WhatsApp disabled in Phase 1; claim approval is `claim_approved_limited`. |
| 19B | Client decision UI / API / UAT alignment | accepted | `evidence/batch-19b-client-decision-ui-api-uat-alignment/README.md` | UI/API/UAT surfaces aligned to client-signed wording; sample_only API contract (`production_api: excluded`, sandbox `verified_by_izenzo: false`); officer-name public search blocked unless approved; SMS/WhatsApp Phase 1 disabled wording pinned; do-not-contact suppression copy pinned. |
| 20 | Pre-UAT embarrassment audit and consistency sweep | accepted | `evidence/batch-20-pre-uat-embarrassment-audit/README.md` | No `uat_blocker` outstanding; live provider / production API / SMS-WhatsApp remain deferred `accepted_limitation`s; release-gate default not `production_ready`; no debug/TODO/placeholder strings in registry UI. |
| 21 | UAT test hygiene and client-facing evidence cleanup | accepted | `evidence/batch-21-uat-test-hygiene/README.md` | Quarantine ledger separates stale source-pin tests; UAT journey suite is CI-only via `UAT_PROVISIONING_ENABLED`; client-facing `docs/registry/uat-execution-summary.md` carries no raw failed-test counts; release gate remains UAT/demo-ready, not production-ready. |
| 22 | Registry shell + profile-level claim entry alignment | accepted | `evidence/batch-22-registry-shell-profile-claim-entry/README.md` | Company Registry surfaces wrapped in Trade Desk `<DeskLayout>`; "Is this your company?" claim CTA lives on the profile and routes to the company-specific claim path; sample_only records keep the sample warning near the CTA; raw bank/personal contact never rendered; claim approval wording remains limited. |
| 23 | Registry typeahead company search | accepted | `evidence/batch-23-registry-typeahead-company-search/README.md` | Combobox typeahead on `/desk/registry/search` reuses the safe `registry-company-search` edge function; client-side `SAFE_MATCH_FIELDS` allow-list; sample chip for `sample_only`/`imported_unverified`; matched query tokens highlighted in result fields; shell-aware navigation via `rebaseRegistryPath`. |
| 24 | Operating rules SSOT, readiness, business decisions and wording gates | accepted | `evidence/batch-24-operating-rules-readiness-business-decisions/README.md` | Browser + Deno SSOT pinned by parity guard; 15 readiness states, 17 field groups, 15 business-decision types with client expiry windows; protected wording gated by state; always-blocked vocabulary hard-refused; build-vs-data readiness sections separated. |
| 25 | Provenance, country coverage, import validation and duplicate governance | accepted | `evidence/batch-25-provenance-country-import-duplicate-governance/README.md` | Browser + Deno SSOT for §2–15 of the client operating questionnaire pinned by parity guard; 10 source types with required descriptors; licensed datasets `sourced_only` with the client wording pinned; 14 manual-review field groups not-public by default; source priority order + conflict resolution; 6 country capabilities × 12 workflow states (capability-specific); 11-item searchable-country minimum; 16-item pre-import checklist; 6 required / 6 quarantine-if / 6 excluded import fields; 5% batch failure threshold; exact / 0.95 / 0.92 / 0.85 duplicate thresholds; high-risk duplicates require `platform_admin` + `compliance_owner` and never auto-merge. |
| 26 | Search, typeahead, public profile and corrections operating rules | accepted | `evidence/batch-26-search-profile-corrections-rules/README.md` | Browser + Deno SSOT pinned by parity guard; 5-class field classification; public officer/email/phone search disabled; logged-in officer search gated on 4 conditions; API officer/email/phone search requires `compliance_owner`; partial match ≥ 3 chars on name fields only; typo floor 0.85; public floor 0.75; exact identifier outranks fuzzy name; closed allow-list of 7 public match reasons; admin-only match reasons never leak; exact no-result wording with `company_addition_requested` as the only side effect; public profile field tiers and four client-supplied wording strings; corrections versioned, never auto-publishing, with sensitive fields routed to `compliance_owner` and `disputed_under_review` blocking public/API exposure. |
| 27 | Claim and authority operating rules | accepted | `evidence/batch-27-claim-authority-operating-rules/README.md` | Browser + Deno SSOT pinned by byte-parity guard; six actions require registered + email-verified user; seven claimant role dispositions (unrelated third party blocked, platform_admin admin-assisted no self-approval); evidence matrix by legal form (sole_proprietor, company, close_corporation, partnership, other); 12-month evidence refresh rule with reviewer-exception override; `unlisted_claimant_review` blocks edit/bank/API/authority-sensitive workflows; four conflict states routed to `compliance_owner`; claim approval limited to non-sensitive profile edit + authority request (never bank/API/manage_users); seven-scope authority allow-list; 12-month default expiry (6 months for bank/API); two-person approval required for bank/API/manage_users; bank/API/dispute scopes require `compliance_owner`; self-approval blocked; `expired`/`revoked`/`suspended_disputed`/`compliance_review` block sensitive actions; full authority is not a default. |
| 28 | Bank detail capture, multi-account and verification operating rules | accepted | `evidence/batch-28-bank-detail-operating-rules/README.md` | Browser + Deno SSOT pinned by byte-parity guard with invariant pins; bank submission requires authority_active with `submit_bank_details` / `bank_submit`; claim approval alone never unlocks submission; expired/disputed/revoked/suspended_disputed/compliance_review authority blocks; conditional authority draft-only; admin-assisted requires evidence + reason; country fields pinned for ZA, NG (BVN forbidden unless separately approved) and other; V1 max 3 active accounts with `platform_admin` + `compliance_owner` dual approval beyond; primary uniqueness per currency/payment route; closed purpose-label set; third-party accounts default `third_party_account_pending_review`, require five-item evidence + compliance_owner approval, API raw blocked by default; evidence review gates the five approved verification labels; masked / unmasked role tiers pinned; unmasked requires AAL2 + reason + audit; company-confirmed is not verified; manual check is not provider check; manual verification requires compliance_owner + platform_admin decision and emits `manual_bank_check_complete` with canonical demo copy; manual validity 90 days; provider/bank/institution validity 180 days; six immediate-expiry triggers; payment-status API usable only for approved verification states with evidence, compliance approval where manual, active authority/consent and a permitting business decision; raw bank fields never returned by default; canonical UI/API wording for pending/disputed/revoked/expired/failed; 25 canonical audit-event names. |


## Cross-cutting guarantees

- No raw bank details exposed to public, company, admin (full), or API
  surfaces.
- No full API keys displayed after creation.
- No raw provider payloads exposed.
- No personal contact leakage to general authenticated users.
- No automatic approvals across claim, authority, bank-detail, or
  verification workflows.
- No external notifications or outreach triggered from demo/UAT data.
- RLS enforced on all new registry tables; admin tables role-gated.
