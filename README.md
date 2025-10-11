# SignalRank API

**Multi-tenant B2B marketplace REST API for hemp & cannabis trade**

SignalRank is a production-ready, sector-agnostic API service focused on compliance, listings, orders, and broker mandates. Built on Lovable Cloud (Supabase) with PostgreSQL, authentication, file storage, and serverless edge functions.

## 🚀 Quick Start (5 minutes)

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

SignalRank supports two authentication methods:

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
| `ALLOWED_ORIGINS` | CORS allowed origins (comma-separated) | Yes | `https://app.signalrank.com,https://staging.signalrank.com` |
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

SignalRank sends HMAC-SHA256 signed webhooks for events:

**Signature Header**: `X-SignalRank-Signature`

**Verification**:
```javascript
const crypto = require('crypto');
const signature = req.headers['x-signalrank-signature'];
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
- [SignalRank Project](https://lovable.dev/projects/95025ceb-b8ab-4906-adee-3188617c0dbc)

## 🤝 Support

For API support or questions:
- Check the [Lovable Discord community](https://discord.com/channels/1119885301872070706/1280461670979993613)
- Review backend logs in Lovable Cloud dashboard

## 📄 License

Proprietary - SignalRank API

---

**Built with ❤️ using Lovable Cloud**
