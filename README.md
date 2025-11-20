# Compliance Matching API

**Cross-industry REST API for verified trade intent**

Compliance Matching API v1 is a sector-agnostic backend service that logs, matches, and settles verified trade intent between buyers and sellers, with comprehensive audit logs and compliance event tracking. The API is decoupled from any specific marketplace or frontend—it simply provides a reliable record-keeping layer for trade transactions.

---

## Quick Start (5 minutes)

### 1. Get an API Key

Sign up at the dashboard to create an API key, or use the API:

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

### 2. Record a Match

```bash
curl -X POST https://ugrfyhwlonlmlcmcpcdm.supabase.co/functions/v1/match \
  -H "X-API-Key: sk_your_key_here" \
  -H "Content-Type: application/json" \
  -d '{
    "buyer": {
      "id": "BUYER123",
      "name": "Example Buyer Ltd"
    },
    "seller": {
      "id": "SELLER456",
      "name": "Example Seller Ltd"
    },
    "commodity": "Industrial Equipment Parts",
    "quantity": {
      "amount": 1000,
      "unit": "units"
    },
    "price": {
      "amount": 50000,
      "currency": "EUR"
    },
    "terms": "Delivery within 30 days, payment on delivery",
    "metadata": {
      "region": "EU",
      "channel": "B2B platform"
    }
  }'
```

Returns a proof record with `id`, `status: "matched"`, `created_at`, and `hash`.

### 3. Retrieve a Match

```bash
curl https://ugrfyhwlonlmlcmcpcdm.supabase.co/functions/v1/match/{match_id} \
  -H "X-API-Key: sk_your_key_here"
```

### 4. Mark as Settled

```bash
curl -X POST https://ugrfyhwlonlmlcmcpcdm.supabase.co/functions/v1/match/{match_id}/settle \
  -H "X-API-Key: sk_your_key_here"
```

Updates the match to `status: "settled"` and sets `settled_at` timestamp.

---

## Core Concepts

### Matches
A **match** is a recorded trade agreement between a buyer and a seller. Each match includes:
- **Buyer & Seller**: IDs and names of both parties
- **Commodity**: Product or service being traded
- **Quantity**: Amount and unit (e.g., 1000 kg)
- **Price**: Amount and currency (e.g., 50000 EUR)
- **Terms**: Commercial terms in plain language
- **Metadata**: Optional fields like region, channel, notes
- **Status**: Either `matched` (initial state) or `settled` (finalized)
- **Hash**: SHA-256 cryptographic proof of the match data
- **Timestamps**: `created_at` and optionally `settled_at`

### Proof Record
Every match generates a tamper-evident proof record with:
- Unique ID (UUID)
- SHA-256 hash of the canonical match data
- Status and timestamps
- Full match details

This provides an immutable record that can be verified independently.

### API Authentication
All endpoints require an API key passed in the `X-API-Key` header. API keys are managed through the dashboard or the `/api-keys` endpoints.

---

## API Endpoints

**Base URL**: `https://ugrfyhwlonlmlcmcpcdm.supabase.co/functions/v1`

### Authentication
All endpoints require an API key in the `X-API-Key` header:
```
X-API-Key: sk_your_api_key
```

---

### Match Recording

#### `POST /match`
Record a new trade match and return a proof record.

**Request**:
```json
{
  "buyer": {
    "id": "BUYER123",
    "name": "Example Buyer Ltd"
  },
  "seller": {
    "id": "SELLER456",
    "name": "Example Seller Ltd"
  },
  "commodity": "Product or service name",
  "quantity": {
    "amount": 1000,
    "unit": "kg"
  },
  "price": {
    "amount": 50000,
    "currency": "EUR"
  },
  "terms": "Key commercial terms in plain language",
  "metadata": {
    "region": "EU-Africa",
    "channel": "Trade.Izenzo platform",
    "notes": "Any extra notes"
  }
}
```

**Required fields**:
- `buyer.id`, `buyer.name`
- `seller.id`, `seller.name`
- `commodity`
- `quantity.amount`, `quantity.unit`
- `price.amount`, `price.currency`

**Response**: `201 Created`
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "created_at": "2025-01-10T12:00:00.000Z",
  "status": "matched",
  "hash": "a3b2c1d4e5f6...",
  "buyer_id": "BUYER123",
  "buyer_name": "Example Buyer Ltd",
  "seller_id": "SELLER456",
  "seller_name": "Example Seller Ltd",
  "commodity": "Product or service name",
  "quantity_amount": 1000,
  "quantity_unit": "kg",
  "price_amount": 50000,
  "price_currency": "EUR",
  "terms": "Key commercial terms in plain language",
  "metadata": {
    "region": "EU-Africa",
    "channel": "Trade.Izenzo platform"
  },
  "settled_at": null
}
```

#### `GET /match/:id`
Retrieve a single match and its proof record.

**Response**: `200 OK`
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "created_at": "2025-01-10T12:00:00.000Z",
  "status": "matched",
  "hash": "a3b2c1d4e5f6...",
  "buyer_id": "BUYER123",
  "buyer_name": "Example Buyer Ltd",
  "seller_id": "SELLER456",
  "seller_name": "Example Seller Ltd",
  "commodity": "Product or service name",
  "quantity_amount": 1000,
  "quantity_unit": "kg",
  "price_amount": 50000,
  "price_currency": "EUR",
  "terms": "Key commercial terms in plain language",
  "metadata": {},
  "settled_at": null
}
```

**Error**: `404 Not Found` if match doesn't exist.

#### `POST /match/:id/settle`
Mark an existing match as "settled" and update the proof record.

**Request**: Empty body (no parameters needed)

**Response**: `200 OK`
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "created_at": "2025-01-10T12:00:00.000Z",
  "status": "settled",
  "hash": "a3b2c1d4e5f6...",
  "buyer_id": "BUYER123",
  "buyer_name": "Example Buyer Ltd",
  "seller_id": "SELLER456",
  "seller_name": "Example Seller Ltd",
  "commodity": "Product or service name",
  "quantity_amount": 1000,
  "quantity_unit": "kg",
  "price_amount": 50000,
  "price_currency": "EUR",
  "terms": "Key commercial terms in plain language",
  "metadata": {},
  "settled_at": "2025-01-10T14:30:00.000Z"
}
```

**Behavior**:
- If match is already `settled`, returns existing record (idempotent)
- If match is `matched`, updates to `settled` and sets `settled_at` timestamp
- Returns `404 Not Found` if match doesn't exist

#### `GET /matches`
List matches with pagination and filtering.

**Query Parameters**:
- `limit`: Max results (default: 50)
- `offset`: Skip N results (default: 0)
- `status`: Filter by status (`matched` or `settled`)

**Example**:
```bash
GET /matches?limit=20&offset=0&status=matched
```

**Response**: `200 OK`
```json
{
  "items": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "created_at": "2025-01-10T12:00:00.000Z",
      "status": "matched",
      "buyer_name": "Example Buyer Ltd",
      "seller_name": "Example Seller Ltd",
      "commodity": "Product or service name",
      "quantity_amount": 1000,
      "quantity_unit": "kg",
      "price_amount": 50000,
      "price_currency": "EUR"
    }
  ],
  "totalCount": 145
}
```

---

### Legacy Endpoints

The following endpoints remain available for backward compatibility but are not part of the Trade.Izenzo API v1 core:

- `/signals` - Signal-based matching system
- `/data-sources` - Data source connectors
- `/consents` - Data access permissions
- `/api-keys` - API key management

See sections below for details on these endpoints.

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
- `METHOD_NOT_ALLOWED` (405)
- `INTERNAL_ERROR` (500)

---

## Testing

### Manual Test Script

A bash script is provided for end-to-end testing:

```bash
export TRADE_IZENZO_API_KEY=sk_your_key_here
chmod +x examples/trade-izenzo-example.sh
./examples/trade-izenzo-example.sh
```

This script will:
1. Create a match via POST /match
2. Retrieve it via GET /match/:id
3. Settle it via POST /match/:id/settle
4. Verify idempotency by calling settle again
5. List matches via GET /matches
6. Display hash for independent verification

### Expected Behavior

- ✓ Match created with `status: "matched"` and SHA-256 hash
- ✓ Match retrieved with full details
- ✓ Match settles successfully with `settled_at` timestamp
- ✓ Second settle call returns same record (idempotent)
- ✓ Match appears in list with correct status

See `docs/trade-izenzo-api-v1.md` for complete API documentation.

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
- **Lovable Cloud** (Supabase backend)
- **Edge Functions** (Deno/TypeScript)
- **Postgres** with RLS and cryptographic hashing
- **React** frontend for API key management
- **Sector-agnostic design** for universal applicability

The API is designed to be simple, reliable, and decoupled from any specific marketplace or frontend.

---

## Architecture

### Match Recording Flow

1. **Match In**: External system (marketplace, ERP) posts a match
2. **Validate**: Check required fields and API key
3. **Hash**: Compute SHA-256 proof of canonical match data
4. **Store**: Insert match record with status `matched`
5. **Return**: Send complete match record with proof hash
6. **Later**: System calls `/settle` to update status when complete

### Data Storage

Trade.Izenzo stores:
- Match records with full details
- Cryptographic proof hashes
- Status and timestamps
- Metadata for filtering and reporting

We don't store:
- Proprietary business logic
- Sector-specific assumptions
- Payment or logistics data
- Long-term transactional data

The database is designed for fast lookups, proof verification, and clean auditing.

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

## Resources

- **Complete API Docs**: [docs/trade-izenzo-api-v1.md](docs/trade-izenzo-api-v1.md)
- **Test Script**: [examples/trade-izenzo-example.sh](examples/trade-izenzo-example.sh)
- **Client Example** (legacy signals): [examples/client-example.js](examples/client-example.js)
- [Lovable Cloud Documentation](https://docs.lovable.dev/features/cloud)
- [Supabase Documentation](https://supabase.com/docs)
- [Trade.Izenzo Project](https://lovable.dev/projects/95025ceb-b8ab-4906-adee-3188617c0dbc)

## Support

For API support or questions:
- Email: support@trade.izenzo.com
- Check the [Lovable Discord community](https://discord.com/channels/1119885301872070706/1280461670979993613)
- Review backend logs in Lovable Cloud dashboard

## License

Proprietary - Trade.Izenzo API

---

**Trade.Izenzo API v1**: Generic trade match recording with cryptographic proofs. Simple, fast, decoupled.

