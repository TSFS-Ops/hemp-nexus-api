# Changelog

All notable changes to the Compliance Matching API are documented here.

**Last updated:** 24 January 2026

## Versioning

This project follows semantic versioning: `MAJOR.MINOR.PATCH`
- **MAJOR**: Breaking changes
- **MINOR**: New features (backwards compatible)
- **PATCH**: Bug fixes (backwards compatible)

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
