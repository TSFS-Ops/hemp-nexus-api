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
**Status:** TODO

1. Review WaD edge function and stepper UI
2. Verify SHA-256 sealing
3. Test certificate generation
4. Access control (involved parties + platform_admin only)

---

### Phase 5: Billing (Token Burn + Paystack)
**Status:** TODO

1. Verify token-purchase + webhook
2. Verify token burn at each state transition
3. Clean billing UI
4. Ensure idempotency

---

### Phase 6: Developer Console
**Status:** TODO

1. API key management (create, revoke, rotate)
2. Webhook management
3. Log views (audit + API request)
4. API documentation
5. SDK examples

---

### Phase 7: Admin Panel
**Status:** TODO

1. Consolidate ~12 admin components into tabbed dashboard
2. User/org management
3. System analytics + health
4. Licence management

---

### Phase 8: Public Site + Sandbox
**Status:** TODO

1. Landing page
2. PublicSearch with demo data
3. Sandbox mode for API testing
4. Pricing page

---

### Phase 9: Enterprise Hardening
**Status:** TODO

1. Audit all RLS policies
2. Consistent auth/validation across all edge functions
3. Health monitoring
4. Data retention policies
5. PII access via Edge Functions only
6. Security scan — resolve all findings

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
