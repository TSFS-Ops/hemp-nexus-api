# Batch 30 — Outreach, Notifications, Operations Queues & Readiness Dashboard Operating Rules

## Client decision source

`docs/registry/Izenzo_Business_Registry_Operating_Rules_Client_Questionnaire_Completed.docx`

## SSOT and guards

- `src/lib/registry-operations-outreach-rules.ts` (browser SSOT)
- `supabase/functions/_shared/registry-operations-outreach-rules.ts` (Deno mirror, byte-identical)
- `scripts/check-registry-operations-outreach-rules-parity.mjs` (parity + required exports + invariants + queue-priority pin; wired into `npm run prebuild`)
- `src/tests/batch-30-operations-outreach-notifications-readiness.test.ts`
- `docs/registry/operations-outreach-notifications-readiness-rules.md`

## Evidence checklist

- [x] **AI draft gate proof** — `REGISTRY_OPS_AI_ALLOWED_DRAFT_CATEGORIES` pins the 9 client-listed categories. `evaluateAiDraftGate` blocks disallowed categories, blocked/admin-only/masked-without-approval/unknown source fields, do-not-contact in scope, and forbidden wording. `REGISTRY_OPS_AI_DRAFT_ONLY=true`, `REGISTRY_OPS_AI_MAY_AUTO_SEND=false`, `REGISTRY_OPS_AI_AUTO_SEND_ENABLED=false`, plus `REGISTRY_OPS_AI_MAY_APPROVE / CHANGE_READINESS / VERIFY / CLEAR_DISPUTES / UNLOCK_WORKFLOWS = false`. Required draft metadata (6 fields) pinned.
- [x] **AI field access proof** — `REGISTRY_OPS_AI_FIELDS_ALLOWED` (10), `_MASKED` (4), `_ADMIN_ONLY` (5), `_BLOCKED` (6). `classifyAiField` partitions every field; raw bank, identity documents, passwords, unapproved personal data, unverified allegations and provider credentials are all `blocked`. Masked fields require per-case approval.
- [x] **AI forbidden wording proof** — `REGISTRY_OPS_AI_ALWAYS_FORBIDDEN_PHRASES` pins the always-blocked phrases (guaranteed, approved by Izenzo, bank approved, compliant, cleared, trusted, safe, risk-free, we confirm payment details, you are required to transact, sanctions cleared). `REGISTRY_OPS_AI_CONDITIONAL_FORBIDDEN_PHRASES` pins conditional phrases (verified, official government registry, partner of). `REGISTRY_OPS_AI_REQUIRED_SAFE_PHRASES` pins the two required safe phrases.
- [x] **Outreach approval proof** — `REGISTRY_OPS_OUTREACH_APPROVAL_ROLES` pins role matrix: support_user prepares; platform_admin approves ordinary; compliance_owner required for bank/authority/dispute/adverse/sensitive/legal/institutional. `REGISTRY_OPS_OUTREACH_TWO_PERSON_CATEGORIES` enforces dual approval for bank/authority/dispute/DNC-override/API/non-template. `evaluateOutreachApproval` blocks AI text without human approval, wrong primary approver, and missing/duplicate second approver.
- [x] **Sending-mode proof** — `REGISTRY_OPS_SENDING_MODE="mixed_with_exact_gates"`. `REGISTRY_OPS_REAL_EMAIL_REQUIRES_APPROVED_CHANNEL/_TEMPLATE/_HUMAN_APPROVAL` all `true`. `REGISTRY_OPS_OUTREACH_STATUSES` pins drafted / approved / sent_email / manual_contact_logged / whatsapp_disabled / sms_disabled. `evaluateRealEmailSendGate` enforces all four gates.
- [x] **SMS / WhatsApp disabled proof** — `REGISTRY_OPS_WHATSAPP_ENABLED=false`, `REGISTRY_OPS_SMS_ENABLED=false`, labels `"WhatsApp not configured"` and `"SMS not configured"` pinned. `REGISTRY_OPS_WHATSAPP_SMS_ENABLE_REQUIREMENTS` lists the 8 enablement gates. `REGISTRY_OPS_MANUAL_CONTACT_LOG_REPRESENTS_SMS_OR_WHATSAPP=false`.
- [x] **Do-not-contact proof** — `REGISTRY_OPS_DNC_SCOPES` (person, email, phone, company, channel); `REGISTRY_OPS_DNC_EFFECTS` (block_ai_draft, block_approval, block_sending); `REGISTRY_OPS_DNC_ADD_ROLES` and `REGISTRY_OPS_DNC_REMOVE_ROLES_REQUIRED = [platform_admin, compliance_owner]`. `REGISTRY_OPS_DNC_DEFAULT_EXPIRY="none"`, review every 12 months. `evaluateDncAdd` blocks support_user without reason and unauthorised roles; `evaluateDncRemove` requires both roles. `REGISTRY_OPS_DNC_AUDIT_REQUIRED_FIELDS` pins reason/actor/timestamp/scope.
- [x] **Queue priority proof** — `REGISTRY_OPS_QUEUE_PRIORITY_ORDER` pins the exact 1–10 client order with owner roles. Parity guard explicitly asserts each rank/queue pair.
- [x] **SLA proof** — `REGISTRY_OPS_SLAS_BUSINESS_DAYS` pins all 12 SLA values (bank 1/3, authority 2, claim 2, disputes 3/10, import 2, duplicate 3, API client 5, provider/country 5, outreach 1, stale 5). `evaluateOverdue` returns SLA, overdue flag, `auto_approve:false`, and `raises_admin_alert:true`. `REGISTRY_OPS_OVERDUE_AUTO_APPROVE_ENABLED=false`; `REGISTRY_OPS_OVERDUE_CREATES_ADMIN_ALERT=true`.
- [x] **Alert trigger proof** — `REGISTRY_OPS_ADMIN_ALERTS` (12), `REGISTRY_OPS_COMPLIANCE_ALERTS` (9), `REGISTRY_OPS_COMMERCIAL_ALERTS` (7 including 80/100/120 % usage). `REGISTRY_OPS_ALERT_AUTO_EXTERNAL_SEND_ENABLED=false`.
- [x] **Notification matrix proof** — `REGISTRY_OPS_NOTIFICATION_CHANNELS = [in_app, email, none]`. `REGISTRY_OPS_NOTIFICATION_FUTURE_DISABLED_CHANNELS = [whatsapp, sms]`. `REGISTRY_OPS_NOTIFICATION_MATRIX` pins 25 events covering claim/authority/bank/correction/api/import/provider/SLA, with bank events scoped to `authorised_company_user` and API key events scoped to `api_client_admin` + `platform_admin`. `notificationChannelsFor` reads the matrix.
- [x] **Readiness audience proof** — `REGISTRY_OPS_READINESS_AUDIENCES` (5); default `internal_admin`. `readinessAudienceProjection` returns per-audience flags. `REGISTRY_OPS_READINESS_EXTERNAL_HIDDEN_FIELDS` (internal_note, risk_comment, source_licence_detail, raw_bank_data, reviewer_name) are stripped by `projectReadinessForAudience` for every non-internal audience.
- [x] **Build-vs-data readiness proof** — `REGISTRY_OPS_READINESS_SECTIONS` (13) cover platform_build / country_coverage / source_licence / dataset_import / public_search / claim / authority / bank_capture / bank_verification / provider_integration / api_sandbox / api_production / commercial_billing. `REGISTRY_OPS_READINESS_REQUIRED_LABELS` pins `"Built - data/use approval pending"` and `"Data loaded - workflow not active"`. `REGISTRY_OPS_READINESS_BUILD_VS_DATA_COLLAPSED=false`.
- [x] **Client-safe wording proof** — `REGISTRY_OPS_CLIENT_SAFE_WORDING` pins the 7 client-supplied strings (not_independently_verified, demo_only, provider_pending, manual_evidence_reviewed, api_not_ready, sms_disabled, whatsapp_disabled).
- [x] **UI proof** — This batch is SSOT + guards + tests. Existing operations / outreach / notification / readiness admin surfaces from Batches 6, 7, 17, 18 remain unchanged and are not regressed; new SSOT is consumable without code changes in this batch. Trading Desk shell/sidebar behaviour preserved.
- [x] **Guard summary** — Parity guard pins SHA-256 byte-parity between browser + Deno SSOTs, validates 60+ required exports, and enforces invariants: AI draft-only / no-auto-send, SMS/WhatsApp disabled, manual log not represented as SMS/WhatsApp, overdue cannot auto-approve and must alert, alerts cannot auto-external-send, readiness default audience `internal_admin`, build-vs-data not collapsed, real email triple-gate, canonical disabled labels, SLA values per queue, and the queue priority 1–10 pin.
- [x] **Test summary** — `src/tests/batch-30-operations-outreach-notifications-readiness.test.ts` adds 25+ describe-level assertions across AI category allow-list, blocked/masked/admin-only/unknown field tiers, forbidden wording scan, AI human approval requirement, ordinary vs sensitive approver gating, two-person rule, sending mode + WhatsApp/SMS labels, manual-log non-representation, real-email gate, DNC scope/effect/add/remove rules, queue priority order, every SLA value, overdue alert (no auto-approve), admin/compliance/commercial alert triggers, notification channel matrix, bank-channel audience scoping, API-key audience, readiness audience projection + hidden-field stripping, build-vs-data readiness, client-safe wording exact strings, and 10 canonical audit event names.

## Release status

Registry remains UAT/demo-ready. Batch 30 is a SSOT + guards + tests
batch; no edge functions, schema, RLS, or UI components changed. All
Batch 24–29 evidence remains current; this batch closes out the
client operating-rules SSOT family for outreach, notifications,
operations queues and the readiness-dashboard audience.

## Edge functions requiring deploy (Batch 30)

- (none — Batch 30 is a SSOT/guards/tests batch; no edge surface changed.)
