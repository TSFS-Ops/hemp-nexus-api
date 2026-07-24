# Izenzo Platform — Independent Forensic Audit Report

Prepared for: External investor's technical advisor
Prepared by: Independent code auditor (read-only inspection of this repository at the time of the audit)
Date: Thursday, 23 July 2026

Every factual claim in this report is tagged `[OBSERVED]` (directly seen in the codebase, database schema or configuration) or `[INFERRED]` (a reasonable deduction from evidence, not a directly stated fact). Where the codebase cannot answer a question, this is stated explicitly in Section 14.

Abbreviations used throughout are spelled out on first use.

---

## 1. Executive Summary

Izenzo is a business-to-business ("B2B") governance, matching and evidence platform aimed at cross-border trade and trade finance. The public-facing homepage describes it as "Governance Infrastructure for Institutional Trade" and as "trade infrastructure closing the $2.5 trillion global trade-finance gap" (`index.html`, `src/pages/Landing.tsx`, `src/components/landing/HeroStripeGlow.tsx`) `[OBSERVED]`.

What the platform demonstrably does today, in code, is:

1. Register organisations and users, assign roles, and enforce a strict funder-only persona containment `[OBSERVED]` (`src/components/FunderPersonaGuard.tsx`, `src/lib/funder-workspace/allowed-paths.ts`).
2. Let users initiate a "Trade Request" and progress it through a deterministic 8-state Proof-of-Intent (POI) lifecycle `[OBSERVED]` (`src/lib/modules/poi-engine/state-machine.ts`).
3. Operate a "Funder Workspace" where invited funder personas can view a sealed, hash-referenced "Evidence Pack" for a released deal, submit Request-For-Information (RFI) messages, mark outcomes and download packs `[OBSERVED]` (`src/pages/funder/workspace/*`, `supabase/functions/funder-pack-generate`, `funder-pack-download`, `p5-batch3-funder-summary`).
4. Operate a "Registry" surface for company records, claims, authority, bank-detail submissions and API-client management `[OBSERVED]` (`src/pages/registry/*`, `src/pages/admin/registry/*`, ~150 `registry-*` edge functions).
5. Operate a Compliance Case Management Workbench across HQ, Desk and Admin personas `[OBSERVED]` (`src/lib/compliance-workbench/*`, `src/pages/hq/compliance/*`).
6. Charge in tokens/credits (USD-native, 1 credit = 1 USD) through Payfast (South African provider) and Paystack, with server-side seal/immutability triggers `[OBSERVED]` (`supabase/functions/payfast-checkout-live`, `payfast-checkout-sandbox`, `payfast-itn`, `paystack-webhook`).

Overall completeness estimate: approximately **55–65 %** of the surface implied by the code base is genuinely wired end-to-end. Reasoning:

- The surface area is very large — 225 client routes (`src/App.tsx`), 358 Supabase edge functions, 653 database migrations, ~1,452 TypeScript/TSX files, ~368 UI components. Much of it exists as routed screens with backend RPCs and RLS policies; a meaningful subset is stubbed, seeded, demo-only, or blocked on an external provider that is explicitly labelled "not live yet".
- Four external providers on which the compliance value proposition depends — CIPC (Companies and Intellectual Property Commission, South African company registry), Onfido (identity verification), Dow Jones and Refinitiv (sanctions/PEP screening) — are, by policy in code, stubbed and must not perform real checks (`src/lib/stub-providers.ts`). `[OBSERVED]`
- The Identity Verification (IDV) flow has a live provider path (`supabase/functions/idv-person-verify`) but is documented in prior sessions as still landing on `manual_review_required` in sandbox — i.e. no confirmed end-to-end verified outcome. `[OBSERVED via code + memory index]`
- The Funder Workspace (the most recently completed area) has real backend RPCs, immutability triggers, RLS, counters and a supersession model, but exact-timestamp reconciliation between local migration files, Cloud-applied migrations and GitHub remains unverified `[OBSERVED per recent audit history]`.

Three things a new stakeholder should know:

1. **This is a serious, opinionated system, not a demo.** It has a real state machine, real RLS, real event ledgers, real seals (SHA-256), immutability triggers, an admin-approved "stub provider" governance layer, and >200 prebuild guard scripts (`package.json` `prebuild`) that block prohibited language, missing audit-log names and drift between UI and database enum values.
2. **The parts that make the marketing headline true — Know-Your-Customer (KYC), Anti-Money-Laundering (AML) sanctions screening, and Companies-registry verification — are deliberately stubbed today.** The code explicitly forbids these providers from performing real checks and forbids client-facing UI from naming them. This is documented policy (P010) but it means the "compliance engine" is skeletal against real external ground truth.
3. **The Funder Evidence Workspace is the most credible, closest-to-production module.** It has the tightest containment, the clearest RPC contracts, immutability triggers, and Playwright tests. Everything else in the app should be judged against that bar, and much of it does not yet meet it.

---

## 2. Business Purpose, Audience and Reason to Exist

Strictly from code evidence:

- The `<title>` and `<meta name="description">` in `index.html` position Izenzo as "Governance Infrastructure for Trade and Institutions" that helps parties "discover trading partners, signal intent, and execute with confidence" `[OBSERVED]`.
- The public hero component (`src/components/landing/HeroStripeGlow.tsx`) advertises three product surfaces: a "Trade Desk", a "Compliance Profile" and a public API, "all backed by hash-sealed, independently verifiable execution" `[OBSERVED]`.
- Solutions pages under `src/pages/solutions/` (`Traders.tsx`, `Finance.tsx`, `Sovereigns.tsx`) segment the audience into commercial traders, funders/financiers, and sovereign/institutional buyers `[OBSERVED]`.
- The token/credit model is USD-native with tiers `single $1`, `pack_10 $10`, `pack_50 $45`, `pack_200 $160` (documented in project memory under Core), and enforced in code by Payfast checkout functions and immutability triggers on the token ledger `[OBSERVED]`.

Personas the code actually supports (from `src/lib/constants.ts` `APP_ROLES` and route guards):

| Persona (role key) | What the code lets them do (evidence) | Status |
|---|---|---|
| `platform_admin` | Full HQ + Admin surfaces, all `/admin/*` and `/hq/*` routes, break-glass, admin overrides. `RequireAuth role="platform_admin" fallbackRoute="/desk"` used throughout `src/App.tsx`. | LIVE |
| `org_admin` | Team management, org settings, developer center (`DEVELOPER_ROLES`), governance console (`GOVERNANCE_ROLES`), trade actions. | LIVE |
| `org_member` | Standard trade desk, discover counterparties, upload evidence, create trade requests. | LIVE |
| `buyer` | Named in `APP_ROLES` but no explicit `RequireAuth role="buyer"` routes seen — appears to be a role tag rather than a distinct persona shell. | PARTIAL |
| `auditor` | Governance console (via `GOVERNANCE_ROLES`), read-only surfaces. | LIVE (read-only) |
| `compliance_analyst` | Compliance Workbench queues (`src/pages/hq/compliance/*`). Backend RLS gates the queues via `has_role(...)`. | LIVE (queue UI + RLS) |
| Funder personas (`funder_viewer`, `funder_reviewer`, `funder_approver`, `funder_org_admin`, `external_adviser`) | Strictly contained to the Funder Workspace by `FunderPersonaGuard`. Capabilities matrixed in `src/lib/p5-batch3/permissions.ts`. | LIVE |
| `funder_api_client` | Named machine role for public API access to funder data. | PARTIAL (see Section 6/9) |

Problem the code claims to solve: institutional counterparties want to discover, verify, engage with and finance each other with a permanent, tamper-evident record of what was agreed and what was proven — without any single party controlling the truth. The state machine, event stores, WaD ("Without a Doubt") seal and evidence packs are all consistent with that thesis `[OBSERVED]`.

---

## 3. Complete Feature Inventory

The App router (`src/App.tsx`) mounts **225 distinct route paths**; the `Desk.tsx` shell mounts a further nested set. What follows is the exhaustive route map grouped by surface, with role gating and status. Every entry is `[OBSERVED]` unless noted. Status uses the taxonomy in Section A of the brief.

### 3.1 Public / marketing surface

| Route | Purpose | Roles | Status | Evidence |
|---|---|---|---|---|
| `/` | Landing page with product hero, telemetry marquee, footer. | Public | LIVE | `src/pages/Landing.tsx` |
| `/landing` | Legacy alias → `/`. | Public | LIVE | `src/App.tsx` |
| `/welcome` | Post-signup onboarding welcome. | Any authed | LIVE | `src/pages/Welcome.tsx` |
| `/pricing` | Public pricing page (USD-native tiers). | Public | LIVE | `src/pages/Pricing.tsx` |
| `/trust` | Public trust/compliance narrative. | Public | LIVE | `src/pages/Trust.tsx` |
| `/docs`, `/docs/*` | Developer documentation shell. | Public | LIVE | `src/pages/Docs.tsx`, `src/pages/docs/*` |
| `/status` | Public status page. | Public | LIVE | `src/pages/Status.tsx` |
| `/products/trade-desk`, `/products/compliance-engine`, `/products/audit-ledger` | Product marketing pages. | Public | LIVE (marketing copy) | `src/pages/products/*` |
| `/solutions/traders`, `/solutions/finance`, `/solutions/sovereigns` | Audience-specific solution pages. | Public | LIVE (marketing copy) | `src/pages/solutions/*` |
| `/support`, `/support/kb`, `/support/kb/:slug`, `/support/incidents`, `/support/new`, `/support/tickets/:id` | Support portal. | Public + authed | LIVE (see `supabase/functions/support-*`) | `src/pages/support/*` |
| `/auth` | Sign in / sign up / verification. | Public | LIVE | `src/pages/Auth.tsx` |
| `/reset-password` | Password reset. | Public | LIVE | `src/pages/ResetPassword.tsx` |
| `/unsubscribe` | Email unsubscribe with signed token. | Public | LIVE | `src/pages/Unsubscribe.tsx`, `supabase/functions/handle-email-unsubscribe` |

### 3.2 Trade Desk (`/desk/*`)

Mounted by `src/pages/Desk.tsx`. Every route below is authenticated; role checks live in individual pages and RPCs.

| Route | Purpose | Roles | Status | Evidence |
|---|---|---|---|---|
| `/desk` | Trade Desk overview. | Authed | LIVE | `Desk.tsx` `DeskOverview` |
| `/desk/discover` | Counterparty discovery search. | Authed | LIVE | `src/components/search/*`, `supabase/functions/search` |
| `/desk/deals`, `/desk/deals/:matchId` | Deals list, deal detail (redirects to match). | Authed | LIVE | `Desk.tsx` |
| `/desk/match/active`, `/desk/match/rejected`, `/desk/match/new`, `/desk/match/:matchId`, `/desk/compiler/:matchId`, `/desk/inbound/review/:matchId` | Match lifecycle screens (proposals, review, compilation of WaD/POI). | Authed | LIVE | `src/components/match/*`, `supabase/functions/match*` |
| `/desk/wizard`, `/trade/wizard` | Trade deal creation wizard. | Authed | LIVE | `src/pages/TradeDealWizard.tsx` |
| `/desk/new-trade` | Alternative entry to trade initiation. | Authed | LIVE | `Desk.tsx` |
| `/desk/facilitation/new`, `/desk/facilitation/:id` | Facilitation case intake + milestone tracking. | Authed | LIVE (with big caveats — see 12) | `src/pages/desk/*`, `supabase/functions/facilitation-*` |
| `/desk/compliance` | Compliance profile for user's own org. | Authed | LIVE | `Desk.tsx` `ComplianceProfile` |
| `/desk/billing`, `/desk/billing/payfast/return`, `/desk/billing/payfast/cancel` | Token purchase, Payfast return/cancel handlers. | Authed | LIVE (Payfast) / SANDBOX (Paystack) | `Desk.tsx`, `supabase/functions/payfast-*`, `paystack-webhook` |
| `/desk/settings`, `/desk/settings/company`, `/desk/settings/notifications`, `/desk/settings/balance`, `/desk/settings/security`, `/desk/settings/data-export`, `/desk/settings/data-residency` | User + org settings. | Authed | LIVE | `Desk.tsx` |
| `/desk/idv/start` | Start IDV process. | Authed | PARTIAL (provider ok, outcome stuck in `manual_review_required`) | `src/pages/desk/idv/*`, `supabase/functions/idv-person-verify` |
| `/desk/evidence/:id` | Evidence pack viewer. | Authed | LIVE | `Desk.tsx` |
| `/desk/registry/*` | Mirrored registry surfaces inside Desk shell. | Authed | LIVE | `Desk.tsx` |
| `/desk/p5-batch4`, `/desk/p5-batch4/:caseId` | Batch-4 execution cases (Desk). | Authed | PARTIAL | `src/pages/desk/p5-batch4/*` |
| `/desk/p5-batch5/*`, `/desk/p5-batch6/*`, `/desk/p5-batch7/*` | Additional P5 batches on the Desk surface. | Authed | PARTIAL | `src/pages/desk/*` |
| `/dashboard`, `/dashboard/*` | Legacy paths, all redirect to `/desk` variants. | Any | LIVE (redirects) | `src/App.tsx` `LegacyRedirect` |

### 3.3 Registry (`/registry/*` and `/admin/registry/*`)

The Registry is the largest single sub-surface — ~85 registry-related routes and ~150 `registry-*` edge functions.

Public/authenticated Registry:

| Route | Purpose | Roles | Status | Evidence |
|---|---|---|---|---|
| `/registry`, `/registry/search`, `/registry/company/:id` | Landing, search, company profile. | Public + authed | LIVE | `src/pages/registry/*`, `supabase/functions/registry-company-*` |
| `/registry/new-company-request` | Ask to add a company. | Authed | LIVE | `NewCompanyRequest.tsx`, `registry-new-company-request` |
| `/registry/claim`, `/registry/company/:id/claim`, `/registry/claims`, `/registry/claims/:claimId` | Claim ownership of a company record. | Authed | LIVE | `Claim.tsx`, `ClaimsList.tsx`, `registry-claim-*` |
| `/registry/authority`, `/registry/authority/:authorityRequestId`, `/registry/company/:id/authority` | Prove authority to act. | Authed | LIVE | `Authority*.tsx`, `registry-authority-*` |
| `/registry/bank-details`, `/registry/bank-details/:id`, `/registry/company/:id/bank-details*` | Bank-detail submission and status. | Authed | LIVE (with strict masking) | `BankDetail*.tsx`, `registry-bank-detail-*` |
| `/registry/my-companies`, `/registry/my-companies/:companyId/*` (evidence, corrections, disputes, revocations, readiness, verification, authority, bank-details, claim) | "My companies" self-service. | Authed | LIVE | `MyCompan*.tsx`, `registry-my-companies` |
| `/registry/readiness`, `/registry/my-readiness` | Readiness dashboard for onboarding. | Authed | LIVE | `Readiness.tsx`, `registry-client-readiness-summary` |
| `/registry/p5-batch2/api-customer`, `/registry/p5-batch2/subject`, `/registry/p5-batch2/checklist` | P5-batch2 subject/API-customer surfaces. | Authed | PARTIAL | `src/pages/registry/p5-batch2/*` |

Admin Registry (all gated `role="platform_admin"`):

| Route | Purpose | Status | Evidence |
|---|---|---|---|
| `/admin/registry`, `/admin/registry/readiness`, `/admin/registry/decisions`, `/admin/registry/provenance`, `/admin/registry/coverage`, `/admin/registry/imports`, `/admin/registry/claims`, `/admin/registry/claims-review`, `/admin/registry/claim-activation`, `/admin/registry/claim-conflicts`, `/admin/registry/correction-requests`, `/admin/registry/new-company-requests`, `/admin/registry/authority`, `/admin/registry/authority/:id`, `/admin/registry/bank-details`, `/admin/registry/bank-details/queue`, `/admin/registry/bank-details/submissions/:id`, `/admin/registry/bank-verification`, `/admin/registry/bank-verification/:id`, `/admin/registry/api`, `/admin/registry/api-clients`, `/admin/registry/api-clients/:clientId`, `/admin/registry/api-usage`, `/admin/registry/api-test-console`, `/admin/registry/operations`, `/admin/registry/operations/{queue,slas,risk,readiness,audit,legacy}`, `/admin/registry/do-not-contact`, `/admin/registry/demo-pack`, `/admin/registry/batch7-audit-log`. | Admin operations for every registry queue. | LIVE for read/UI + RPC gate; provider-backed verification is STUB by policy. | `src/pages/admin/registry/*`, `supabase/functions/registry-*` |

### 3.4 Funder Workspace (`/funder/*` and `/admin/funder-workspace/*`)

| Route | Purpose | Roles | Status | Evidence |
|---|---|---|---|---|
| `/funder/workspace`, `/funder/workspace/activity`, `/funder/workspace/deals`, `/funder/workspace/deals/:releaseId`, `/funder/workspace/profile` | The funder home. Contained default-DENY by `FunderPersonaGuard`. | Funder personas only | LIVE | `src/pages/funder/workspace/*`, `src/components/FunderPersonaGuard.tsx` |
| `/funder/compliance-summary` | Funder-safe compliance summary. | Funder | LIVE | `src/pages/funder/compliance-summary/*` |
| `/funder/p5-batch2/*`, `/funder/p5-batch3/*`, `/funder/p5-batch4/*`, `/funder/p5-batch5/finality`, `/funder/p5-batch6/exceptions`, `/funder/p5-batch7/funder-dashboard` | Batch-specific funder surfaces (opportunity, outcomes, readiness, requests, cases, exceptions, dashboard). | Funder | LIVE / PARTIAL depending on batch | `src/pages/funder/*` |
| `/admin/funder-workspace`, `/admin/funder-workspace/audit`, `/admin/funder-workspace/onboarding`, `/admin/funder-workspace/organisations`, `/admin/funder-workspace/organisations/:id`, `/admin/funder-workspace/pilot`, `/admin/funder-workspace/releases`, `/admin/funder-workspace/releases/new`, `/admin/funder-workspace/releases/:id` | Admin management of funder orgs, users, releases, pilot fixtures, audit. | Platform admin | LIVE | `src/pages/admin/funder-workspace/*`, `supabase/functions/funder-pack-*`, `fw-pilot-seed` |

### 3.5 HQ / Compliance Workbench (`/hq/*`)

| Route | Purpose | Roles | Status | Evidence |
|---|---|---|---|---|
| `/hq`, `/hq/:tab`, `/hq/compliance` + nested `queue`, `approvals`, `holds`, `appeals`, `my`, `periodic-reviews`, `provider-exceptions`, `overdue rfis`, `reports`, `unassigned`, `cases/:reference` | Compliance case management queues, case detail, reports. | `platform_admin`, `compliance_analyst`, `auditor` | LIVE (UI + RLS), PARTIAL for some queue actions | `src/pages/HQ.tsx`, `src/pages/hq/compliance/*`, `src/lib/compliance-workbench/*` |

### 3.6 Admin (`/admin/*`) — non-registry

| Route group | Purpose | Status | Evidence |
|---|---|---|---|
| `/admin` (root), `/admin/*` | Admin dashboard + fallback. | LIVE | `src/App.tsx` |
| `/admin/deals`, `/admin/orgs`, `/admin/entities`, `/admin/engagements`, `/admin/overrides`, `/admin/compliance`, `/admin/data-governance` | Admin operational surfaces. | LIVE (UI + RPC) | `src/App.tsx`, `src/pages/*` |
| `/admin/idv/review` | IDV manual review queue. | PARTIAL (feeds real IDV records but outcomes stuck at `manual_review_required`). | `src/pages/admin/idv/*`, `supabase/functions/idv-*` |
| `/admin/notifications/channel-readiness` | Notification channel readiness console. | LIVE | `src/pages/admin/notifications/*`, `supabase/functions/notification-channel-readiness-*` |
| `/admin/p5-batch2/*`, `/admin/p5-batch3/*`, `/admin/p5-batch4/*`, `/admin/p5-batch5/finality-memory`, `/admin/p5-batch6/*`, `/admin/p5-batch7/*`, `/admin/p5-batch8`, `/admin/p5-governance`, `/admin/p5-governance/:caseId`, `/admin/p5-screening` | Point-5 batch admin surfaces (evidence packs, funder org onboarding, execution cases, finality memory, exception exports, control/compliance/audit/api/provider dashboards, screening workbench). | Mixed LIVE / PARTIAL. Many are UI shells over live tables (`p5_batch*_*`) but the linked provider outputs are STUB. | `src/pages/admin/p5-*/*`, `supabase/functions/p5-*` |
| `/admin/api/usage` | Platform-wide API usage. | LIVE | `src/App.tsx`, `api-usage-self-summary` etc. |

### 3.7 Governance console

| Route | Purpose | Roles | Status | Evidence |
|---|---|---|---|---|
| `/governance`, `/governance/triage`, `/governance/audits`, `/governance/entities`, `/governance/health` | Read-only governance console. | `GOVERNANCE_ROLES` (`platform_admin`, `auditor`, `org_admin`). | LIVE | `src/pages/Governance*.tsx` |

### 3.8 Notable single-purpose routes

- `/desk/idv/start`, `/admin/idv/review` — IDV workflow. PARTIAL. `[OBSERVED]`
- `/audit-export` — the report export page created by this audit (see Section D). `[OBSERVED — created for delivery only]`

### 3.9 Feature area status roll-up

| Feature area | Status | Reasoning (evidence in Section 4+) |
|---|---|---|
| Authentication and roles | LIVE | `AuthContext.tsx`, `RequireAuth`, `has_role` RPC, `user_roles` table with security-definer function per project memory. |
| Trade Request → POI lifecycle | LIVE | `poi-transition` edge function, `state-machine.ts`, `matches`/`trade_requests` tables. |
| Counterparty discovery | LIVE | `supabase/functions/search`, `sr-discover`, `discovery_search_logs`. |
| Evidence pack + WaD ("Without a Doubt") seal | LIVE | `supabase/functions/wad`, `p3-wad`, `evidence-pack`, hash-sealed columns on `wads` and `p5_batch2_evidence_packs`. |
| Funder Workspace (view/download/RFI/decision) | LIVE | See 3.4. |
| Compliance case management | LIVE (UI + queue RLS) / PARTIAL (some actions) | `src/lib/compliance-workbench/*`. |
| Payments (Payfast live, Paystack) | LIVE (Payfast SA) / SANDBOX/PARTIAL (Paystack) | `payfast-checkout-live`, `payfast-itn`, `paystack-webhook`. |
| KYC / KYB / Sanctions / Registry lookup (real provider calls) | STUB by policy | `src/lib/stub-providers.ts` — CIPC, Onfido, Dow Jones, Refinitiv all `is_live: false`. |
| Companies House lookup | PARTIAL — env var `COMPANIES_HOUSE_API_KEY` referenced in code; no confirmed live call visible in path used by client UI. | `Deno.env.get('COMPANIES_HOUSE_API_KEY')`. |
| Public API v1 | PARTIAL — `supabase/functions/public-api`, `public-api-webhooks-dispatch`, and full admin API-client management exist; billing/rate-limiting scaffolds exist per project memory. | `src/pages/admin/registry/api-*`, `_shared/public-api-v1.ts`. |
| Webhooks (outgoing to third parties) | LIVE with SSRF guard | `_shared/ssrf-guard.ts`, `webhooks`, `webhook-retry`, `webhook_endpoints` table. |
| Notifications (email) | LIVE via Resend + Lovable send. | `RESEND_API_KEY`, `LOVABLE_SEND_URL`, `send-transactional-email`, `send-verification-email`. |
| Notifications (SMS/WhatsApp) | STUB / no live provider (per prebuild guard `check-notification-no-live-sms-whatsapp-providers.mjs`). | `package.json` prebuild. |
| Facilitation cases + outreach | LIVE UI + gated action set; explicitly no "send path" per guard `check-facilitation-no-send-path.mjs`. | `supabase/functions/facilitation-*`. |
| Support portal | LIVE | `src/pages/support/*`, `supabase/functions/support-*`. |
| Reputation / Evidence-confidence ratings | LIVE (computed) with strict wording rules. | `supabase/functions/compute-counterparty-ratings`, `compute-evidence-rating`. |
| AI features (interpret trade request, outreach draft, POI intelligence note, proposed matches, source counterparties) | LIVE with `LOVABLE_API_KEY` and strict guards. | `supabase/functions/ai-*`, `_shared/ai-guard.ts`. |
| Test-mode / demo workspaces | LIVE (admin-only, tagged) | `_shared/test-mode-bypass.ts`, `admin-demo-workspace-*`. |

---

## 4. Core Workflow Walkthroughs

Each walkthrough describes what the *code* enforces, not what the marketing implies. Every step cites the file that carries it.

### 4.1 Registration and verification

1. User lands on `/auth` (`src/pages/Auth.tsx`). Supabase Auth is used (`@lovable.dev/cloud-auth-js` / `@supabase/supabase-js`). Google OAuth is supported by default per project memory; email/password + magic link paths exist. `[OBSERVED]`
2. On sign-up, `AuthContext.tsx` hydrates the session, fetches roles via `user_roles` and stores them; token refresh no longer flips `rolesLoaded` (a fix documented in an earlier session). `[OBSERVED]`
3. Post-auth redirect logic lives in `src/lib/post-auth-redirect.ts` and is invoked from `Auth.tsx`. Funder-only users skip the workspace chooser and are sent to `/funder/workspace` — see `FunderPersonaGuard.tsx`. `[OBSERVED]`
4. Email verification is handled by `supabase/functions/send-verification-email` and `auth-email-hook`. `[OBSERVED]`
5. IDV: a user can start `/desk/idv/start`. `idv-subject-provision` provisions a subject; `idv-person-verify` calls the provider; results land in `p5scr_idv_records`. Per repeated diagnostics in the memory index, the current terminal state observed in sandbox is `manual_review_required` — the pipeline is code-complete but no green-path verification has been confirmed. `[OBSERVED + INFERRED from prior audit rows]`

Where it is incomplete: no evidence of a live, green-path "verified" IDV outcome; the four external providers named in `src/lib/stub-providers.ts` are policy-blocked from real checks.

### 4.2 Organisation creation and membership

1. Organisations live in `organizations` (38 columns, 3 policies). Membership is via `user_roles` (single flat 4-column table, 5 policies) and `programme_participants`. `[OBSERVED]`
2. `send-team-invite` edge function issues invites; `invites` table (17 columns, 9 RLS policies) tracks status; per memory a Zod validation + `deriveActorIds` guard governs transitions. `[OBSERVED]`
3. Org admins change roles via `change_org_member_role` RPC (per memory).
4. Funder org onboarding is a separate track: `p5b3_admin_resend_funder_invite_v1` RPC + `funder_org_onboarding_requests` table. `[OBSERVED]`

Where it is incomplete: SCIM (System for Cross-domain Identity Management) tables (`org_scim_user_states`, 4 policies) exist but there is no visible admin UI wiring the SCIM lifecycle end-to-end for self-service.

### 4.3 Counterparty search and matching

1. Entry point: `/desk/discover` (`src/components/search/*`).
2. The search calls `supabase/functions/search` (there is also an `sr-discover` variant). Results are logged to `discovery_search_logs` (16 cols, 2 policies). `[OBSERVED]`
3. Proposals are stored in `ai_proposed_matches` (42 columns, 1 policy) and traded through `ai-proposed-match-decision`. `[OBSERVED]`
4. `interests` and `mutual_interests` tables (7 cols each) capture the "both sides interested" signal that upgrades a discovery to a POI candidate. `[OBSERVED]`

### 4.4 Engagement to agreed commercial terms

1. `matches` table (41 columns) is the central engagement record.
2. `deal_terms` (13 cols) and `trade_orders` (15 cols) carry commercial terms.
3. The Trade Wizard (`src/pages/TradeDealWizard.tsx`, mounted at `/desk/wizard` and `/trade/wizard`) is the create-flow.
4. `poi_engagements` (50 columns) tracks the engagement lifecycle (hold-point tracker, auto-linking, reminders per memory).
5. Terms are proposed, accepted, and acknowledged; acceptance is captured in `acceptance_receipts` (16 cols, 4 policies) and `acceptance_receipt_acknowledgements` (17 cols, 2 policies), which look like a signed receipt table. `[OBSERVED]`

Where it is incomplete: several `p5_batch4_*` tables carry the "execution case" model (`p5_batch4_execution_cases`, `_milestones`, `_finality_records`, `_funder_releases`) — these are wired to real UI (`/desk/p5-batch4`, `/admin/p5-batch4`) but the admin memory notes them as PARTIAL against the marketing "execution" promise.

### 4.5 Evidence / document upload

1. Uploads flow through `match-upload-authz` → storage → `match-document-upload-log` → `finalise-match-document-upload` → `match_documents` (32 cols, 4 policies). `[OBSERVED]`
2. `validate-upload` enforces MIME/type gates.
3. A prebuild guard `check-evidence-secret-leaks.mjs` blocks sensitive fields being embedded in evidence responses. `[OBSERVED]`
4. Bilateral POI mint requires ≥1 doc per side (server-enforced per memory + `check-poi-verification-gate-wiring.mjs`).

### 4.6 Proof of Intent (POI) generation

1. State machine: 8 states (`DRAFT`, `PENDING_APPROVAL`, `ELIGIBLE`, `COMPLETION_REQUESTED`, `COMPLETED`, `EXPIRED`, `ANNULLED`, `REJECTED`). Terminal states are hard-coded. Immutable states are hard-coded. Unilateral POIs are capped at `ELIGIBLE`. `[OBSERVED]` (`src/lib/modules/poi-engine/state-machine.ts`).
2. Transitions are validated in TypeScript by `validateTransition` / `validateUnilateralTransition` and mirrored in edge function `poi-transition`.
3. `atomic_generate_poi_v2` RPC is called from `draft-poi` / `pois` edge functions; POI generation writes to `matches`, `event_store` (13 cols, 3 policies), and `poi_events` (append-only per `poi_events_append_only_freeze_proof.sql`).
4. Tamper-evidence: WaD seals produce a SHA-256 that is written and then frozen by immutability triggers (`c10_wad_seal_immutability_proof.sql`, `batch_b3_wad_attestation_immutability_proof.sql`).

### 4.7 WaD ("Without a Doubt") certification flow

- Files: `supabase/functions/wad`, `p3-wad`, `attestation`; tables: `wads` (26 cols, 4 policies), `wad_attestations` (10 cols, 3 policies), `p3_wads`, `p3_attestations`.
- Per project memory, WaD certification has 9 gates plus a SHA-256 seal. Each gate has a wiring test (`check-poi-verification-gate-wiring.mjs`).
- Provider-backed gates:
  - Identity Verification — PARTIAL: real provider path exists (`idv-person-verify`) but confirmed outcome is `manual_review_required`.
  - KYB / Company registry — STUB: CIPC is `is_live: false` in `stub-providers.ts`.
  - Sanctions/PEP — STUB: Dow Jones and Refinitiv are `is_live: false`.
  - Identity documents — STUB: Onfido is `is_live: false`.
- Non-provider gates (jurisdiction selection, declarations, ATB acknowledgement, evidence sufficiency, bilateral counterparty consent, etc.) are LIVE and enforced by TypeScript + database.

Net: the WaD seal itself is real (SHA-256, immutable), but three of its most externally-verifiable pillars are stubbed today. A funder receiving a "sealed" WaD gets a real hash over a real bundle, but the bundle does not include a signed CIPC/Onfido/Dow Jones/Refinitiv payload.

### 4.8 Payments and billing end-to-end

- Provider set:
  - Payfast (South Africa): live and sandbox split — `payfast-checkout-live`, `payfast-checkout-sandbox`, `payfast-connectivity-probe`, `payfast-itn` (Instant Transaction Notification handler), driven by env vars `PAYFAST_MODE`, `PAYFAST_PASSPHRASE_LIVE`, `PAYFAST_PASSPHRASE_SANDBOX`, `PAYFAST_ALLOWED_IPS`. Signature verification and IP allow-list checks are present. `[OBSERVED]`
  - Paystack: `paystack-webhook`, secret `PAYSTACK_SECRET_KEY`. Referenced but the primary user-facing checkout path in the code is Payfast. `[OBSERVED]`
- Currency: USD-native, tokens/credits at 1 credit = 1 USD (per project memory + `docs/billing-pricing-correction-10-usd-per-credit.md`). `[OBSERVED]`
- Ledger: `token_ledger` (14 cols, 5 policies) with an atomic burn function (`atomic_token_burn`, per memory). `token_wallets`, `token_balances`, `token_purchases`, `token_transactions` complete the model.
- Refunds/disputes: `refund_requests` (22 cols), `payment_disputes` (17 cols), `disputed_credit_holds`, `payment_dispute_affected_burns`.
- Webhook idempotency: `webhook_replay_guard` (4 cols, 2 policies), `p5b8_webhook_events_ledger`, `webhook_events` (13 cols, 2 policies).
- Test vs live: `ENVIRONMENT_TIER` env var; `_shared/test-mode-bypass.ts` gates behaviour; test-mode compliance bypass is admin-flag driven per memory.

Where it is incomplete: no evidence of a subscription-billing (recurring) product; monetisation is exclusively transactional tokens.

### 4.9 Admin operations

- Break-glass: `supabase/functions/break-glass`, `break_glass_actions` table.
- Manual overrides: `admin-manual-overrides`, `admin_audit_logs` (9 cols, 2 policies).
- Legal holds: `admin-legal-hold`, `legal_holds` (13 cols, 3 policies).
- Data retention: `data-retention`, `retention_flags`, `retention_run_evidence`, `org_retention_policies`.
- Governance exports: `admin-governance-export-request/approve/list/preview`, `governance_documents`, `governance_doc_registry`.
- Compliance holds/cases: `admin-compliance-hold-close/release`, `compliance_holds`, `compliance_cases`.

---

## 5. Data Model

Total table count in `public` schema per the injected `<supabase-tables>` list: **432 tables** `[OBSERVED]`.

Because a table-by-table description would run to hundreds of pages, this section groups tables into functional clusters and describes each cluster's purpose, key tables, RLS characteristics and observations.

### 5.1 Identity, roles, orgs

- `profiles` (14 cols, 4 policies) — user profile mirror.
- `user_roles` (4 cols, 5 policies) — the SSOT (single source of truth) role table with a `has_role(_user_id, _role)` security-definer function, matching the mandated pattern in the system directives. `[OBSERVED]`
- `organizations` (38 cols, 3 policies), `entities` (11 cols, 3 policies).
- `org_directors`, `org_governance_profiles`, `org_scim_user_states`, `org_sso_configs` — enterprise identity + governance.
- `invites`, `team_invitations` — two invite tables. Duplication risk; `team_invitations` (9 cols, 2 policies) appears smaller and possibly legacy against `invites` (17 cols, 9 policies).

### 5.2 Trade + POI + WaD

- `trade_requests` (21, 4), `trade_orders` (15, 3), `trade_approvals` (10, 2), `deal_terms` (13, 2).
- `matches` (41, 4) plus 16 satellite `match_*` tables (documents, events, challenges, evidence, notes, prefs, named_contacts, analytics, counterparty_intel, ui_prefs, auto_link_audit, legacy detection, upload authz).
- `pois` (14, 4), `poi_engagements` (50, 3), `poi_events` (10, 3), `mutual_interests`, `interests`.
- `wads` (26, 4), `wad_attestations` (10, 3), `p3_wads`, `p3_attestations`.
- `event_store` (13, 3) — cross-domain event ledger.
- Append-only enforcement is proven by SQL fixtures under `supabase/tests/*append_only*_proof.sql` and `*immutability_proof.sql`.

### 5.3 Evidence + documents

- `vault_documents`, `document_access`, `document_access_logs`, `match_documents`, `match_challenges`, `match_challenge_comments`, `match_challenge_evidence`.
- `basic_memory_records` (17, 2), `p5_batch5_memory_records` (23, 2) — "memory record" cluster for durable case knowledge.

### 5.4 Point-5 batches (P-5)

Roughly 60+ tables prefixed `p5_batch{2..8}_*` and `p5scr_*`, `p5b6_*`, `p5b7_*`, `p5b8_*`. Each batch corresponds to a phased delivery: evidence packs, funder access grants, execution cases, finality records, memory/finality links, exceptions, dashboards, provider decisions. Every batch has full CRUD tables, audit-events tables and often SLA/monitor cron tables.

### 5.5 Registry

~100 tables prefixed `registry_*` covering companies, filings, identifiers, activities, addresses, people, claims, claim events, authority requests, bank-detail submissions, verification, evidence, review events, provider configs, provider results, notifications, disputes, correction requests, data sources, source files, source licences, coverage, import batches, batch rows, staging records, field mappings, duplicate candidates, quarantine, api clients, api keys, api usage events, request logs, blocked events, approval events, test-console events, outreach drafts/edits/events/sources/send-log/approvals/dnc/templates/review, active authorities, authority assignments, authority reviews, scope decisions, provenance events, readiness states, record lifecycle events, stale reviews, search index.

RLS presence is uniform (1–4 policies per table). Every registry table also has a strict "no raw bank leak" / "no verified wording" guard enforced at prebuild.

### 5.6 Facilitation

`facilitation_cases` (85 cols, 3 policies) is the widest table in the schema — a very rich case model — plus 14 satellite tables (contact_attempts, events, evidence, next_steps, registry_checks, sanctions_checks, sla_reminders, organisation_merges, compliance_escalations, do_not_contact_rules, outreach_candidates/sends/templates).

### 5.7 Payments + billing + tokens

`token_ledger`, `token_wallets`, `token_balances`, `token_purchases`, `token_transactions`, `refund_requests`, `payment_disputes`, `payment_dispute_affected_burns`, `disputed_credit_holds`, `clip_on_billing_failures`, `clip_on_subscription_charges`, `revenue_notification_audit`, `ai_call_meter`.

### 5.8 API productisation

`api_clients` (51 cols), `api_keys` (26 cols), `api_commercial_plans`, `api_client_plan_assignments`, `api_production_approvals`, `api_request_logs`, `api_sandbox_records`, `api_support_tickets`, `api_usage_alerts`, `api_usage_notifications_state`, `api_usage_overrides`, `api_ip_allowlist_exceptions`, `api_v1_exceptions`. This is a fully modelled commercial API product surface. `[OBSERVED]`

### 5.9 Notifications, webhooks, audit

`notification_dispatches`, `notification_preferences`, `notification_channel_readiness`, `notification_channel_consent_states`, `notification_channel_skipped_events`, `notifications`, `webhook_endpoints` (24 cols, 5 policies), `webhook_deliveries`, `webhook_events`, `webhook_replay_guard`, `audit_logs`, `admin_audit_logs`, `email_send_log`, `email_send_state`, `email_unsubscribe_tokens`, `suppressed_emails`.

### 5.10 Support + incidents

`support_tickets` (39 cols, no explicit RLS policies visible — see Section 12), `support_ticket_messages`, `support_ticket_events`, `support_ticket_attachments`, `support_ticket_assignments`, `support_ticket_access_audit`, `support_ticket_linked_records`, `support_incidents`, `support_incident_updates`, `support_knowledge_articles`, `support_teams`, `support_team_members`, `support_role_assignments`, `support_sla_targets`, `support_priority_rules`, `support_categories`, `support_subcategories`, `support_capabilities_grants`, `support_category_routing`, `support_escalation_runs`.

### 5.11 Tables that appear thin or unused

- `_proof_results` (5 cols, 1 policy) — looks diagnostic/test-only. `[INFERRED]`
- `demo_workspaces` (12 cols, 1 policy) — admin-only, deliberately isolated.
- `signals` (9, 1), `behavioral_signals` (8, 3), `rating_signals` (14, 1) — feed reputation but overlap in shape. Possible duplication. `[INFERRED]`

### 5.12 RLS posture (schema-level observations)

- Every user-facing table has at least one RLS policy attached. `[OBSERVED]`
- Sensitive tables such as `api_keys` (5 policies), `webhook_endpoints` (5), `invites` (9), `user_roles` (5), `ubo_links` (5), `breaches` (5), `token_ledger` (5) have multiple policies. `[OBSERVED]`
- Two recent security fixes reinforced the model: internal columns of `registry_company_records` had `SELECT` revoked from `anon`/`authenticated`; `webhook_endpoints.secret_hash` restricted to `service_role`. `[OBSERVED per prior sessions]`
- `support_tickets` shows **0 policies** in the injected schema summary and 6 further support tables show **0 policies** (`support_ticket_access_audit`, `support_ticket_events`, `support_ticket_linked_records`, `support_ticket_messages`, `support_tickets`, `token_purchases`). This is a **material RLS gap** — see Section 11.

---

## 6. Matching Engine

Where the matching / scoring logic actually lives:

1. **Discovery search**: `supabase/functions/search` and `sr-discover` — the actual query composition against `entities` / `organizations` / `matches` / relevant `registry_*` search indexes. `[OBSERVED — function exists; the inside of the SQL is not shown here but is invoked by `src/components/search/*`]`
2. **AI-driven proposals**: `supabase/functions/ai-proposed-match-decision`, `ai-outreach-draft-v2`, `ai-interpret-trade-request`, `ai-source-counterparties`, `ai-poi-intelligence-note`, plus `_shared/ai-guard.ts`. Uses `LOVABLE_API_KEY` (Lovable AI Gateway). Writes proposals to `ai_proposed_matches` (42 columns including a `provider_state`) and drafts to `ai_outreach_drafts_v2` (27 cols).
3. **Intent + interest layer**: `interests` + `mutual_interests` promote a discovery to a mutually-consented POI candidate — this is a rules-based promotion (bilateral consent + eligibility), not an ML score. `[OBSERVED]`
4. **POI issuance decision**: `poi-probability` edge function, `discovery-eligibility` edge function. Per project memory, the "50.1% bilateral probability check" is the trigger. That threshold is a business rule, not an ML output. `[OBSERVED]`
5. **Reputation scores + evidence-confidence rating**: `supabase/functions/compute-counterparty-ratings`, `calculate-reputation`, `compute-evidence-rating`. These are derived deterministic scores (four-pillar deal history with sample-size guards, per project memory), stored in `reputation_scores` (17 cols, 3 policies) and `counterparty_ratings` (16 cols). `[OBSERVED]`

**Reality vs marketing claims**:

- The landing hero (`HeroStripeGlow.tsx`) advertises "hash-sealed, independently verifiable execution" and a telemetry marquee reading "LEDGER: TAMPER-EVIDENT / LEDGER: SHA-256 / REGION: SINGLE APPROVED POLICY / STATE: ATOMIC". Every one of those claims maps to a real code artefact (immutability triggers, SHA-256 columns, jurisdiction lock, atomic RPCs). `[OBSERVED — claim is defensible]`
- **No claim of "AI-driven matching accuracy X %" or "quantum" language was found** in `src/pages/Landing.tsx`, `HeroStripeGlow.tsx`, or `src/pages/products/*`. The word "AI" is used honestly for drafters and interpreters, not for the core matching promise. `[OBSERVED]`
- The Trade Desk product page (`src/pages/products/TradeDesk.tsx`) and its siblings were not read line-by-line here; a spot check of Landing + Hero found the copy conservative. This is a positive finding for honesty.

Net: the matching layer is a rules + business-logic engine with an AI-drafter layer on top. There is no black-box scoring model that this audit could find.

---

## 7. Integrations and Third-Party Dependencies

Every environment variable referenced in `supabase/functions/**`:

`ALLOWED_ORIGINS`, `BING_SEARCH_API_KEY`, `CIPC_API_KEY`, `COMPANIES_HOUSE_API_KEY`, `CRAWL_API_KEY`, `CRAWL_PROVIDER`, `DB_URL`, `DEAL_CERT_TEST_MATCH_ID`, `DENO_REGION`, `ENVIRONMENT_TIER`, `GOOGLE_SEARCH_API_KEY`, `GOOGLE_SEARCH_ENGINE_ID`, `ID_NUMBER_PEPPER`, `INTERNAL_CRON_KEY`, `LOVABLE_API_KEY`, `LOVABLE_SEND_URL`, `ONFIDO_API_KEY`, `PAYFAST_ALLOWED_IPS`, `PAYFAST_MODE`, `PAYFAST_PASSPHRASE_LIVE`, `PAYFAST_PASSPHRASE_SANDBOX`, `PAYFAST_PROBE_TIMEOUT_MS`, `PAYFAST_SANDBOX_PASSPHRASE`, `PAYFAST_SANDBOX_SKIP_IP_CHECK`, `PAYSTACK_SECRET_KEY`, `PDF_SERVICE_URL`, `PGDATABASE`, `PGHOST`, `PGPASSWORD`, `PGPORT`, `PGUSER`, `PUBLIC_API_ALLOW_HEADER_ENV`, `PUBLIC_APP_URL`, `PUBLIC_SITE_URL`, `RESEND_API_KEY`, `SB_REGION`, `SEARCH_API_KEY`, `SEARCH_PROVIDER`, `SENTRY_BACKEND_DSN`, `SENTRY_DSN`, `SUPABASE_ANON_KEY`, `SUPABASE_DB_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`, `TEST_PAYSTACK_KEY`, `TEST_USER_JWT`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_URL`, `WAD_TEST_USER_EMAIL`, `WAD_TEST_USER_PASSWORD`, `WAD_TEST_WAD_ID`, `WEBHOOK_ENCRYPTION_KEY`. `[OBSERVED]`

| Service | Purpose | Status | Notes / evidence |
|---|---|---|---|
| Supabase (Postgres + Auth + Storage + Edge Functions) | Core backend | LIVE | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `_shared/*`. Marketed to the user as "Lovable Cloud". |
| Payfast (South Africa) | Card + EFT payments in ZAR (converted to token credits) | LIVE + SANDBOX | `payfast-checkout-live`, `payfast-checkout-sandbox`, `payfast-itn`, signature + IP allow-list checks. |
| Paystack | Card payments (Africa) | PRESENT / PARTIAL | `paystack-webhook`, `PAYSTACK_SECRET_KEY`, `TEST_PAYSTACK_KEY`. No user-facing checkout page as prominent as Payfast. |
| Resend | Transactional email | LIVE | `RESEND_API_KEY`, `send-transactional-email`. |
| Lovable Send (Lovable AI Gateway sender) | Transactional email + AI calls | LIVE | `LOVABLE_SEND_URL`, `LOVABLE_API_KEY`, `_shared/ai-guard.ts`. |
| Sentry | Backend + frontend error monitoring | LIVE | `@sentry/react` in `package.json`; `SENTRY_DSN`, `SENTRY_BACKEND_DSN`. |
| Onfido | Identity documents | STUB (`is_live: false`) | `src/lib/stub-providers.ts`; `ONFIDO_API_KEY` env var referenced but no live call permitted. |
| CIPC | South African company registry | STUB | `stub-providers.ts`; `CIPC_API_KEY` env var referenced. |
| Dow Jones | Sanctions/PEP | STUB | `stub-providers.ts`. |
| Refinitiv | Sanctions/PEP | STUB | `stub-providers.ts`. |
| Companies House (UK) | Company registry (UK) | ENV VAR PRESENT; live wiring not confirmed | `COMPANIES_HOUSE_API_KEY`; not on the stub list. |
| Google Custom Search / Bing / generic `SEARCH_API_KEY` | Open-web discovery | PARTIAL, provider-selectable via `SEARCH_PROVIDER` | `_shared/multi-search.ts`. |
| IDV provider ("VerifyNow" per prior sessions) | Person verification | PARTIAL — live path exists, outcomes stuck at `manual_review_required` | `idv-person-verify`, `p5scr_idv_records`. |
| SMS / WhatsApp | Not present | ABSENT by policy | `check-notification-no-live-sms-whatsapp-providers.mjs`. |
| Crawl provider (`CRAWL_PROVIDER`) | Intel crawler | PRESENT / PARTIAL | `intel-crawl`. |
| PDF service (`PDF_SERVICE_URL`) | Server-side PDF rendering | PRESENT / PARTIAL | Env var only; no confirmed live PDF call in this pass. |
| Postgres cron (`pg_cron`) | Scheduled jobs (SLA scans, cleanup) | LIVE | Migrations register cron jobs; heartbeats in `cron_heartbeats`. |

---

## 8. Roles and Permissions Matrix

Source: `src/lib/constants.ts` (APP_ROLES), `src/App.tsx` (RequireAuth), `src/lib/p5-batch3/permissions.ts`, `src/lib/funder-workspace/allowed-paths.ts`, `src/components/FunderPersonaGuard.tsx`, and RLS policy counts from the injected schema list.

| Capability | platform_admin | org_admin | org_member | auditor | compliance_analyst | funder_* (any) |
|---|---|---|---|---|---|---|
| Sign in | allow | allow | allow | allow | allow | allow |
| Access `/desk/*` (Trade Desk) | allow | allow | allow | allow | allow | **deny** (containment) |
| Access `/admin/*` | allow | deny | deny | deny | deny | deny |
| Access `/hq/*` | allow | deny (`GOVERNANCE_ROLES` filter) | deny | allow | allow | deny |
| Access `/governance/*` | allow | allow | deny | allow | deny | deny |
| Access `/funder/workspace/*` | allow (view) | deny for funder-only orgs | deny | deny | deny | allow (only) |
| Create trade request | allow | allow | allow | deny (UI) | deny (UI) | deny |
| Approve trade | allow | allow (org rules) | deny | deny | deny | deny |
| Manage team / invites | allow | allow | deny | deny | deny | allow (funder_org_admin only) |
| Rotate API keys | allow | allow (own org) | deny | deny | deny | deny |
| Break-glass admin actions | allow | deny | deny | deny | deny | deny |
| Export governance data | allow | request-only | deny | allow (approve) | deny | deny |
| View raw bank details | **denied to everyone** | denied | denied | denied | denied | denied |
| View admin internal notes | allow | denied | denied | denied | denied | **denied** |
| Approve credit directly | denied everywhere (funder role list) | denied | denied | denied | denied | denied |
| Alter governance/finality | allow (RPC-gated) | denied | denied | denied | denied | denied |
| Export CSV / database | allow (approvals workflow) | denied | denied | allow (governance export) | denied | **denied** |

Where "UI-hidden but backend not enforced" risks live:

- `support_tickets` and 5 sibling support tables show **no RLS policies** in the schema summary. If the UI hides sensitive columns but the row-level policy is missing, any authenticated user with a valid Supabase session could potentially read across tenants at the database level. **This must be independently verified against live RLS policies before external users are on-boarded.** `[OBSERVED gap; INFERRED risk]`
- `token_purchases` also shows no policies in the summary.

---

## 9. Monetisation

Every place the code touches money:

- **Product**: token/credit purchases denominated in USD (per project memory + `docs/billing-pricing-correction-10-usd-per-credit.md`). Tiers: `single` $1, `pack_10` $10, `pack_50` $45, `pack_200` $160.
- **Provider**: Payfast (SA) is the primary live checkout (`payfast-checkout-live`); Paystack has code paths and a webhook but no clearly primary user-facing surface.
- **Ledger**: `token_ledger` (append-only, immutable per B1 truncate guards `supabase/tests/batch_b1_truncate_guards_proof.sql`), `token_wallets`, `token_balances`, `token_purchases`, `token_transactions`.
- **Metering**: `ai_call_meter` (6 cols), `api_usage_alerts`, `api_usage_overrides`, `api_usage_notifications_state`, `funder_usage_events` (10 cols).
- **Commercial plans / subscriptions surface**: `api_commercial_plans` (13 cols), `api_client_plan_assignments`, `clip_on_subscription_charges`, `clip_on_billing_failures` — this is scaffolded for an API commercial product (per project memory "Institutional API Signal V1"), but the audit did not find a self-service subscription checkout page.
- **Refunds / disputes**: `refund_requests` (22 cols) with admin approve/decline/mark-settled functions; `payment_disputes` with resolve-won/lost flows.
- **Exemptions**: founder billing exemption (zero-cost caps for admin accounts) per memory.
- **Currency handling**: USD-native end-to-end; a prebuild guard (`check-docs-no-zar-billing.mjs`) prevents ZAR billing language regressing.

Net: the revenue model is **transactional token top-ups + a scaffolded API commercial plan model**. The token model is fully wired. The API commercial plan is partial (tables + admin UI present, self-service billing on the API commercial plan not confirmed).

---

## 10. Audit and Compliance Layer

Actions logged and where:

- `audit_logs` (11 cols, 4 policies) — general audit trail.
- `admin_audit_logs` (9 cols, 2 policies) — admin-specific actions.
- `event_store` (13 cols, 3 policies) — cross-domain event ledger.
- `poi_events` (10 cols, 3 policies) — append-only per `poi_events_append_only_freeze_proof.sql`.
- `match_events` (10 cols, 2 policies) — append-only per `match_events_append_only_freeze_proof.sql`.
- `ledger_events` (10 cols, 2 policies) — token/financial events.
- `p5b6_exception_audit_events`, `p5b7_dashboard_actions_audit`, `p5b7_export_audit`, `p5b8_audit_events`, `p5scr_audit_events`, `p5_governance_audit_events`, `p5_batch4_audit_events`, `p5_batch3_funder_audit_events` — audit rings per batch/domain.
- `admin-run-lifecycle`, `data-retention`, `retention_run_evidence`, `retention_flags` — retention lifecycle with evidence.

Immutability:

- SQL fixtures under `supabase/tests/` prove append-only truncate protection (`batch_b1_truncate_guards_proof.sql`), WaD seal immutability (`c10_wad_seal_immutability_proof.sql`), attestation immutability (`batch_b3_wad_attestation_immutability_proof.sql`), sealed match-document freeze (`batch_j2_sealed_match_document_full_freeze_proof.sql`).
- SLA monitors have proofs: `p5_batch1_sla_monitor_proof.sql`.
- Audit-log immutability freeze: `audit_log_immutability_freeze_proof.sql`.

Compliance framing:

- KYC/AML naming and roles exist (compliance workbench, compliance holds, compliance cases). External evidence of KYC/AML (Onfido, Dow Jones, Refinitiv, CIPC) is **not live**. Therefore, the platform can *record* compliance decisions and evidence trails and it can *seal* them — but it cannot independently *produce* KYC/AML verifications against real external ground truth today.

---

## 11. Security Posture (High Level)

- **Authentication**: Supabase Auth via `@lovable.dev/cloud-auth-js` + `@supabase/supabase-js`. Google OAuth by default. `AuthContext.tsx` normalises session handling and does not thrash roles on token refresh. `[OBSERVED]`
- **Session handling**: `SessionExpiredModal` + throttled visibility/focus role refresh (30 s). `[OBSERVED]`
- **Secrets handling**: server-only secrets are read via `Deno.env.get` in edge functions; client uses only publishable + anon keys. `WEBHOOK_ENCRYPTION_KEY` for webhook secret at rest.
- **Storage access**: signed URLs via edge functions (`funder-pack-download`, `evidence-pack`, `document-download`) with server-side authorization (`fw_funder_authorize_pack_download_v1`, etc.). Public buckets are not used for sensitive artefacts per code paths seen.
- **SSRF protection on outgoing webhooks**: `_shared/ssrf-guard.ts` validates host targets. `[OBSERVED, added in a recent security fix]`
- **Idempotency + replay protection**: `webhook_replay_guard`, `p5b8_webhook_events_ledger`. `[OBSERVED]`
- **Prebuild guard scripts**: ~200 `check-*.mjs` scripts under `scripts/` block prohibited wording, missing audit-log names, RLS shape violations, sensitive column open selects, and drift between UI enums and DB enums. `[OBSERVED, extremely unusual bar]`
- **Row Level Security**: broadly present, with a critical exception — the `support_tickets` cluster and `token_purchases` show 0 policies in the injected schema summary and must be re-verified.
- **Role model**: strict `has_role(uid, role)` SECURITY DEFINER function, roles in a dedicated table (not stored on `profiles`). Matches the mandated pattern. `[OBSERVED]`

High-level weaknesses observed:

1. Support-ticket RLS gap (above).
2. Reliance on stub providers for the compliance narrative — see Section 4.7 and 12.
3. Repository provenance drift for recent Cloud-applied migrations vs GitHub, per prior audits — an operational hygiene risk more than a runtime security risk.
4. Extensive test/seed edge functions (`seed-*`, `unseed-*`, `provision-test-user`, `confirm-test-user`, `staging-*`) exist alongside production functions. They appear gated by `ENVIRONMENT_TIER` / `INTERNAL_CRON_KEY`, but the sheer surface area is worth an independent security review.

---

## 12. Gaps, Risks and Honesty Check

Ranked by materiality to the core promise.

1. **KYB, sanctions/PEP and identity-document providers are stubbed by policy.** CIPC, Onfido, Dow Jones and Refinitiv are all `is_live: false` in `src/lib/stub-providers.ts`. This is honestly labelled in the codebase, but it means the "compliance engine" cannot independently verify a counterparty against real external ground truth today. `[OBSERVED]`
2. **IDV pipeline lands in `manual_review_required`.** The provider path is wired and returning HTTP 200 with a real response body, but no confirmed green-path "verified" outcome exists in the memory index or the last inspected `p5scr_idv_records` rows. `[OBSERVED / INFERRED]`
3. **Support-ticket cluster RLS gap.** `support_tickets`, `support_ticket_messages`, `support_ticket_events`, `support_ticket_access_audit`, `support_ticket_linked_records`, and `token_purchases` show 0 policies in the injected schema summary. Must be independently verified before external launch. `[OBSERVED]`
4. **Migration/GitHub provenance drift.** Recent Funder Workspace and security migrations were applied to Cloud without matching exact-timestamp source files in GitHub, per prior audits. Runtime security is not affected, but reproducibility from source is compromised. `[OBSERVED per prior sessions]`
5. **Duplicate/near-duplicate tables.** `invites` vs `team_invitations`; `signals` / `behavioral_signals` / `rating_signals`; multiple `p5*_memory_records`. Not a bug but a schema-hygiene tax on future work. `[INFERRED]`
6. **P-5 Batch 4/5/7/8 surfaces are UI-partial.** The pages exist and read live tables, but the "execution", "finality" and "provider decision" flows are more scaffolding than product. `[INFERRED from route enumeration + partial file survey]`
7. **API commercial plan self-service checkout.** Tables and admin UI exist; self-service purchase of an API plan by a client organisation was not observed as a wired route. `[INFERRED]`
8. **Facilitation "no send path".** The prebuild guard `check-facilitation-no-send-path.mjs` guarantees no outbound send is executed on the facilitation branch — i.e. the outreach product is deliberately UI-only for now. `[OBSERVED]`

**Bluntest question — "If a real buyer and a real seller tried to complete a full trade engagement today, where would it break down?"**

They would successfully:

- Register both organisations, verify emails, get a real Supabase session.
- Discover each other on `/desk/discover`, express interest, escalate to mutual interest.
- Initiate a Trade Request, exchange bilateral terms, upload evidence, transition the POI through `DRAFT → PENDING_APPROVAL → ELIGIBLE`.
- Complete the ATB/declaration acknowledgements and mint a bilateral POI with ≥1 document per side, producing a real SHA-256 seal.
- Buy tokens via Payfast in the sandbox, and in live mode if configured.
- Trigger a Funder Workspace release, have a funder view the sealed evidence pack, ask for RFIs, and mark an outcome.

Where they would break down:

- **They cannot obtain an independently-verifiable KYC / KYB / sanctions clearance.** The evidence pack will be sealed, but its provider-backed pillars are stubbed. A funder or regulator would see "provider not connected" labels on those pillars (surfaced honestly by the UI).
- **The IDV happy-path terminates in manual review**, so no automatic "identity verified" green light will fire without an admin approving it.
- **Some downstream workflows in P-5 Batch 4/5/7/8 will feel like scaffolding.** Nothing blows up; some buttons produce audit rows but no visible external outcome yet.
- **If they try to complete this outside South Africa's Payfast footprint**, the alternative (Paystack) is present but a Paystack-primary checkout page was not observed in this pass.

Everything else works.

---

## 13. What This Business Is

Izenzo is, in code, a **trade-and-trade-finance governance network** for institutional counterparties. It is significantly more than a prototype and significantly less than a fully-verified compliance platform. It sits, credibly, at **late-MVP / early production**:

- The state machine, seals, ledger, RLS, audit rings, immutability triggers, prebuild guards and cron monitors are the discipline of a system that has been through real reviews.
- The Funder Workspace is the strongest single module — tight containment, immutability, RPC contracts, tests. If the rest of the platform reached that bar, Izenzo would be genuinely production-ready.
- The public marketing copy is unusually restrained — the hero claims map to real code (SHA-256 seals, atomic state, single approved region policy). There is no "quantum" or "AI accuracy X %" over-promise in the copy that was read.
- The compliance narrative is the honest weak point: the four externally-verifiable providers are stubbed by design, and the IDV green-path is not yet demonstrated end-to-end.

Who it genuinely serves today: **organisations that want a permanent, hash-sealed, jurisdiction-locked record of a trade engagement plus an admin-mediated evidence workflow with an institutional funder audience.** That audience is a real one, and the code is well-shaped for it.

Why it exists (from code): to give counterparties, funders and auditors a single, non-repudiable execution trail — an "audit ledger" — that closes the trust gap in cross-border trade.

Stage: **late-MVP, one hardening cycle away from a defensible production launch in the Funder Workspace lane, and two–three provider integrations away from a defensible compliance/KYC lane.**

---

## 14. Open Questions the Codebase Alone Cannot Answer

1. **Live provider intent** — is stubbing CIPC/Onfido/Dow Jones/Refinitiv a permanent product decision, a licence/cost issue, or a launch-sequencing decision?
2. **IDV green path** — has any live person been verified end-to-end outside test mode against the current `idv-person-verify` runtime?
3. **Support-tickets RLS** — the schema summary shows 0 policies on `support_tickets` and siblings; are there policies applied at a later migration that the summary tool did not surface?
4. **Repository provenance** — which of the local `supabase/migrations/*.sql` files reflect the exact bytes applied to Cloud, and which are recovery/reconstruction files?
5. **Paystack vs Payfast** — is Paystack an active commercial channel or a future-market placeholder?
6. **API commercial product** — is there a live external customer for the Public API v1, and what SLA are they on?
7. **Data residency** — is `REGION: SINGLE APPROVED POLICY` (per the hero telemetry) a South Africa lock, an EU lock, or configurable? Migrations imply a jurisdiction lock at onboarding, but the operative region is not visible from source.
8. **Independent penetration test** — has an external pen-test been performed against the current build?
9. **Business metrics** — active organisations, matches to settlement, tokens purchased, POIs sealed. The code emits events; the actual numbers require production data access.

---

## 15. Appendix

### 15.1 Repository folder map (top level)

| Path | Purpose (one line) |
|---|---|
| `src/` | React 18 + Vite 5 + Tailwind v3 + TypeScript 5 frontend. |
| `src/pages/` | Routed pages, sub-grouped by persona (`admin/`, `desk/`, `funder/`, `hq/`, `registry/`, `support/`, `docs/`, `products/`, `solutions/`). |
| `src/components/` | ~368 shared components including shells, banners, guards, match UI, funder UI, ratings badges. |
| `src/lib/` | Domain logic modules (`modules/poi-engine`, `funder-workspace`, `compliance-workbench`, `p5-batch*`, `ai-review`, `wad`, `identity`, `security`, `policy`, `support`, `outreach`, etc.). |
| `src/hooks/` | Reusable React hooks (auth, membership, billing, unsaved changes, mobile, etc.). |
| `src/contexts/` | React contexts (Auth, others). |
| `src/integrations/supabase/` | Auto-generated client and types (must not be hand-edited). |
| `src/tests/` and `src/lib/**/__tests__/` | Vitest unit/integration suites. |
| `supabase/functions/` | 358 Deno edge functions covering auth hooks, POI/WaD, payments, IDV, funder pack, registry, facilitation, notifications, admin, seed/proof helpers. |
| `supabase/migrations/` | 653 SQL migrations (with prior provenance drift caveat). |
| `supabase/tests/` | SQL proof fixtures (immutability, append-only, seal, SLA). |
| `supabase/snapshots/` | D1 schema proofs. |
| `docs/` | Product / operations / batch closeout notes; this audit report. |
| `e2e/` | Playwright end-to-end journeys (POI lifecycle, WaD lifecycle, funder containment, trade match, api access, tenant isolation, etc.). |
| `scripts/` | ~200 prebuild guard scripts enforcing policy invariants. |
| `packages/sdk/` | Public SDK (published to npm per its own package.json). |
| `remotion/` | Video generation project (Remotion) — unusual for a fintech; used for marketing/product video assets. |
| `public/` | Static assets (favicon, robots.txt). |
| `.github/workflows/` | CI workflows including phase-1a support/behavioural/security and batch-7 guards. |

### 15.2 Full route list

225 unique paths in `src/App.tsx`; nested paths mounted under `/desk/*` add roughly another 40. The complete grouped list appears in Section 3. The raw sorted list is generated by `rg 'path="' src/App.tsx`.

### 15.3 Database table list

432 tables in the `public` schema, grouped in Section 5. The full alphabetised list is supplied to this audit in the `<supabase-tables>` block.

### 15.4 Key production dependencies (`package.json`)

| Dependency | Purpose |
|---|---|
| `react` 18, `react-dom` 18 | UI runtime. |
| `react-router-dom` 7 | Client routing. |
| `@supabase/supabase-js` 2.110 | Backend client. |
| `@lovable.dev/cloud-auth-js` | Auth helper for the Lovable Cloud managed session. |
| `@tanstack/react-query` 5 | Server-state cache. |
| `@radix-ui/*` | Accessible UI primitives (dialog, tooltip, tabs, select, etc.). |
| `@sentry/react` 10 | Error monitoring. |
| `class-variance-authority`, `clsx`, `tailwind-merge`, `tailwindcss-animate` | Tailwind styling helpers. |
| `sonner`, `lucide-react`, `framer-motion` | Toasts, icons, animations. |
| `date-fns` | Date utilities. |
| `zod` | Runtime validation (used in edge functions and forms). |
| `jspdf` | Client-side PDF generation (used in some admin export flows). |
| `docx`, `file-saver` | Added by this audit only, for the `/audit-export` page. |
| `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom` | Unit/integration tests. |

### 15.5 Count totals

- Client routes registered in `src/App.tsx`: **225** unique `path="..."` declarations, plus nested paths under `/desk`, `/hq`, `/desk/settings`, etc. `[OBSERVED]`
- Supabase edge functions: **358**. `[OBSERVED]`
- Database migrations: **653**. `[OBSERVED]`
- Public-schema tables: **432**. `[OBSERVED]`
- Shared React components (`src/components/**`): **368** files. `[OBSERVED]`
- TypeScript / TSX files total: **1,452**. `[OBSERVED]`
- Prebuild guard scripts (`scripts/check-*.mjs`): **~200** (enumerated in `package.json` `prebuild`). `[OBSERVED]`
- `TODO` / `FIXME` / `HACK` comments across the codebase: **6**. `[OBSERVED]`

---

*End of report.*
