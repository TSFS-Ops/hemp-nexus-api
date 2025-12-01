# Compliance Matching API Reference

**Current Version**: v1  
**Base URL**: `https://ugrfyhwlonlmlcmcpcdm.supabase.co/functions/v1`  
**Last Updated**: 2025-11-20

---

## Table of Contents

1. [Authentication](#authentication)
2. [Rate Limiting](#rate-limiting)
3. [Error Handling](#error-handling)
4. [Endpoints](#endpoints)
   - [Signals](#signals)
   - [Matches](#matches)
   - [API Keys](#api-keys)
   - [Webhooks](#webhooks)
   - [Data Sources](#data-sources)
   - [Consents](#consents)
   - [Organizations](#organizations)
   - [Audit Logs](#audit-logs)
5. [Webhooks](#webhook-events)
6. [Best Practices](#best-practices)

---

## Authentication

All API requests require authentication using **API keys**.

### API Key Authentication

Include your API key in the `Authorization` header:

```http
Authorization: Bearer sk_your_api_key_here
```

### Getting an API Key

1. Sign up at the developer portal
2. Navigate to Dashboard → API Keys
3. Create a new API key with appropriate scopes
4. Copy and securely store your key (shown only once)

### Scopes

API keys support scope-based access control:

- `signals:read` - Read signals
- `signals:write` - Create and manage signals
- `match:read` - Read matches
- `match:write` - Create matches and confirm intent
- `webhooks:read` - View webhook endpoints
- `webhooks:write` - Manage webhook endpoints
- `data_sources:read` - View data sources
- `data_sources:write` - Manage data sources
- `consents:read` - View consents
- `consents:write` - Grant and revoke consents
- `audit_logs:read` - View audit logs
- `api_keys:manage` - Manage API keys

---

## Rate Limiting

Rate limits are enforced per organization and per endpoint.

**Default Limits**:
- **Signals**: 100 requests / minute
- **Matches**: 50 requests / minute
- **Other endpoints**: 60 requests / minute

**Response Headers**:
```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1637251200
```

**Rate Limit Exceeded**:
```http
HTTP/1.1 429 Too Many Requests
Retry-After: 60

{
  "code": "RATE_LIMIT_EXCEEDED",
  "message": "Rate limit exceeded for endpoint: signals",
  "requestId": "123e4567-e89b-12d3-a456-426614174000",
  "details": {
    "retryAfter": 60,
    "limit": 100,
    "endpoint": "signals"
  }
}
```

---

## Error Handling

All errors follow a consistent format:

```json
{
  "code": "ERROR_CODE",
  "message": "Human-readable error message",
  "requestId": "123e4567-e89b-12d3-a456-426614174000",
  "details": {
    "additional": "context"
  }
}
```

### Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `VALIDATION_ERROR` | 400 | Invalid request data |
| `UNAUTHORIZED` | 401 | Missing or invalid API key |
| `FORBIDDEN` | 403 | Insufficient permissions |
| `NOT_FOUND` | 404 | Resource not found |
| `CONFLICT` | 409 | Resource already exists |
| `RATE_LIMIT_EXCEEDED` | 429 | Too many requests |
| `INTERNAL_ERROR` | 500 | Server error |
| `DATABASE_ERROR` | 500 | Database operation failed |

---

## Endpoints

### Signals

Create and manage buyer/seller intent signals.

#### POST /signals

Create a new signal to express buying or selling intent.

**Request**:
```http
POST /functions/v1/signals
Authorization: Bearer sk_your_api_key
Content-Type: application/json

{
  "product": "Industrial Equipment Parts",
  "quantity": 10000,
  "unit": "units",
  "location": "Regional Distribution Center",
  "deliveryWindow": {
    "start": "2025-12-01",
    "end": "2025-12-15"
  },
  "budget": 50000,
  "currency": "ZAR",
  "notes": "Urgent order for December"
}
```

**Response** (201 Created):
```json
{
  "signal": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "org_id": "org_123",
    "type": "buyer",
    "content": {
      "product": "Industrial Equipment Parts",
      "quantity": 10000,
      "unit": "units",
      "location": "Regional Distribution Center",
      "deliveryWindow": {
        "start": "2025-12-01",
        "end": "2025-12-15"
      },
      "budget": 50000,
      "currency": "ZAR",
      "notes": "Urgent order for December"
    },
    "status": "active",
    "created_at": "2025-11-20T10:30:00Z",
    "expires_at": "2025-12-15T00:00:00Z"
  },
  "options": [
    {
      "id": "opt_123",
      "what": "Industrial Equipment Parts",
      "how_much": 10000,
      "unit": "units",
      "price": 4.50,
      "currency": "USD",
      "where_location": "Johannesburg",
      "when_available": "2025-12-01",
      "source_link": "https://example.com/product",
      "score": 95.5,
      "confidence_score": 0.92
    }
  ],
  "sahpra": {
    "verified": true,
    "company_name": "Your Pharmacy Ltd",
    "licence_no": "PHA-12345",
    "expiry_date": "2026-06-30"
  }
}
```

**Field Descriptions**:
- `product` (required): Product description
- `quantity` (optional): Desired quantity
- `unit` (optional): Unit of measurement
- `location` (optional): Delivery location
- `deliveryWindow` (optional): Start and end dates
- `budget` (optional): Maximum budget
- `currency` (optional): Currency code (ISO 4217)
- `notes` (optional): Additional notes (max 2000 chars)

---

#### POST /signals/:id/select

Select an option from signal results.

**Request**:
```http
POST /functions/v1/signals/550e8400-e29b-41d4-a716-446655440000/select
Authorization: Bearer sk_your_api_key
Content-Type: application/json

{
  "option_id": "opt_123"
}
```

**Response** (200 OK):
```json
{
  "selection": {
    "id": "sel_456",
    "signal_id": "550e8400-e29b-41d4-a716-446655440000",
    "option_id": "opt_123",
    "selected_at": "2025-11-20T10:35:00Z",
    "handoff_token": "tok_789",
    "handoff_status": "pending"
  },
  "message": "Option selected successfully"
}
```

---

### Matches

Create trade matches and confirm intent with compliance tracking.

#### POST /match

Record a match between buyer and seller with cryptographic proof.

**Request**:
```http
POST /functions/v1/match
Authorization: Bearer sk_your_api_key
Content-Type: application/json
Idempotency-Key: unique-key-123

{
  "buyer": {
    "id": "buyer_org_123",
    "name": "Buyer Pharmacy Ltd"
  },
  "seller": {
    "id": "seller_org_456",
    "name": "Commercial Supplier Inc"
  },
  "commodity": "Industrial Equipment Parts",
  "quantity": {
    "amount": 10000,
    "unit": "units"
  },
  "price": {
    "amount": 45000,
    "currency": "ZAR"
  },
  "terms": "Payment within 30 days, FOB Johannesburg"
}
```

**Response** (201 Created):
```json
{
  "match": {
    "id": "match_789",
    "org_id": "org_123",
    "buyer_id": "buyer_org_123",
    "buyer_name": "Commercial Buyer Ltd",
    "seller_id": "seller_org_456",
    "seller_name": "Commercial Supplier Inc",
    "commodity": "Industrial Equipment Parts",
    "quantity_amount": 10000,
    "quantity_unit": "units",
    "price_amount": 45000,
    "price_currency": "USD",
    "terms": "Payment within 30 days, FOB Johannesburg",
    "hash": "a1b2c3d4e5f6...",
    "status": "matched",
    "created_at": "2025-11-20T10:40:00Z",
    "settled_at": null
  },
  "message": "Match recorded with immutable hash"
}
```

**Hash Calculation**:
The SHA-256 hash includes: buyer.id, seller.id, commodity, quantity, price, and terms. This creates an immutable proof-of-intent.

---

#### POST /match/:id/settle

Confirm intent for a match. **This does not create any legal obligation** — it only signals interest so the seller can prepare final terms.

**Request**:
```http
POST /functions/v1/match/match_789/settle
Authorization: Bearer sk_your_api_key
```

**Response** (200 OK):
```json
{
  "id": "match_789",
  "status": "settled",
  "settled_at": "2025-11-20T11:00:00Z",
  "buyer_id": "buyer_org_123",
  "seller_id": "seller_org_456",
  "commodity": "Industrial Equipment Parts",
  "quantity_amount": 10000,
  "price_amount": 45000,
  "hash": "a1b2c3d4e5f6..."
}
```

**Important**: This action records interest only. It does not create a contract, payment obligation, or any legal commitment.

**Notes**:
- Idempotent: Calling multiple times returns the same result
- Creates immutable audit log entry
- Triggers `match.intent_confirmed` webhook event

---

### API Keys

Manage API keys (requires `api_keys:manage` scope).

#### POST /api-keys

Create a new API key.

**Request**:
```http
POST /functions/v1/api-keys
Authorization: Bearer current_api_key
Content-Type: application/json

{
  "name": "Production API Key",
  "scopes": ["signals:write", "match:write"],
  "expires_at": "2026-11-20T00:00:00Z"
}
```

**Response** (201 Created):
```json
{
  "id": "key_123",
  "name": "Production API Key",
  "key": "sk_1a2b3c4d5e6f7g8h9i0j",
  "scopes": ["signals:write", "match:write"],
  "expires_at": "2026-11-20T00:00:00Z",
  "created_at": "2025-11-20T10:00:00Z"
}
```

**Important**: The `key` field is only returned once. Store it securely.

---

#### GET /api-keys

List your API keys.

**Request**:
```http
GET /functions/v1/api-keys
Authorization: Bearer sk_your_api_key
```

**Response** (200 OK):
```json
{
  "data": [
    {
      "id": "key_123",
      "name": "Production API Key",
      "scopes": ["signals:write", "match:write"],
      "last_used_at": "2025-11-20T09:00:00Z",
      "expires_at": "2026-11-20T00:00:00Z",
      "created_at": "2025-11-20T10:00:00Z",
      "status": "active"
    }
  ]
}
```

**Note**: The actual key value is never returned in list responses.

---

#### DELETE /api-keys/:id

Revoke an API key.

**Request**:
```http
DELETE /functions/v1/api-keys/key_123
Authorization: Bearer sk_your_api_key
```

**Response** (204 No Content)

---

### Webhooks

Configure webhook endpoints to receive real-time event notifications.

#### POST /webhooks

Create a webhook endpoint.

**Request**:
```http
POST /functions/v1/webhooks
Authorization: Bearer sk_your_api_key
Content-Type: application/json

{
  "url": "https://your-domain.com/webhook",
  "events": ["match.created", "match.settled", "signal.created"],
  "secret": "your-secret-key-min-16-chars"
}
```

**Response** (201 Created):
```json
{
  "id": "wh_123",
  "url": "https://your-domain.com/webhook",
  "events": ["match.created", "match.settled", "signal.created"],
  "status": "active",
  "created_at": "2025-11-20T10:00:00Z",
  "message": "Webhook created with your secret"
}
```

**Notes**:
- If `secret` is omitted, one will be auto-generated and returned once
- Store the secret securely - it's used to verify webhook signatures

---

#### GET /webhooks

List your webhook endpoints.

**Request**:
```http
GET /functions/v1/webhooks
Authorization: Bearer sk_your_api_key
```

**Response** (200 OK):
```json
{
  "data": [
    {
      "id": "wh_123",
      "url": "https://your-domain.com/webhook",
      "events": ["match.created", "match.settled"],
      "status": "active",
      "last_delivery_at": "2025-11-20T09:30:00Z",
      "created_at": "2025-11-20T08:00:00Z"
    }
  ]
}
```

---

#### PATCH /webhooks/:id

Update a webhook endpoint.

**Request**:
```http
PATCH /functions/v1/webhooks/wh_123
Authorization: Bearer sk_your_api_key
Content-Type: application/json

{
  "events": ["match.created", "match.settled", "signal.selected"],
  "status": "active"
}
```

**Response** (200 OK):
```json
{
  "id": "wh_123",
  "url": "https://your-domain.com/webhook",
  "events": ["match.created", "match.settled", "signal.selected"],
  "status": "active",
  "updated_at": "2025-11-20T10:15:00Z"
}
```

---

#### DELETE /webhooks/:id

Delete a webhook endpoint.

**Request**:
```http
DELETE /functions/v1/webhooks/wh_123
Authorization: Bearer sk_your_api_key
```

**Response** (204 No Content)

---

### Data Sources

Manage data source connectors (marketplace, ERP, registry, etc.).

#### POST /data-sources

Register a new data source.

**Request**:
```http
POST /functions/v1/data-sources
Authorization: Bearer sk_your_api_key
Content-Type: application/json

{
  "name": "Main Marketplace",
  "type": "marketplace",
  "config": {
    "api_url": "https://marketplace.example.com/api",
    "api_key": "marketplace_key_123"
  }
}
```

**Response** (201 Created):
```json
{
  "id": "ds_123",
  "org_id": "org_123",
  "name": "Main Marketplace",
  "type": "marketplace",
  "status": "active",
  "created_at": "2025-11-20T10:00:00Z"
}
```

**Supported Types**:
- `marketplace` - Online marketplace integration
- `sheet` - Google Sheets / Excel
- `erp` - ERP system integration
- `registry` - Registry database
- `lab` - Laboratory system
- `web_search` - Web search results

---

#### GET /data-sources

List your data sources.

**Request**:
```http
GET /functions/v1/data-sources
Authorization: Bearer sk_your_api_key
```

**Response** (200 OK):
```json
{
  "data": [
    {
      "id": "ds_123",
      "name": "Main Marketplace",
      "type": "marketplace",
      "status": "active",
      "last_queried_at": "2025-11-20T09:00:00Z",
      "created_at": "2025-11-19T10:00:00Z"
    }
  ]
}
```

---

### Consents

Manage data sharing consents.

#### POST /consents

Grant consent for data source access.

**Request**:
```http
POST /functions/v1/consents
Authorization: Bearer sk_your_api_key
Content-Type: application/json

{
  "data_source_id": "ds_123",
  "scope": {
    "read_inventory": true,
    "read_pricing": true
  },
  "expires_at": "2026-11-20T00:00:00Z"
}
```

**Response** (201 Created):
```json
{
  "id": "consent_456",
  "org_id": "org_123",
  "data_source_id": "ds_123",
  "scope": {
    "read_inventory": true,
    "read_pricing": true
  },
  "granted_at": "2025-11-20T10:00:00Z",
  "expires_at": "2026-11-20T00:00:00Z"
}
```

---

#### DELETE /consents/:id

Revoke a consent.

**Request**:
```http
DELETE /functions/v1/consents/consent_456
Authorization: Bearer sk_your_api_key
```

**Response** (204 No Content)

---

### Organizations

Manage organizations (admin only).

#### GET /orgs

List all organizations (admin only).

**Request**:
```http
GET /functions/v1/orgs?limit=50&status=active
Authorization: Bearer sk_admin_api_key
```

**Response** (200 OK):
```json
{
  "data": [
    {
      "id": "org_123",
      "name": "Pharmacy Ltd",
      "status": "active",
      "sandbox_enabled": true,
      "created_at": "2025-10-01T10:00:00Z"
    }
  ]
}
```

---

#### PATCH /orgs/:id

Update organization details (admin only).

**Request**:
```http
PATCH /functions/v1/orgs/org_123
Authorization: Bearer sk_admin_api_key
Content-Type: application/json

{
  "sandbox_enabled": true,
  "status": "active"
}
```

**Response** (200 OK):
```json
{
  "id": "org_123",
  "name": "Pharmacy Ltd",
  "status": "active",
  "sandbox_enabled": true,
  "updated_at": "2025-11-20T10:00:00Z"
}
```

---

### Audit Logs

Query audit trail (read-only).

#### GET /audit-logs

Retrieve audit log entries.

**Request**:
```http
GET /functions/v1/audit-logs?limit=50&action=match.created&start_date=2025-11-01T00:00:00Z
Authorization: Bearer sk_your_api_key
```

**Query Parameters**:
- `limit` (optional): Max items to return (default: 50, max: 100)
- `offset` (optional): Pagination offset (default: 0)
- `action` (optional): Filter by action (e.g., "match.created")
- `entity_type` (optional): Filter by entity type (e.g., "match")
- `entity_id` (optional): Filter by specific entity ID
- `start_date` (optional): ISO 8601 timestamp
- `end_date` (optional): ISO 8601 timestamp

**Response** (200 OK):
```json
{
  "items": [
    {
      "id": "log_123",
      "org_id": "org_123",
      "actor_user_id": "user_456",
      "actor_api_key_id": null,
      "action": "match.created",
      "entity_type": "match",
      "entity_id": "match_789",
      "metadata": {
        "hash": "a1b2c3d4e5f6...",
        "buyer_id": "buyer_org_123",
        "seller_id": "seller_org_456",
        "commodity": "Industrial Equipment",
        "price_amount": 45000
      },
      "created_at": "2025-11-20T10:40:00Z"
    }
  ],
  "totalCount": 1,
  "limit": 50,
  "offset": 0,
  "filters": {
    "action": "match.created",
    "entity_type": null,
    "entity_id": null,
    "start_date": "2025-11-01T00:00:00Z",
    "end_date": null
  }
}
```

---

## Webhook Events

When webhook events occur, Trade.Izenzo sends POST requests to your configured endpoints.

### Event Format

```json
{
  "event": "match.created",
  "data": {
    "id": "match_789",
    "org_id": "org_123",
    "buyer_id": "buyer_org_123",
    "commodity": "Industrial Equipment",
    "created_at": "2025-11-20T10:40:00Z"
  },
  "timestamp": "2025-11-20T10:40:01Z",
  "orgId": "org_123"
}
```

### Signature Verification

Each webhook includes an `X-Webhook-Signature` header with HMAC-SHA256 signature:

```javascript
const crypto = require('crypto');

function verifyWebhook(payload, signature, secret) {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(payload);
  const expectedSignature = hmac.digest('hex');
  return signature === expectedSignature;
}
```

### Event Types

| Event | Description |
|-------|-------------|
| `match.created` | New match recorded |
| `match.intent_confirmed` | Intent confirmed for match (does not create legal obligation) |
| `signal.created` | New signal created |
| `signal.selected` | Option selected from signal |
| `api_key.created` | New API key generated |
| `api_key.revoked` | API key revoked |
| `webhook.created` | Webhook endpoint created |

### Retry Policy

Failed webhook deliveries are automatically retried:
- **Attempt 1**: Immediate
- **Attempt 2**: 5 minutes later
- **Attempt 3**: 30 minutes later
- **Attempt 4+**: 2 hours later (up to max_retries)

After exhausting retries, deliveries move to dead letter queue.

---

## Best Practices

### 1. Security

- **Never commit API keys** to version control
- **Rotate keys regularly** (set expiry dates)
- **Use HTTPS only** for all API calls
- **Verify webhook signatures** to prevent spoofing
- **Use scope-specific keys** (principle of least privilege)

### 2. Error Handling

```javascript
async function createSignal(data) {
  try {
    const response = await fetch('https://.../signals', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    });

    if (!response.ok) {
      const error = await response.json();
      console.error('API Error:', error);
      
      // Handle rate limiting
      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After');
        console.log(`Rate limited. Retry after ${retryAfter}s`);
        // Implement exponential backoff
      }
      
      throw new Error(error.message);
    }

    return await response.json();
  } catch (error) {
    // Network or parsing error
    console.error('Request failed:', error);
    throw error;
  }
}
```

### 3. Idempotency

Use idempotency keys for critical operations:

```javascript
const idempotencyKey = `match-${buyerId}-${sellerId}-${Date.now()}`;

await fetch('https://.../match', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${API_KEY}`,
    'Idempotency-Key': idempotencyKey,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(matchData)
});
```

### 4. Pagination

For large result sets, use pagination:

```javascript
let offset = 0;
const limit = 50;
let allLogs = [];

while (true) {
  const response = await fetch(
    `https://.../audit-logs?limit=${limit}&offset=${offset}`
  );
  const data = await response.json();
  
  allLogs = allLogs.concat(data.items);
  
  if (data.items.length < limit) break;
  offset += limit;
}
```

### 5. Monitoring

- **Track API usage** via analytics dashboard
- **Monitor audit logs** for suspicious activity
- **Set up alerts** for failed webhooks
- **Review rate limit headers** to avoid throttling

---

## Support

- **Documentation**: https://docs.trade.izenzo.com
- **Status Page**: https://status.trade.izenzo.com
- **API Changelog**: See `CHANGELOG.md` in repository

For additional support, contact your account manager or visit the developer portal.
