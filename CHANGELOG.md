# Changelog

All notable changes to the Compliance Matching API are documented here.

## Versioning

This project follows semantic versioning: `MAJOR.MINOR.PATCH`
- **MAJOR**: Breaking changes
- **MINOR**: New features (backwards compatible)
- **PATCH**: Bug fixes (backwards compatible)

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
