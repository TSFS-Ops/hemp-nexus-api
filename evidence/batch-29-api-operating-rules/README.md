# Batch 29 — Institutional API, Transparency, Limits & Logs Operating Rules

## Client decision source

`docs/registry/Izenzo_Business_Registry_Operating_Rules_Client_Questionnaire_Completed.docx`

## SSOT and guards

- `src/lib/registry-api-operating-rules.ts` (browser SSOT)
- `supabase/functions/_shared/registry-api-operating-rules.ts` (Deno mirror, byte-identical)
- `scripts/check-registry-api-operating-rules-parity.mjs` (parity + required exports + invariants, pinned in `npm run prebuild`)
- `src/tests/batch-29-api-operating-rules.test.ts`
- `docs/registry/api-operating-rules.md`

## Evidence checklist

- [x] **Client type proof** — `REGISTRY_API_ALLOWED_CLIENT_TYPES` = banks, DFIs, insurers, regulated platforms, enterprise, named pilots. `REGISTRY_API_PUBLIC_SELF_SERVE_PRODUCTION_ENABLED = false`; `REGISTRY_API_DEFAULT_ENVIRONMENT = "sandbox"`.
- [x] **Sandbox default proof** — Default environment is `sandbox`; production access only via `evaluateProductionGate` returning `allowed:true` against all 16 requirements.
- [x] **Production gate proof** — `REGISTRY_API_PRODUCTION_GATE_REQUIREMENTS` pins the 16 client-listed requirements; `REGISTRY_API_PRODUCTION_BLOCKING_DECISION_STATES` = `expired / disputed / licence_pending / provider_pending`; gate also blocks on country/field readiness, missing business decision, client scope mismatch, expired key, quota block, and suspension.
- [x] **Sensitive scope proof** — `REGISTRY_API_SENSITIVE_SCOPES` pinned (payment_status, profile_verified, bank_raw, officer, contact); `compliance_owner_approval_for_sensitive_scopes` enforced by gate.
- [x] **Profile-status usability proof** — `evaluateProfileStatusUsable` requires country readiness, provenance, licence, no dispute, no hold, current business decision, readiness label, source label, last_updated, stale_date. Missing/stale fields → `not_available / stale / not_ready` labels (never "passed").
- [x] **Payment-status usability proof** — `evaluatePaymentStatusUsable` requires bank status in approved 4-state list, manual check compliance-approved if applicable, evidence, active authority+consent, permitting business decision. Pending/disputed/revoked/expired/captured_unverified/failed all blocked.
- [x] **Raw-bank block proof** — `REGISTRY_API_RAW_BANK_DEFAULT_BLOCKED=true`; `REGISTRY_API_RAW_BANK_ENDPOINT_EXISTS=false`; exception requires 8 conditions AND endpoint stays disabled by default. `PAYMENT_STATUS_API_SAFE_RESPONSE_FIELDS` excludes account_number/IBAN.
- [x] **Search key proof** — Allowed (9 keys), special_approval (12 keys: officer/director/member/vat/tax/website/address/email/phone/claim_status/authority_status/bank_status_query), hidden (7 keys). Exact match enforced for registration/tax/bank-status. Fuzzy allowed only for legal_name/trading_name.
- [x] **Logging proof** — `REGISTRY_API_REQUEST_LOG_REQUIRED_FIELDS` pins 13 fields; `REGISTRY_API_REQUEST_LOG_FORBIDDEN_FIELDS` blocks full_api_key, raw_ip, request_body, response_body, provider_payload, raw_bank_details, internal_error_data.
- [x] **Company-visible transparency proof** — `buildCompanyVisibleLogSummary` returns only the 4 client-approved fields (client_name_or_category, date, endpoint_category, purpose_label); `REGISTRY_API_COMPANY_LOGS_REQUIRE_DASHBOARD_ENABLED=true`; `REGISTRY_API_AUTO_COMPANY_NOTIFICATIONS_ENABLED=false`.
- [x] **API client own-log proof** — `REGISTRY_API_CLIENT_SEES_OWN_LOGS_ONLY=true`; client hidden fields include `other_clients`, `full_keys`, `internal_risk_notes`, `internal_reviewer_comments`, `company_evidence`, `raw_bank_details`, `raw_provider_payloads`, `internal_pricing_rules`.
- [x] **Quota / rate-limit proof** — Production 60/min, 5,000/day, 100,000/month. Sandbox 30/min, 1,000/day, 10,000/month. Sensitive endpoints (payment_status, profile_verified, bank_raw) 10/min, 1,000/day. `REGISTRY_API_QUOTA_OVERAGE_SUSPEND_THRESHOLD_PCT=120`.
- [x] **Suspension trigger proof** — `evaluateSuspension` returns triggers for 5+ failed auths, scraping, ≥120% quota, country spike, endpoint spike, policy breach, disputed use, payment failure.
- [x] **UI proof** — This batch is SSOT/guards/tests. Existing admin API surfaces (`src/pages/admin/registry/Api.tsx`, Batch 15B) remain intact; new operating rules SSOT is consumable by those surfaces without code change in this batch. UI gating (production checklist, masked keys, sandbox/production badges, sensitive-scope approval status) is already in place from Batches 5, 15, 15B and is not regressed by this batch.
- [x] **Guard summary** — Parity guard pins SHA-256 byte-parity between browser + Deno SSOT, validates 45+ required exports, and enforces invariants: `PUBLIC_SELF_SERVE_PRODUCTION=false`, `DEFAULT_ENVIRONMENT=sandbox`, `RAW_BANK_DEFAULT_BLOCKED=true`, `RAW_BANK_ENDPOINT_EXISTS=false`, `AUTO_COMPANY_NOTIFICATIONS=false`, `CLIENT_SEES_OWN_LOGS_ONLY=true`, `QUOTA_SUSPEND_THRESHOLD=120`, production 60/5k/100k, sandbox 30/1k/10k, sensitive 10/1k.
- [x] **Test summary** — `src/tests/batch-29-api-operating-rules.test.ts` adds ~20+ assertions covering sandbox default, production gate per-requirement failures and decision-state blocks, compliance_owner for sensitive scopes, profile-status usability, payment-status usability across approved/blocked states, manual compliance approval, safe response field exclusion of raw bank, raw-bank exception always disabled, search-key classification + exact/fuzzy rules, request log forbidden fields, company summary safe field projection, dashboard + auto-notification gating, client own-log invariant, production/sandbox/sensitive limits, suspension triggers per signal, hidden client fields, audit-name pinning.

## Release status

Registry remains UAT/demo-ready. Batch 29 is a SSOT + guards + tests batch; no edge functions, schema, or UI components changed. All Batch 24–28 evidence remains current; this batch extends the operating-rules SSOT family to institutional API access, transparency, limits, and logs.

## Edge functions requiring deploy (Batch 29)

- (none — Batch 29 is a SSOT/guards/tests batch; no edge surface changed.)
