# Izenzo Platform — Enterprise-Grade Rebuild Plan

> **Last updated:** 2026-02-13
> **Status:** PLANNING — awaiting user approval before execution

---

## 1. Product Definition

**Izenzo** is a compliance-matching API and web platform for regulated B2B trade.
It produces tamper-evident, legally admissible proof records:

- **POI** (Proof of Intent) — records that a party declared intent to trade
- **WaD** (Without a Doubt) — sealed evidence bundle for legal proceedings

**Core flow:** Register org → Post signal → System matches → Invite counterparty → Confirm intent → Generate POI → Seal WaD

**Not a trading platform.** No payments, contracts, or financial obligations are created. Information-only, proof-of-intent.

---

## 2. Architecture Decisions

| Decision | Choice |
|---|---|
| Frontend | React + Vite + Tailwind + TypeScript |
| Backend | Lovable Cloud (Supabase) Edge Functions |
| Billing | Token burn model via Paystack (ZAR) |
| Domains | `www.izenzo.co.za` (public) + `api.trade.izenzo.co.za` (console) |
| Auth | Email/password (Supabase Auth), no auto-confirm |
| Roles | `platform_admin`, `org_admin`, `org_member`, `anonymous` |
| Enterprise | Audit trail, SOC2-ready, multi-tenant isolation, monitoring |

---

## 3. Role Permissions Matrix

| Capability | `anonymous` | `org_member` | `org_admin` | `platform_admin` |
|---|---|---|---|---|
| View public search (demo) | ✅ | ✅ | ✅ | ✅ |
| Register / sign in | ✅ | — | — | — |
| Post signals | ❌ | ✅ | ✅ | ✅ |
| Search counterparties | ❌ | ✅ | ✅ | ✅ |
| Confirm intent (POI) | ❌ | ✅ | ✅ | ✅ |
| Upload documents | ❌ | ✅ | ✅ | ✅ |
| View own org's matches | ❌ | ✅ | ✅ | ✅ |
| View own org's audit logs | ❌ | ✅ | ✅ | ✅ |
| Manage API keys + webhooks | ❌ | ❌ | ✅ | ✅ |
| Invite/remove org members | ❌ | ❌ | ✅ | ✅ |
| View billing + purchase credits | ❌ | ❌ | ✅ | ✅ |
| View all orgs / users | ❌ | ❌ | ❌ | ✅ |
| Manage licences | ❌ | ❌ | ❌ | ✅ |
| View system-wide analytics | ❌ | ❌ | ❌ | ✅ |
| Manage platform settings | ❌ | ❌ | ❌ | ✅ |

---

## 4. Phased Rebuild

### Phase 1: Foundation (Schema + Auth + Roles)
**Status:** DONE ✅

**Goal:** Clean database schema, expanded role system, hardened auth.

1. Expand `app_role` enum: add `platform_admin`, `org_admin`, `org_member`
2. Migrate existing `admin` → `platform_admin`, `buyer` → `org_member`
3. Update `handle_new_user()` trigger: new users get `org_member` role
4. Add `is_org_admin()` check function for org-level administration
5. Review and tighten all RLS policies for new role structure
6. Update `AuthContext` to expose granular role info

---

### Phase 2: Core Flow (Signals → Match → POI)
**Status:** DONE ✅

**Goal:** Clean, tested implementation of the happy path.

1. Consolidate signal creation
2. Clean up search edge function
3. Streamline match creation flow (Start POI → upload docs → Confirm Intent)
4. Verify hash-chaining
5. Clean up match edge function
6. Consolidate match detail view

---

### Phase 3: Invites + Counterparty Flow
**Status:** DONE ✅

1. ✅ Simplified invite edge function (Zod validation, actor-context, deduplicated helpers)
2. ✅ Cleaned invite UI (migrated to sonner, added aria-labels, explicit HTTP methods)
3. ✅ Invite state transitions verified (pending → accepted/declined with audit trail)
4. ✅ Audit logs written with actor_user_id/actor_api_key_id for all invite actions

---

### Phase 4: WaD Evidence Bundles
**Status:** DONE ✅

1. ✅ Refactored WaD edge function (Zod validation, deriveActorIds, admin role check includes platform_admin, parallel DB queries)
2. ✅ Verified SHA-256 sealing (canonical payload → deterministic hash → ledger chain)
3. ✅ Certificate generation verified (JSON cert with seal hash, attestations, evidence bundle hash)
4. ✅ Access control enforced (involved parties + platform_admin only, admin access logged)
5. ✅ UI cleaned (explicit HTTP methods on all fetch calls)

---

### Phase 5: Billing (Token Burn + Paystack)
**Status:** DONE ✅

1. ✅ Token-purchase edge function: Added Zod validation, fixed `price_usd` → `price_zar` metadata inconsistency
2. ✅ Token burn verified at each state transition (declare_intent: 500, counterparty_sighting: 1500, commit: 1000+finality)
3. ✅ Billing UI cleaned: aligned `minimumRequired` default with database, correct ZAR pricing
4. ✅ Idempotency enforced via `token_ledger.request_id` check in both webhook and verify paths
5. ✅ HMAC SHA-512 signature verification on Paystack webhooks
6. ✅ Dual-path reliability: webhook handler + client-side `/verify` fallback

---

### Phase 6: Developer Console
**Status:** DONE ✅

1. ✅ API key management: Fixed auth — JWT users can manage keys without scope check; API-key callers need `api_keys` scope. Integrated `deriveActorIds` for consistent actor tracking. Added `request_id` to audit metadata.
2. ✅ Webhook management: Already standardised with Zod validation, audit logging, and encrypted secret storage.
3. ✅ Log views: Fixed audit-logs — JWT/console users no longer burn tokens viewing their own logs (only API-key callers are metered). Dual-tab UI (Activity/Proof Events + API Request Logs) verified.
4. ✅ API documentation: DocsSection with overview, key concepts, base URL, and quick example in place.
5. ✅ SDK examples: SdkDocumentation component available in console sidebar.
6. ✅ Dashboard.tsx: Migrated from legacy `useToast` to `sonner` for notification consistency.

---

### Phase 7: Admin Panel
**Status:** DONE ✅

1. ✅ Reorganised AdminSidebar into 5 logical groups (Overview, Core Data, Analytics, Audit & Logs, Management)
2. ✅ Migrated AdminSettings from legacy `useToast` to `sonner`
3. ✅ Migrated AdminRiskPanel from legacy `useToast` to `sonner`
4. ✅ Fixed AdminOverview: replaced `<a>` tags with React Router `<Link>`, parallelised stat queries with `Promise.all`
5. ✅ All 16 admin sub-panels verified: consistent sonner notifications, proper React Router navigation, TanStack Query for data fetching

---

### Phase 8: Public Site + Sandbox
**Status:** DONE ✅

1. ✅ Landing page: Fixed API example URL (→ api.trade.izenzo.co.za), verified cross-domain auth links, mobile nav, "How it works" flow
2. ✅ PublicSearch: Verified demo-only data (zero DB writes), fixed hardcoded white/black colours → semantic tokens (bg-card, border-muted-foreground)
3. ✅ Sandbox mode: SandboxIndicator generates sample signals/matches via edge functions, isolated per-org
4. ✅ Pricing page: Fixed currency label ("All prices in ZAR"), verified 3-tier ZAR pricing (R1,799 / R6,299 / R26,999), VAT notice

---

### Phase 9: Enterprise Hardening
**Status:** DONE ✅

1. ✅ Security scan: 13 findings reviewed — 2 error, 7 warn, 4 info. All triaged with justifications.
2. ✅ Created `webhook_endpoints_safe` view (excludes `secret_hash`, `security_invoker=true`) — resolves webhook secret exposure finding
3. ✅ RLS audit: All tables have appropriate policies. `profiles_safe`/`api_keys_safe`/`match_evidence` views use `security_invoker=true`
4. ✅ Edge function standardization: Migrated `calculate-reputation`, `web-search`, `sr-discover` from legacy `serve()` to `Deno.serve()`
5. ✅ All edge functions use consistent auth (`authenticateRequest`), Zod validation, `errorResponse`, and `deriveActorIds`
6. ✅ Leaked password protection warning documented (requires auth settings change, not code)

---

### Phase 10: Code Cleanup + Documentation
**Status:** TODO

1. Delete unused components
2. Consolidate test suites
3. Update CHANGELOG.md + API docs
4. Final edge function review

---

## 5. Component Consolidation Target

**Current:** ~80+ components → **Target:** ~45

Key merges:
- `ApiSmokeTests` + `AutomatedTestSuite` + `ComprehensiveApiTests` → `TestSuite`
- `SystemHealthMonitor` + `ErrorMonitoringDashboard` → `HealthDashboard`
- `ApiDocs` + `SdkDocumentation` + `GettingStartedGuide` → `Documentation`
- `DemoModeBanner` + `SandboxIndicator` → `EnvironmentIndicator`
- 12+ admin panels → tabbed `AdminDashboard`

---

## 6. Edge Function Consolidation

**Current:** 25+ → **Target:** ~18

**Merge/remove:**
- `admin-lookup-profiles` + `admin-users` → single `admin` function
- `run-tests` → remove (not for production)
- `sr-discover` → merge into `search`

---

## 7. Success Criteria

- [ ] All 4 roles work with correct permissions
- [ ] Core flow (signal → match → POI → WaD) end-to-end tested
- [ ] Token billing works (purchase + burn)
- [ ] No cross-org data leakage
- [ ] Consistent auth/validation in all edge functions
- [ ] Security scan passes with no critical findings
- [ ] Codebase under 50 focused components
- [ ] Documentation accurate and up-to-date
