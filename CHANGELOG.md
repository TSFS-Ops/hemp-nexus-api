# Changelog

All notable changes to this project are documented here with timestamps.

## Format
- **YYYY-MM-DD** – [Area] – Description of change

---

## November 2025

### 2025-11-20 – [Admin] – Admin panel implementation
- Created admin panel with Users and Organizations management
- Added ability to view all users across organizations
- Added ability to update organization status and SAHPRA license numbers
- Implemented role-based access control (admin only)
- Added navigation from Dashboard to Admin panel

### 2025-11-20 – [Automation] – Webhook retry logic
- Implemented automated webhook retry system with exponential backoff
- Created `/webhook-retry` edge function for background processing
- Retry schedule: 5 min, 30 min, 2 hours (configurable)
- Added dead letter queue for exhausted retries
- Database fields: `next_retry_at`, `max_retries`, `is_dead_letter`

### 2025-11-20 – [Automation] – API key expiry automation
- Created `/api-key-expiry` edge function for automated expiry management
- Implemented 7-day warning system before expiry
- Automatic key disabling on expiration date
- Added `expires_at` and `expiry_warning_sent` fields to api_keys table
- All expiry events logged in audit_logs

### 2025-11-20 – [Docs] – Cron job setup documentation
- Created comprehensive cron setup guide (`docs/cron-setup.md`)
- Added interactive `CronSetupInstructions` component in UI
- New "Automation" tab in Dashboard with copy-paste SQL scripts
- Documented pg_cron and pg_net extension setup
- Included cron expression reference and examples

### 2025-11-20 – [UI] – API key expiry UI enhancements
- Added expiry date display on API key cards
- Implemented warning indicator for keys expiring within 7 days
- Added expiry selection dropdown (Never, 30, 90, 180, 365 days) during key creation
- Enhanced key metadata display with better layout

### 2025-11-20 – [Security] – RLS policy improvements
- Tightened profiles RLS policies (org-scoped access only)
- Enhanced webhook_deliveries policies (admin/auditor only)
- Improved matches table policies with service role access
- Added security comments to sensitive fields (secret_hash, key_hash)
- All policies now properly enforce org-level isolation

### 2025-11-20 – [Auth] – Password reset implementation
- Implemented secure password reset flow with one-time tokens
- Added 24-hour token expiration
- Minimum 8-character password requirement
- Generic error messages to prevent email enumeration
- Proper redirect handling after reset

### 2025-11-20 – [Auth] – Email verification enforcement
- Required email verification for all new signups
- Disabled auto-confirm in Supabase Auth settings
- Added email verification status checks
- Implemented resend verification email functionality

### 2025-11-19 – [API] – Validation schema updates
- Added `expires_at` field to API key creation schema
- Enhanced input validation for all endpoints
- Improved error messages for validation failures
- Added proper zod schemas for all request bodies

### 2025-11-18 – [API] – Webhook delivery tracking
- Implemented webhook delivery logging in `webhook_deliveries` table
- Added HMAC-SHA256 signature generation for webhook security
- Tracked delivery attempts, response codes, and error messages
- Integrated with webhook retry system

### 2025-11-17 – [Database] – Schema enhancements
- Added api_keys table with scopes and expiry support
- Added webhook_endpoints and webhook_deliveries tables
- Added data_source_performance tracking table
- Created is_admin() security definer function
- Added necessary indexes for performance

### 2025-11-16 – [API] – Match settlement endpoint
- Added `POST /match/:id/settle` endpoint for settlement confirmation
- Idempotent settlement (safe to call multiple times)
- Creates immutable audit log entry with match hash
- Returns settled match with timestamp
- Proper org ownership verification

### 2025-11-16 – [API] – Match creation with hashing
- Implemented `POST /match` endpoint with SHA-256 hash generation
- Hash includes: buyer, seller, commodity, quantity, price, terms
- Immutable proof-of-intent stored in audit logs
- Prevents double-counting and aids dispute resolution
- Webhook notifications on match.created events

### 2025-11-15 – [API] – Audit logs endpoint
- Created `GET /audit-logs` endpoint with filtering
- Supports filtering by action, entity_type, entity_id, date range
- Pagination with limit/offset
- Returns total count for UI pagination
- Read-only access (no modifications allowed)

### 2025-11-15 – [API] – SAHPRA verification
- Integrated SAHPRA license verification
- Created `/sahpra-verification` endpoint
- Background cache refresh from official SAHPRA data
- Fuzzy company name matching
- Results stored in organizations table

### 2025-11-14 – [API] – Signals endpoint
- Created `POST /signals` for buyer intent signals
- Added `POST /signals/:id/select` for option selection
- Integrated with data source search
- Returns matched options from configured data sources
- Signal status tracking (active, expired)

### 2025-11-13 – [API] – Rate limiting implementation
- Implemented sliding window rate limiting
- Per-organization and per-endpoint limits
- 429 status with Retry-After header
- Automatic cleanup of expired rate limit records
- Configurable limits per scope

### 2025-11-13 – [API] – API key management
- Created `/api-keys` endpoint (POST, GET, DELETE)
- Secure key generation with crypto.randomUUID()
- SHA-256 hashing for key storage
- Scope-based access control
- Last used tracking

### 2025-11-12 – [Security] – Idempotency key support
- Implemented idempotency key handling for critical endpoints
- 24-hour idempotency window
- Prevents duplicate match creation
- Returns cached response for duplicate requests
- Automatic cleanup via database function

### 2025-11-12 – [Database] – Row Level Security policies
- Enabled RLS on all user-facing tables
- Org-scoped access for most resources
- Admin-only access for sensitive operations
- Security definer functions for role checks
- Proper foreign key relationships

### 2025-11-11 – [Auth] – User authentication flow
- Implemented email/password authentication
- Auto-creates organization and profile on signup
- Assigns default admin role to first user
- Session management with Supabase Auth
- Protected routes with auth checks

### 2025-11-10 – [UI] – Developer dashboard
- Created comprehensive API dashboard
- API key management interface
- Live API testing playground
- Analytics and metrics visualization
- Audit log viewer with filters

### 2025-11-10 – [Docs] – API documentation component
- Created interactive API docs in dashboard
- Request/response examples for all endpoints
- Authentication guide
- Error code reference
- Rate limiting information

---

## October 2025

### 2025-10-20 – [Project] – Initial project setup
- Created React + TypeScript + Vite project
- Integrated Supabase for backend
- Set up Tailwind CSS with shadcn/ui components
- Configured routing with react-router-dom
- Initial database schema design

---

## Maintenance Notes

### How to Update This Changelog
When making significant changes:
1. Add entry with current date (YYYY-MM-DD format)
2. Tag with area: [API], [UI], [Database], [Security], [Auth], [Admin], [Automation], [Docs], [Project]
3. Use clear, concise descriptions
4. Group related changes together
5. Keep entries in reverse chronological order (newest first)

### Areas Defined
- **API**: Backend endpoints, edge functions, business logic
- **UI**: Frontend components, pages, styling
- **Database**: Schema changes, migrations, functions
- **Security**: RLS policies, authentication, authorization
- **Auth**: Login, signup, password management
- **Admin**: Admin panel, user management
- **Automation**: Background jobs, cron tasks
- **Docs**: Documentation updates, guides
- **Project**: Infrastructure, configuration, tooling
