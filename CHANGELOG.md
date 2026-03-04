# Changelog

All notable changes to the Compliance Matching API are documented here.

**Last updated:** 4 March 2026

---

## [3.0.0-sprint8] - 2026-03-04

### SDK V3 Extension & Integration Tests

**Focus: Extend the TypeScript SDK with all V3 deal-pipeline resources and add comprehensive contract tests.**

#### SDK Extension (`izenzo-sdk.ts`)
- **[Entities]** `client.entities.create()`, `.list()`, `.update()`, `.screen()` — full CRUD + screening stub
- **[Authority]** `client.authority.createUbo()`, `.createAtb()`, `.checkGates()` — ATB/UBO management with gate validation
- **[Trade Approvals]** `client.tradeApprovals.getStatus()`, `.issue()`, `.revoke()` — approval lifecycle
- **[PoDs]** `client.pods.create()`, `.list()`, `.completeMilestone()`, `.recordBreach()`, `.finalise()` — delivery tracking with idempotency
- **[Compliance]** `client.complianceCases.open()`, `.list()`, `.decide()` — compliance case lifecycle

#### Integration Tests (`v3-deal-pipeline.test.ts`)
- 11 contract tests covering all V3 SDK resources
- Validates request shapes (methods, headers, body), response parsing, and type safety
- Tests idempotency key propagation for PoD creation

## [3.0.0-sprint9] - 2026-03-04

### OpenAPI V3 Completion & SDK Documentation

**Focus: Complete API documentation with all V3 paths and update SDK examples for the deal pipeline.**

#### OpenAPI Spec (`public/openapi.yaml`)
- **[Authority]** Added `/authority-bind` (POST + GET) — UBO/ATB CRUD with gate-check action
- **[Trade Approvals]** Added `/trade-approval` (POST) — issue/revoke/renew actions
- **[Trade Status]** Added `/trade-status` (GET) — public approval status endpoint
- **[Due Diligence]** Added `/due-diligence` (POST) — multi-action KYC lifecycle
- **[Schemas]** Added `TradeStatus` response schema
- **[Tags]** Added Authority, Trade Approvals, Due Diligence tag groups
- **[Version]** Bumped spec version to 2.0.0

#### SDK Documentation (`SdkDocumentation.tsx`)
- **[V3 Pipeline Tab]** New "V3 Pipeline" code example tab with 6-step deal flow (Entity → UBO → ATB → Trade → PoD → Finalise)
- **[Webhook Events]** Added 8 V3 webhook events (entity.created, wad.issued, pod.finalised, breach.detected, etc.)
- **[Design Tokens]** Fixed hardcoded color classes → semantic tokens (text-primary, text-destructive)

## Versioning

This project follows semantic versioning: `MAJOR.MINOR.PATCH`
- **MAJOR**: Breaking changes
- **MINOR**: New features (backwards compatible)
- **PATCH**: Bug fixes (backwards compatible)

---

## [2.0.0] - 2026-02-13

### Enterprise-Grade Rebuild (Phases 1–10)

**Focus: Complete platform rebuild for production readiness — schema, auth, billing, security, and code quality.**

#### Phase 1: Foundation (Schema + Auth + Roles)
- **[Auth]** Expanded `app_role` enum: `platform_admin`, `org_admin`, `org_member`
- **[Auth]** Migrated legacy roles (`admin` → `platform_admin`, `buyer` → `org_member`)
- **[Auth]** Updated `handle_new_user()` trigger for new role structure
- **[Auth]** Added `is_org_admin()` check function
- **[Security]** Tightened all RLS policies for granular role structure
- **[Auth]** Updated `AuthContext` to expose role info

#### Phase 2: Core Flow (Signals → Match → POI)
- **[API]** Consolidated signal creation and search edge functions
- **[API]** Streamlined match creation flow (Start POI → upload docs → Confirm Intent)
- **[Security]** Verified SHA-256 hash-chaining integrity
- **[UI]** Consolidated match detail view

#### Phase 3: Invites + Counterparty Flow
- **[API]** Simplified invite edge function with Zod validation and `actor-context`
- **[UI]** Migrated invite UI from legacy `useToast` to `sonner`
- **[Audit]** Invite state transitions logged with `actor_user_id`/`actor_api_key_id`

#### Phase 4: WaD Evidence Bundles
- **[API]** Refactored WaD edge function (Zod, `deriveActorIds`, parallel DB queries)
- **[Security]** SHA-256 sealing verified (canonical payload → deterministic hash → ledger chain)
- **[Security]** Access control enforced (involved parties + `platform_admin` only)

#### Phase 5: Billing (Token Burn + Paystack)
- **[Billing]** Token-purchase edge function with Zod validation
- **[Billing]** Token burn at each state transition (declare: 500, sighting: 1500, commit: 1000+finality)
- **[Billing]** ZAR pricing aligned across UI and metadata
- **[Security]** HMAC SHA-512 verification on Paystack webhooks
- **[Billing]** Dual-path reliability: webhook + client-side `/verify` fallback

#### Phase 6: Developer Console
- **[API]** Fixed API key auth — JWT users manage keys without scope check
- **[API]** Fixed audit-logs — console users no longer burn tokens viewing logs
- **[UI]** Dashboard migrated from legacy `useToast` to `sonner`
- **[Docs]** DocsSection with overview, key concepts, and quick examples

#### Phase 7: Admin Panel
- **[Admin]** Reorganised sidebar into 5 logical groups
- **[Admin]** Migrated all 16 sub-panels to `sonner` notifications
- **[Admin]** Parallelised stat queries with `Promise.all`
- **[Admin]** Replaced `<a>` tags with React Router `<Link>`

#### Phase 8: Public Site + Sandbox
- **[UI]** Fixed API example URL on landing page
- **[UI]** Fixed currency label on pricing page (ZAR, not USD)
- **[UI]** Migrated `PublicSearch` from hardcoded colours to semantic tokens
- **[Sandbox]** Verified demo-only data with zero DB writes

#### Phase 9: Enterprise Hardening
- **[Security]** Created `webhook_endpoints_safe` view (excludes `secret_hash`)
- **[Security]** All views use `security_invoker = true`
- **[API]** Migrated `calculate-reputation`, `web-search`, `sr-discover` to `Deno.serve()`
- **[API]** All edge functions standardised: `authenticateRequest`, Zod, `errorResponse`, `deriveActorIds`
- **[Security]** 13 security findings reviewed and triaged

#### Phase 10: Code Cleanup
- **[Cleanup]** Deleted 13 unused components (SignalTester, MatchTester, ApiAnalytics, TransactionStateIndicator, ReputationBadge, ApiSmokeTests, EmbeddableWidget, WebhookDebugger, HashVerifier, CronSetupInstructions, SystemHealthMonitor, AutomatedTestSuite, ErrorMonitoringDashboard)
- **[Cleanup]** Removed `run-tests` edge function (not for production)
- **[Cleanup]** Removed 8 unreachable Dashboard sections
- **[Docs]** Updated CHANGELOG with full rebuild history

#### Breaking Changes
- Role enum values changed (`admin` → `platform_admin`, `buyer` → `org_member`)
- `run-tests` edge function removed
- Several UI components removed (not user-facing)

---

## [1.6.0] - 2026-01-24

### Phase 2: Documents & WaD Module

**Focus: Evidence-grade document management and sealed proof bundles.**

#### New Features - Documents Module
- **[Documents]** Document upload with type, title, visibility, and notes
- **[Documents]** Private storage bucket with signed URL access only
- **[Documents]** Document access logging in `document_access_logs` table
- **[Documents]** Document sharing controls (private, counterparty, role-based)
- **[Documents]** Document versioning and superseding support
- **[Documents]** Evidence pack includes document metadata and access history

#### New Features - WaD (Without-a-Doubt) Module
- **[WaD]** Sealed evidence bundle creation from settled POI
- **[WaD]** Multi-step attestation: Summary → Evidence → Signatories → Review → Certificate
- **[WaD]** Party attestation with explicit disclaimer checkbox and typed name
- **[WaD]** SHA-256 seal hash and ledger entry hash for tamper evidence
- **[WaD]** JSON certificate download with full evidence bundle
- **[WaD]** Admin WaD panel with revocation (requires reason)
- **[WaD]** Admin access logging with mandatory reason for sensitive downloads
- **[WaD]** Status lifecycle: draft → awaiting_attestations → sealed → revoked

#### Logging Improvements
- **[Logging]** `intent.confirmed` logged in audit_logs with hash
- **[Logging]** WaD events: wad.created, wad.attested, wad.sealed, wad.downloaded, wad.revoked
- **[Logging]** Admin access events: admin.wad.accessed, admin.wad.certificate.downloaded
- **[Logging]** Document events: document.uploaded, document.downloaded, document.shared

#### Security
- **[Security]** All views use `security_invoker = true` (no SECURITY DEFINER bypasses)
- **[Security]** Storage bucket `match-documents` is private
- **[Security]** Admin certificate downloads require access reason
- **[Security]** Hostname routing blocks console-only routes on public domain
- **[Security]** RLS policies enforce party-only access to WaDs and documents

#### Admin Panel
- **[Admin]** Phase 2 Verification checklist page
- **[Admin]** WaD Management panel with filter, revoke, and download
- **[Admin]** Document verification panel

#### Documentation
- **[Docs]** Updated README with Documents and WaD sections
- **[Docs]** Changelog updated with Phase 2 changes

#### Bug Fixes
- **[Fix]** Admin.tsx build error (missing Route tag)

---

## [1.5.0] - 2026-01-11

### New Year Hardening & Refactor Pass

**Focus: Engineering quality, code consistency, and production readiness.**

#### Architecture Improvements
- **[Refactor]** Created centralised `actor-context.ts` utility for deriving actor IDs
- **[Refactor]** Fixed `validateInput` to throw `ApiException` instead of generic `Error`
- **[Refactor]** Standardised actor ID handling across all edge functions
- **[Refactor]** Consolidated UUID validation to prevent empty string errors

#### Documentation
- **[Docs]** Updated all documentation to British English spelling
- **[Docs]** Updated changelog with comprehensive history
- **[Docs]** Fixed API header documentation (`X-API-Key` vs `Authorization`)
- **[Docs]** Added last updated dates to all documentation

#### Bug Fixes
- **[Fix]** Resolved UUID validation errors in audit log inserts
- **[Fix]** Fixed onboarding wizard API base URL configuration
- **[Fix]** Corrected token metering `api_key_id` null handling
- **[Fix]** Fixed match events actor ID derivation

#### Security
- **[Security]** All endpoints properly validate input with Zod schemas
- **[Security]** RLS policies reviewed and confirmed secure
- **[Security]** API key authentication uses proper header (`X-API-Key`)

---

## [1.4.0] - 2025-12-06

### Demo Mode & Public Access

**Focus: Enable frictionless developer evaluation whilst protecting production actions.**

#### New Features
- **[Demo]** Public demo mode allows exploration without login
- **[Demo]** Sandbox search with simulated counterparty results
- **[Demo]** Demo intent confirmation with sample evidence preview
- **[Demo]** Clear "Sandbox" indicators throughout UI
- **[Auth]** Login-protected sections: API Keys, Matches, Analytics, Webhooks

#### UI Redesign
- **[UI]** Enterprise-grade styling with Manrope font
- **[UI]** Neutral colour palette replacing template components
- **[UI]** Custom Tailwind-based components throughout
- **[UI]** Redesigned landing page with developer-focused copy
- **[UI]** Improved Demo page with clean result cards

#### Documentation Updates
- **[Docs]** Updated all documentation timestamps
- **[Docs]** Improved getting-started guide clarity
- **[Docs]** Updated product guide with demo mode information

#### Security
- **[Security]** Demo mode data never writes to production tables
- **[Security]** Authentication enforced for all write operations
- **[Security]** Admin panel remains login + admin-only

---

## [1.3.2] - 2025-12-03

### SDK & Developer Experience Improvements

**Focus: Make integration easier for developers.**

#### New Features
- **[SDK]** Added TypeScript SDK client (`src/lib/izenzo-sdk.ts`)
  - Full type definitions for all API responses
  - Resource-based API (`client.matches.create()`, `client.signals.list()`, etc.)
  - Built-in error handling with `IzenzoApiError` class
  - Timeout and retry support
- **[OpenAPI]** Added OpenAPI 3.1 specification (`public/openapi.yaml`)
  - Machine-readable API spec for code generation
  - Compatible with Swagger UI, Redoc, and other tools
  - Includes all endpoints, schemas, and examples
- **[Docs]** Added SDK Documentation page in dashboard
  - Code examples in TypeScript, Python, and cURL
  - Webhook integration guide with signature verification
  - Error handling patterns

#### Developer Experience
- **[Navigation]** Added "SDK & Integration" section to dashboard sidebar
- **[Download]** OpenAPI spec available at `/openapi.yaml`
- **[Examples]** Added webhook payload examples and verification code

---

## [1.3.1] - 2025-12-03

### Security Audit & Fixes

**Full end-to-end audit completed.** This patch addresses security, documentation, and SOW alignment.

#### Security Improvements
- **[Security]** Restricted `api_request_logs` to admin/auditor roles only (previously org-wide access)
- **[Security]** Restricted `reputation_scores` to own-org access only (previously all authenticated users)
- **[Security]** Removed general user access to `audit_logs` (admin-only for security)
- **[Database]** Added documentation comment to `behavioral_signals` table clarifying non-binding nature

#### Admin Panel SOW Alignment
- **[Admin]** Added Coherence Engine panel (`/admin/coherence`) - displays vector matching metrics
- **[Admin]** Added Behavioral Analytics panel (`/admin/behavioral`) - tracks non-binding actions
- **[Admin]** Added Audit Logs panel (`/admin/audit`) - binding actions + admin operations
- **[Admin]** Updated sidebar navigation with new panels
- **[Admin]** Updated overview quick actions grid

#### Documentation Updates
- **[Docs]** Updated API version to 1.3 with changelog
- **[Docs]** Fixed "settle" language → "Confirm Intent" in ApiDocs.tsx
- **[Docs]** Added `intent.confirmed` event documentation
- **[Docs]** Created SOW alignment document (`docs/sow-alignment.md`)

#### UI/UX Polish
- **[UI]** Added explanatory Alert to Confirm Intent endpoint in API docs
- **[UI]** Updated webhook event list to show `intent.confirmed`

---

## [1.3.0] - 2025-12-03

### ⚠️ Terminology Update: "Settle" → "Confirm Intent"

This release updates all terminology to clearly distinguish between **binding intent confirmation** and **non-binding exploration**.

#### Key Changes

| Before | After |
|--------|-------|
| "Settle Match" | "Confirm Intent" |
| "Settlement" | "Intent Confirmation" |
| "Settled" status | "Confirmed" (display only, DB still uses `settled`) |

#### What Creates Records?

| Action | Creates Audit/Evidence? |
|--------|------------------------|
| **Confirm Intent** | ✅ Yes - immutable proof of interest |
| Skip / Not Now | ❌ No - exploration only |
| Maybe Later | ❌ No - exploration only |
| View / Browse | ❌ No - exploration only |

#### Important Notes

- **No legal obligation**: "Confirm Intent" signals serious interest so the seller can prepare final terms. It does NOT create any contract, payment, or legal commitment.
- **Only Confirm creates records**: All other UI options (skip, maybe later, etc.) are soft behavioral signals that do NOT write to the database.
- **Backward compatible**: The API endpoint remains `/match/:id/settle` for compatibility, but now triggers `intent.confirmed` webhook event (also `match.settled` for legacy support).

### API Changes
- **[API]** `POST /match/:id/settle` now logs as `intent.confirmed` action
- **[API]** New webhook event: `intent.confirmed` (in addition to legacy `match.settled`)
- **[API]** Enhanced audit log metadata includes explicit note about non-binding nature

### UI Changes
- **[UI]** Replaced all "Settle" buttons with "Confirm Intent"
- **[UI]** Added explanatory text to all Confirm Intent buttons
- **[UI]** Status badge now shows "Confirmed" instead of "Settled"
- **[UI]** Webhook event type now shows "Intent Confirmed" in management UI
- **[UI]** API tester shows clear explanation of what Confirm Intent means
- **[UI]** Smoke tests renamed to reflect new terminology

### Documentation
- **[Docs]** Updated API reference with clear action type table
- **[Docs]** Added "Action Types: Confirm vs. Exploration" section
- **[Docs]** Updated webhook examples with new event names
- **[Docs]** Clarified that only Confirm creates evidence records

---

## [1.2.0] - 2025-12-02

### Security Enhancements
- **[Security]** Added RLS protection to `match_evidence` view via security definer function
- **[Security]** Fixed function search paths to prevent SQL injection vectors
- **[Security]** Enhanced input validation with Zod schemas on Marketplace page
- **[Security]** Added authentication guards to Analytics and Marketplace pages

### New Features
- **[API]** Evidence Pack endpoint (`GET /evidence-pack/:matchId`) for compliance proof generation
- **[API]** Enhanced health check with 7 system component checks
- **[API]** Signal status endpoint (`GET /signals/:id/status`) for search progress tracking
- **[UI]** Bulk actions for user management (activate, suspend, export)
- **[UI]** Loading states added to protected pages

### Improvements
- **[API]** Improved error messages with request IDs for debugging
- **[Docs]** Complete API reference rewrite with all endpoints documented
- **[Docs]** Added "How to Test" guide with comprehensive examples
- **[UI]** Form validation with real-time error feedback

### Bug Fixes
- **[Auth]** Fixed redirect handling after authentication
- **[UI]** Fixed loading state flickering on page transitions

---

## [1.1.0] - 2025-11-20

### Admin Panel
- **[Admin]** Created admin panel with Users and Organizations management
- **[Admin]** Added ability to view all users across organizations
- **[Admin]** Added ability to update organization status and SAHPRA license numbers
- **[Admin]** Implemented role-based access control (admin only)
- **[Admin]** Added navigation from Dashboard to Admin panel

### Automation Features
- **[Automation]** Implemented automated webhook retry system with exponential backoff
- **[Automation]** Created `/webhook-retry` edge function for background processing
- **[Automation]** Retry schedule: 5 min, 30 min, 2 hours (configurable)
- **[Automation]** Added dead letter queue for exhausted retries
- **[Automation]** Database fields: `next_retry_at`, `max_retries`, `is_dead_letter`

### API Key Expiry
- **[Automation]** Created `/api-key-expiry` edge function for automated expiry management
- **[Automation]** Implemented 7-day warning system before expiry
- **[Automation]** Automatic key disabling on expiration date
- **[Database]** Added `expires_at` and `expiry_warning_sent` fields to api_keys table
- **[Audit]** All expiry events logged in audit_logs

### Documentation
- **[Docs]** Created comprehensive cron setup guide (`docs/cron-setup.md`)
- **[UI]** Added interactive `CronSetupInstructions` component
- **[UI]** New "Automation" tab in Dashboard with copy-paste SQL scripts
- **[Docs]** Documented pg_cron and pg_net extension setup

### UI Enhancements
- **[UI]** Added expiry date display on API key cards
- **[UI]** Implemented warning indicator for keys expiring within 7 days
- **[UI]** Added expiry selection dropdown during key creation
- **[UI]** Enhanced key metadata display with better layout

### Security
- **[Security]** Tightened profiles RLS policies (org-scoped access only)
- **[Security]** Enhanced webhook_deliveries policies (admin/auditor only)
- **[Security]** Improved matches table policies with service role access
- **[Security]** Added security comments to sensitive fields
- **[Security]** All policies now properly enforce org-level isolation

### Authentication
- **[Auth]** Implemented secure password reset flow with one-time tokens
- **[Auth]** Added 24-hour token expiration
- **[Auth]** Minimum 8-character password requirement
- **[Auth]** Generic error messages to prevent email enumeration
- **[Auth]** Required email verification for all new signups
- **[Auth]** Implemented resend verification email functionality

---

## [1.0.0] - 2025-11-10

### Initial Release

#### Core API Endpoints
- **[API]** `POST /signals` - Create buyer/seller intent signals
- **[API]** `GET /signals` - List signals with filtering
- **[API]** `GET /signals/:id` - Get signal with matched options
- **[API]** `POST /signals/:id/select` - Select an option
- **[API]** `DELETE /signals/:id` - Cancel a signal

#### Match Management
- **[API]** `POST /match` - Create match with SHA-256 hash
- **[API]** `GET /match` - List matches with filtering
- **[API]** `GET /match/:id` - Get specific match
- **[API]** `POST /match/:id/settle` - Confirm intent (idempotent)

#### API Key Management
- **[API]** `POST /api-keys` - Create new API key
- **[API]** `GET /api-keys` - List API keys
- **[API]** `DELETE /api-keys/:id` - Revoke API key

#### Webhook System
- **[API]** `POST /webhooks` - Create webhook endpoint
- **[API]** `GET /webhooks` - List webhook endpoints
- **[API]** `PATCH /webhooks/:id` - Update webhook
- **[API]** `DELETE /webhooks/:id` - Delete webhook
- **[Webhooks]** HMAC-SHA256 signature verification
- **[Webhooks]** Delivery tracking with response logging

#### Data Sources
- **[API]** `POST /data-sources` - Register data source
- **[API]** `GET /data-sources` - List data sources

#### Consents
- **[API]** `POST /consents` - Grant consent
- **[API]** `DELETE /consents/:id` - Revoke consent

#### Organizations (Admin)
- **[API]** `GET /orgs` - List organizations
- **[API]** `PATCH /orgs/:id` - Update organization

#### Audit Logs
- **[API]** `GET /audit-logs` - Query audit logs with filtering

#### Security Features
- **[Security]** API key authentication with scope-based access
- **[Security]** Rate limiting per organization and endpoint
- **[Security]** Row Level Security on all tables
- **[Security]** Idempotency key support for POST endpoints
- **[Security]** SHA-256 hashing for match proof-of-intent

#### Database Schema
- **[Database]** organizations table
- **[Database]** profiles table with org association
- **[Database]** user_roles table with enum types
- **[Database]** api_keys table with hashed storage
- **[Database]** signals and options tables
- **[Database]** matches table with hash field
- **[Database]** match_events for hash-chained timeline
- **[Database]** webhook_endpoints and webhook_deliveries
- **[Database]** audit_logs for compliance trail
- **[Database]** data_sources and consents
- **[Database]** rate_limits and idempotency_keys

#### User Interface
- **[UI]** Developer dashboard with sidebar navigation
- **[UI]** API key management interface
- **[UI]** Live API testing playground
- **[UI]** Analytics and metrics visualization
- **[UI]** Audit log viewer with filters
- **[UI]** Interactive API documentation

#### Authentication
- **[Auth]** Email/password authentication
- **[Auth]** Auto-creates organization on signup
- **[Auth]** Role assignment based on email domain
- **[Auth]** Session management with Supabase Auth

---

## Migration Notes

### Upgrading to 1.2.0

No breaking changes. New features are additive.

**Recommended Actions**:
1. Update API documentation links
2. Consider using Evidence Pack endpoint for compliance reporting
3. Review and enable new security features

### Upgrading to 1.1.0

No breaking changes.

**Required Actions**:
1. If using API keys, note new `expires_at` field
2. If using webhooks, implement retry handling
3. Run cron job setup SQL if using automation features

### Initial Setup (1.0.0)

See `docs/getting-started.md` for complete setup instructions.

---

## Deprecation Notices

None currently.

---

## Known Issues

1. **Evidence Pack large files** - Very large matches (100+ events) may timeout
   - Workaround: Use pagination in audit logs instead

2. **Webhook retry timing** - Retries may be delayed during high load
   - Workaround: Monitor dead letter queue

---

## Support

- **Documentation**: See `/docs` folder
- **API Status**: `GET /healthz`
- **Support Email**: support@izenzo.co.za

---

## Contributors

- Izenzo Development Team

---

## License

Proprietary - All rights reserved
