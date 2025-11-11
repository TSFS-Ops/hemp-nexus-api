# Trade.Izenzo API

**Signal-based matching service for B2B trade**

Trade.Izenzo transforms buyer/seller signals into scored, comparable options by querying consent-based data sources, returning fast results and handing off to home systems.

---

## Quick Start (5 minutes)

### 1. Get an API Key

```bash
curl -X POST https://ugrfyhwlonlmlcmcpcdm.supabase.co/functions/v1/api-keys \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My API Key",
    "scopes": ["signals:write", "signals:read"]
  }'
```

Save the returned `key` (starts with `sk_`). You'll only see it once.

### 2. Check Health

```bash
curl https://ugrfyhwlonlmlcmcpcdm.supabase.co/functions/v1/healthz
# => {"ok": true}
```

### 3. Create a Signal

```bash
curl -X POST https://ugrfyhwlonlmlcmcpcdm.supabase.co/functions/v1/signals \
  -H "X-API-Key: sk_your_key_here" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "buyer",
    "content": {
      "what": "Hemp fibre",
      "how_much": 10000,
      "unit": "kg",
      "where": "Rotterdam",
      "when": "2025-10-25",
      "price_budget": 1200,
      "quality_requirements": {"grade": "industrial"}
    }
  }'
```

### 4. Get Matched Options

```bash
curl https://ugrfyhwlonlmlcmcpcdm.supabase.co/functions/v1/signals/{signal_id} \
  -H "X-API-Key: sk_your_key_here"
```

Returns signal + scored options.

### 5. Select an Option

```bash
curl -X POST https://ugrfyhwlonlmlcmcpcdm.supabase.co/functions/v1/signals/{signal_id}/select \
  -H "X-API-Key: sk_your_key_here" \
  -H "Content-Type: application/json" \
  -d '{"option_id": "uuid"}'
```

Returns `handoff_token` and `handoff_url` to complete the transaction in the home system.

---

## Core Concepts

### Signals
A **signal** is a buyer need or seller offer:
- **Buyer signal**: "I need X quantity of Y product in Z location by W date"
- **Seller signal**: "I have X quantity of Y product available now"

### Data Sources
Connect to external systems (marketplaces, ERPs, sheets, registries, labs) where data lives.

### Consents
Grant read-only permission for Trade.Izenzo to query specific data sources.

### Options
Normalized results with standard fields:
- `what`: Product/category
- `how_much` / `unit`: Quantity
- `where_location`: Location
- `when_available`: Availability
- `price` / `currency`: Pricing
- `quality_flags`: Compliance/quality indicators
- `confidence_score`: Match confidence (0-1)
- `score`: Combined ranking score

### Selections & Hand-off
When you pick an option, Trade.Izenzo generates a short-lived token and URL to hand off to the source system. We don't create the order—the home system does.

---

## API Endpoints

**Base URL**: `https://ugrfyhwlonlmlcmcpcdm.supabase.co/functions/v1`

### Authentication
Include in headers:
```
X-API-Key: sk_your_api_key
```

Or use JWT:
```
Authorization: Bearer YOUR_JWT_TOKEN
```

### Signals

#### `POST /signals`
Create a new signal and trigger search.

**Request**:
```json
{
  "type": "buyer|seller",
  "content": {
    "what": "Product name",
    "how_much": 1000,
    "unit": "kg",
    "where": "Location",
    "when": "2025-10-25",
    "price_budget": 5000,
    "quality_requirements": {}
  },
  "expires_at": "2025-11-01T00:00:00Z" // optional
}
```

**Response**: `201 Created`
```json
{
  "id": "uuid",
  "type": "buyer",
  "status": "active",
  "created_at": "2025-10-11T...",
  "message": "Signal received. Searching data sources..."
}
```

#### `GET /signals`
List your signals.

**Query params**:
- `limit`: Max results (default 50)
- `status`: Filter by status (active, matched, expired)

#### `GET /signals/:id`
Get signal with matched options.

**Response**: `200 OK`
```json
{
  "signal": { ... },
  "options": [
    {
      "id": "uuid",
      "what": "Hemp fibre industrial grade",
      "how_much": 10000,
      "unit": "kg",
      "where_location": "Rotterdam",
      "price": 1180,
      "currency": "USD",
      "quality_flags": {"certified": true},
      "confidence_score": 0.85,
      "score": 87.5,
      "source_link": "https://...",
      "data_source": {
        "name": "ABC Marketplace",
        "type": "marketplace"
      }
    }
  ]
}
```

#### `POST /signals/:id/select`
Select an option and get handoff details.

**Request**:
```json
{
  "option_id": "uuid"
}
```

**Response**: `200 OK`
```json
{
  "selection_id": "uuid",
  "handoff_token": "short-lived-token",
  "handoff_url": "https://source-system.com/...",
  "message": "Option selected. Handoff to source system."
}
```

#### `DELETE /signals/:id`
Cancel a signal (sets status to `expired`).

---

### Data Sources

#### `POST /data-sources`
Register a connector.

**Request**:
```json
{
  "name": "My ERP System",
  "type": "erp|marketplace|sheet|registry|lab",
  "config": {
    "api_url": "https://...",
    "auth_token": "encrypted..."
  }
}
```

#### `GET /data-sources`
List data sources.

#### `GET /data-sources/:id`
Get data source details.

#### `PATCH /data-sources/:id`
Update data source config.

#### `DELETE /data-sources/:id`
Delete data source.

---

### Consents

#### `POST /consents`
Grant consent to query a data source.

**Request**:
```json
{
  "data_source_id": "uuid",
  "scope": {"read_inventory": true},
  "expires_at": "2026-01-01T00:00:00Z" // optional
}
```

#### `GET /consents`
List active consents.

#### `DELETE /consents/:id`
Revoke consent.

---

### Organizations (Admin)

See `supabase/functions/orgs/index.ts` for org management endpoints.

---

### API Keys

#### `POST /api-keys`
Create a new API key.

#### `GET /api-keys`
List your API keys (keys are hashed; only shown once on creation).

#### `DELETE /api-keys/:id`
Revoke an API key.

---

### Health Check

#### `GET /healthz`
Returns `{"ok": true}` if API is online.

---

## Error Responses

All errors follow this format:

```json
{
  "code": "ERROR_CODE",
  "message": "Human-readable message",
  "details": {},
  "requestId": "uuid"
}
```

**Common codes**:
- `VALIDATION_ERROR` (400)
- `UNAUTHORIZED` (401)
- `FORBIDDEN` (403)
- `NOT_FOUND` (404)
- `INTERNAL_ERROR` (500)

---

## Security

- **CORS**: Configured via `ALLOWED_ORIGINS` env var
- **API Keys**: SHA-256 hashed, never stored in plaintext
- **JWT**: OAuth2 client-credentials supported
- **Multi-tenancy**: All data scoped by `org_id`
- **RLS**: Row-level security on all tables
- **Audit logs**: All actions logged with requestId

---

## Environment Variables

Set these in your Supabase project:

- `SUPABASE_URL`: Your Supabase URL
- `SUPABASE_SERVICE_ROLE_KEY`: Service role key (keep secret!)
- `ALLOWED_ORIGINS`: CORS allowed origins (comma-separated)

---

## Architecture

### Signal Flow

1. **Signal In**: Buyer/seller posts a signal
2. **Fan-out**: Query all consented data sources (background)
3. **Normalize**: Convert results to standard Option format
4. **Score**: Rank by freshness, confidence, price, quality
5. **Return**: Fast results immediately, late results later
6. **Select**: User picks option → hand off to source system

### Minimal Storage

Trade.Izenzo stores:
- Signals (short-lived)
- Data source configs
- Consents
- Options (summaries only, not raw data)
- Audit logs

We never hoard proprietary data—just links and summaries.

---

## Development

Built with:
- **Lovable Cloud** (Supabase)
- **Edge Functions** (Deno/TypeScript)
- **Postgres** with RLS
- **API-only** (no frontend)

---

## Support

For issues or questions, contact: support@trade.izenzo.com

---

**Trade.Izenzo**: Signals in → options out → hand off. Fast, consent-based, privacy-first.

### 1. Access the API

The API is available at:
```
https://ugrfyhwlonlmlcmcpcdm.supabase.co/functions/v1
```

### 2. Health Check

```bash
curl https://ugrfyhwlonlmlcmcpcdm.supabase.co/functions/v1/healthz
```

Response:
```json
{
  "ok": true,
  "timestamp": "2025-10-11T12:00:00.000Z"
}
```

### 3. Create an API Key

First, authenticate using Lovable Cloud authentication, then create an API key:

```bash
curl -X POST https://ugrfyhwlonlmlcmcpcdm.supabase.co/functions/v1/api-keys \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My API Key",
    "scopes": ["orders:read", "orders:write", "listings:read"]
  }'
```

Response (API key shown only once):
```json
{
  "id": "uuid",
  "name": "My API Key",
  "key": "sk_abc123...",
  "scopes": ["orders:read", "orders:write", "listings:read"],
  "created_at": "2025-10-11T12:00:00.000Z"
}
```

### 4. Upload a Compliance Document

```bash
curl -X POST https://ugrfyhwlonlmlcmcpcdm.supabase.co/functions/v1/compliance/documents \
  -H "X-API-Key: sk_your_api_key" \
  -F "file=@business_license.pdf" \
  -F "type=licence"
```

### 5. Check Compliance Status

```bash
curl https://ugrfyhwlonlmlcmcpcdm.supabase.co/functions/v1/compliance/status \
  -H "X-API-Key: sk_your_api_key"
```

Response:
```json
{
  "org_id": "uuid",
  "is_compliant": false,
  "summary": {
    "total": 1,
    "pending": 1,
    "approved": 0,
    "rejected": 0
  },
  "certificates": [...]
}
```

## 🔐 Authentication

Trade.Izenzo supports two authentication methods:

### 1. API Keys (Machine-to-Machine)

Include your API key in the `X-API-Key` header:

```bash
curl -H "X-API-Key: sk_your_api_key" https://...
```

### 2. JWT Tokens (User Sessions)

Include a JWT token from Lovable Cloud Auth in the `Authorization` header:

```bash
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" https://...
```

## 📍 API Endpoints

All endpoints are prefixed with `/v1`:

### Health & Status
- `GET /v1/healthz` - Health check (public)

### Authentication & Keys
- `POST /v1/api-keys` - Create API key
- `GET /v1/api-keys` - List API keys
- `DELETE /v1/api-keys/:id` - Revoke API key

### Compliance (Ask-Once)
- `POST /v1/compliance/documents` - Upload compliance document (PDF/JPG/PNG, max 10MB)
- `GET /v1/compliance/status` - Get compliance status for organization

### Organizations & Users (Admin Only)
- `GET /v1/orgs` - List organizations
- `POST /v1/orgs` - Create organization
- `GET /v1/orgs/:id` - Get organization
- `PATCH /v1/orgs/:id` - Update organization
- `DELETE /v1/orgs/:id` - Delete organization

### Orders
- `GET /v1/orders` - List orders (filtered by org)
- `POST /v1/orders` - Create order (idempotent with `Idempotency-Key` header)
- `PATCH /v1/orders/:id` - Update order status

### More Endpoints (Coming Soon)
- Categories, Products, Listings
- Broker Mandates
- Webhooks
- Audit Logs

## 🔧 Environment Variables

Set these in your Lovable Cloud backend settings:

| Variable | Description | Required | Example |
|----------|-------------|----------|---------|
| `ALLOWED_ORIGINS` | CORS allowed origins (comma-separated) | Yes | `https://app.trade.izenzo.com,https://staging.trade.izenzo.com` |
| `JWT_SECRET` | JWT signing secret | Auto | (auto-configured by Lovable Cloud) |
| `SUPABASE_URL` | Database URL | Auto | (auto-configured by Lovable Cloud) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key | Auto | (auto-configured by Lovable Cloud) |

**Note**: Most env vars are auto-configured by Lovable Cloud. Only set `ALLOWED_ORIGINS` for production CORS.

## 🛡️ Security Features

- ✅ **Multi-tenancy**: All data scoped by `org_id` with Row Level Security (RLS)
- ✅ **API Key authentication**: SHA-256 hashed keys with scopes
- ✅ **JWT authentication**: OAuth2-compatible tokens
- ✅ **CORS**: Configurable allowed origins (no wildcard in production)
- ✅ **Rate limiting**: Per API key and per IP (configurable)
- ✅ **File uploads**: Private storage with pre-signed URLs
- ✅ **Audit logs**: All actions logged with actor and metadata
- ✅ **Error handling**: Consistent error format, no stack trace leaks
- ✅ **Idempotency**: Respect `Idempotency-Key` header on writes

## 📊 Database Schema

Key tables:
- `organizations` - Multi-tenant organizations
- `profiles` - User profiles (extends auth.users)
- `user_roles` - Role-based access control (admin, seller, broker, buyer, auditor)
- `api_keys` - API key management
- `certificates` - Compliance documents (ask-once)
- `products` - Product catalog
- `listings` - Marketplace listings
- `orders` - Order management (idempotent)
- `broker_mandates` - Broker authorization
- `webhook_endpoints` - Webhook subscriptions
- `audit_logs` - Full audit trail

## 🔔 Webhooks

Trade.Izenzo sends HMAC-SHA256 signed webhooks for events:

**Signature Header**: `X-Trade-Izenzo-Signature`

**Verification**:
```javascript
const crypto = require('crypto');
const signature = req.headers['x-trade-izenzo-signature'];
const body = JSON.stringify(req.body);
const expected = crypto
  .createHmac('sha256', SECRET)
  .update(body)
  .digest('hex');
const isValid = crypto.timingSafeEqual(
  Buffer.from(signature),
  Buffer.from(expected)
);
```

## 🎯 Error Format

All errors follow this format:

```json
{
  "code": "VALIDATION_ERROR",
  "message": "Human-readable error message",
  "details": {
    "field": "additional context"
  },
  "requestId": "uuid"
}
```

Common error codes:
- `UNAUTHORIZED` (401) - Missing or invalid authentication
- `FORBIDDEN` (403) - Insufficient permissions
- `NOT_FOUND` (404) - Resource not found
- `VALIDATION_ERROR` (400) - Invalid input
- `INTERNAL_ERROR` (500) - Server error

## 📦 Pagination

List endpoints support cursor-based pagination:

```
GET /v1/orders?limit=50&cursor=eyJpZCI6InV1aWQiLCJjcmVhdGVkX2F0IjoiMjAyNS0xMC0xMVQxMjowMDowMC4wMDBaIn0
```

## 🚦 Rate Limits

- **Per API Key**: 1000 requests/hour
- **Per IP**: 100 requests/minute (unauthenticated)

Rate limit headers:
```
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 999
X-RateLimit-Reset: 1696156800
```

## 📝 OpenAPI Docs

Interactive API documentation (coming soon):
```
GET /v1/docs
```

## 🏗️ Architecture

- **Frontend**: Static HTML info page (this is API-only)
- **Backend**: Lovable Cloud (Supabase)
  - PostgreSQL database with RLS
  - Edge Functions (Deno/TypeScript) for REST endpoints
  - Storage for compliance documents
  - Authentication (email/password, OAuth2)
- **Deployment**: Automatic via Lovable Cloud
- **Logging**: Structured logs with request correlation

## 🧪 Testing

Test the API using curl, Postman, or any HTTP client:

```bash
# Health check
curl https://ugrfyhwlonlmlcmcpcdm.supabase.co/functions/v1/healthz

# With API key
curl -H "X-API-Key: sk_your_key" \
  https://ugrfyhwlonlmlcmcpcdm.supabase.co/functions/v1/orders
```

## 📚 Resources

- [Lovable Cloud Documentation](https://docs.lovable.dev/features/cloud)
- [Supabase Documentation](https://supabase.com/docs)
- [Trade.Izenzo Project](https://lovable.dev/projects/95025ceb-b8ab-4906-adee-3188617c0dbc)

## 🤝 Support

For API support or questions:
- Check the [Lovable Discord community](https://discord.com/channels/1119885301872070706/1280461670979993613)
- Review backend logs in Lovable Cloud dashboard

## 📄 License

Proprietary - Trade.Izenzo API

---

