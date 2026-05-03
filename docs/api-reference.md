# Compliance Matching API Reference

**Current Version**: v1.5  
**Base URL**: `https://api.izenzo.co.za/functions/v1`  
**Last Updated**: 3 May 2026 (USD-native examples)

---

## Changelog

### v1.4 (2026-01-11)
- Added token metering with 1 token per billable API call
- Minimum token balance requirement of 5,000 tokens
- Low balance webhook notifications at 6,000, 5,500, and 5,001 tokens
- Added `token.low_balance` webhook event
- Confirm Intent now requires eligibility validation with clear denial reasons
- Added document verification workflow for matches

### v1.3 (2025-12-03)
- **BREAKING**: Renamed "Settle" to "Confirm Intent" throughout
- Added `intent.confirmed` webhook event (replaces `match.settled`, backward compatible)
- Added Behavioral Analytics for non-binding actions (skip, maybe_later, view)
- Improved security: restricted api_request_logs to admins/auditors only
- Added Coherence Engine documentation

### v1.2 (2025-12-02)
- Added health check endpoint
- Added rate limiting
- Added idempotency support

---

## Table of Contents

1. [Authentication](#authentication)
2. [Rate Limiting](#rate-limiting)
3. [Error Handling](#error-handling)
4. [Endpoints](#endpoints)
   - [Health Check](#health-check)
   - [Signals](#signals)
   - [Matches](#matches)
   - [Evidence Pack](#evidence-pack)
   - [Reputation](#reputation)
   - [API Keys](#api-keys)
   - [Webhooks](#webhooks)
   - [Data Sources](#data-sources)
   - [Consents](#consents)
   - [Organisations](#organisations)
   - [Audit Logs](#audit-logs)
5. [Webhook Events](#webhook-events)
6. [Best Practices](#best-practices)
7. [Security Features](#security-features)
8. [Breaking Changes](#breaking-changes)

---

## Authentication

All API requests (except `/healthz`) require authentication using **API keys**.

### API Key Authentication

Include your API key in the `X-API-Key` header:

```http
X-API-Key: sk_your_api_key_here
```

### Getting an API Key

1. Sign up at the developer portal
2. Navigate to Dashboard → API Keys
3. Create a new API key with appropriate scopes
4. Copy and securely store your key (shown only once)

### Scopes

API keys support scope-based access control:

| Scope | Description |
|-------|-------------|
| `signals:read` | Read signals |
| `signals:write` | Create and manage signals |
| `match:read` | Read matches |
| `match:write` | Create matches and confirm intent |
| `webhooks:read` | View webhook endpoints |
| `webhooks:write` | Manage webhook endpoints |
| `data_sources:read` | View data sources |
| `data_sources:write` | Manage data sources |
| `consents:read` | View consents |
| `consents:write` | Grant and revoke consents |
| `audit_logs:read` | View audit logs |
| `api_keys:manage` | Manage API keys |

---

## Token Metering

All billable API endpoints consume **1 token per call**. Your organisation must maintain a **minimum balance of 5,000 tokens** to make API calls.

### Billable Endpoints

| Endpoint | Tokens |
|----------|--------|
| `/signals` | 1 token |
| `/search` | 1 token |
| `/match` | 1 token |
| `/sr-discover` | 1 token |

### Non-Billable Endpoints

The following endpoints do not consume tokens:
- `/healthz` - Health check
- `/api-keys` - API key management
- `/webhooks` - Webhook management
- `/audit-logs` - Audit log queries
- `/evidence-pack` - Evidence pack generation
- `/consents` - Consent management
- `/data-sources` - Data source management

### Insufficient Balance Response (HTTP 402)

```json
{
  "code": "INSUFFICIENT_TOKENS",
  "message": "Insufficient token balance. Current: 4500, Required minimum: 5000",
  "requestId": "123e4567-e89b-12d3-a456-426614174000",
  "details": {
    "currentBalance": 4500,
    "minimumRequired": 5000,
    "endpoint": "signals"
  }
}
```

### Low Balance Webhooks

When your token balance crosses warning thresholds, a `token.low_balance` webhook is triggered:

| Threshold | Urgency |
|-----------|---------|
| 6,000 tokens | Warning |
| 5,500 tokens | Urgent |
| 5,001 tokens | Critical |

See [Webhook Events](#webhook-events) for payload format.

---

## Rate Limiting

Rate limits are enforced per organisation and per endpoint.

**Default Limits**:

| Endpoint | Limit |
|----------|-------|
| Signals | 100 requests / minute |
| Matches | 50 requests / minute |
| Evidence Pack | 30 requests / minute |
| Other endpoints | 60 requests / minute |

**Response Headers**:
```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1637251200
```

**Rate Limit Exceeded Response** (HTTP 429):
```json
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
| `ENGAGEMENT_PENDING` | 409 | POI mint blocked — counterparty has not yet accepted the engagement hold-point. Wait for `engagement.accepted` event or surface the hold-point tracker to the user. |
| `DISPUTE_ACTIVE` | 409 | Commercial mutation blocked — an active dispute exists on the match. Only the raising organisation can resolve the dispute. |
| `WEBHOOK_REPLAY` | 409 | Inbound webhook (e.g. Resend, auth-email-hook) was rejected as a replay by `assertNotReplayed` against the `webhook_replay_guard` ledger. Stable, deterministic — safe to treat as success on the sender side. |
| `RATE_LIMIT_EXCEEDED` | 429 | Too many requests. Honour `Retry-After` header. |
| `INSUFFICIENT_TOKENS` | 402 | Token balance below minimum |
| `ELIGIBILITY_FAILED` | 422 | Confirm Intent eligibility check failed |
| `AUDIT_LOG_ERROR` | 500 | Failed to create audit trail |
| `INTERNAL_ERROR` | 500 | Server error |
| `DATABASE_ERROR` | 500 | Database operation failed |

> **Subject-line contract:** All outbound email and Slack notifications produced by edge functions (`poi-engagements`, `lifecycle-scheduler`, `send-team-invite`, `notification-dispatch`) pass through `clampSubject()` from `supabase/functions/_shared/email-subject.ts`. Subjects are hard-clamped to **200 characters** while preserving the trailing trace tail (request id / org id). Free-text fields (commodity, organisation name, inviter name) are never concatenated raw into a subject line.

---

## Endpoints

### Health Check

Check system health and status. **No authentication required.**

#### GET /healthz

Returns comprehensive health status of all system components.

**Request**:
```http
GET /functions/v1/healthz
```

**Response** (200 OK / 207 Degraded / 503 Unhealthy):
```json
{
  "status": "healthy",
  "timestamp": "2025-12-02T10:30:00.000Z",
  "totalResponseTime": "250ms",
  "checks": [
    {
      "name": "database",
      "status": "healthy",
      "message": "Database connection successful",
      "responseTime": 45
    },
    {
      "name": "auth_system",
      "status": "healthy",
      "message": "Auth system operational",
      "responseTime": 30
    },
    {
      "name": "api_keys_table",
      "status": "healthy",
      "message": "25 active API keys",
      "responseTime": 20,
      "details": { "activeKeys": 25 }
    },
    {
      "name": "signals_table",
      "status": "healthy",
      "message": "150 total signals",
      "responseTime": 25,
      "details": { "totalSignals": 150 }
    },
    {
      "name": "matches_table",
      "status": "healthy",
      "message": "75 total matches",
      "responseTime": 22,
      "details": { "totalMatches": 75 }
    },
    {
      "name": "api_performance",
      "status": "healthy",
      "message": "45 requests in last minute",
      "responseTime": 100,
      "details": {
        "requestsLastMinute": 45,
        "errorRate": "2.2%",
        "avgResponseTime": "180ms"
      }
    },
    {
      "name": "webhook_system",
      "status": "healthy",
      "message": "10 active webhooks",
      "responseTime": 8,
      "details": { "activeWebhooks": 10 }
    }
  ],
  "summary": {
    "healthy": 7,
    "degraded": 0,
    "unhealthy": 0,
    "total": 7
  }
}
```

**Status Codes**:
- `200` - All systems healthy
- `207` - Some systems degraded
- `503` - Critical systems unhealthy

---

### Signals

Create and manage buyer/seller intent signals.

#### POST /signals

Create a new signal to express buying or selling intent.

**Required Scope**: `signals:write`

**Request**:
```http
POST /functions/v1/signals
X-API-Key: sk_your_api_key
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
  "currency": "USD",
  "notes": "Urgent order for December"
}
```

**Request Fields**:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `product` | string | Yes | Product description (max 500 chars) |
| `quantity` | number | No | Desired quantity |
| `unit` | string | No | Unit of measurement |
| `location` | string | No | Delivery location |
| `deliveryWindow` | object | No | Start and end dates |
| `budget` | number | No | Maximum budget |
| `currency` | string | No | Currency code (ISO 4217) |
| `notes` | string | No | Additional notes (max 2000 chars) |

**Response** (201 Created):
```json
{
  "signalId": "550e8400-e29b-41d4-a716-446655440000",
  "options": []
}
```

**Note**: Options are populated asynchronously. Use `GET /signals/:id` to retrieve matched options.

---

#### GET /signals

List your signals.

**Required Scope**: `signals:read`

**Request**:
```http
GET /functions/v1/signals?limit=50&status=active
X-API-Key: sk_your_api_key
```

**Query Parameters**:

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | number | 50 | Maximum results (1-100) |
| `status` | string | - | Filter by status: `active`, `matched`, `expired` |

**Response** (200 OK):
```json
{
  "data": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "org_id": "org_123",
      "type": "buyer",
      "content": {
        "product": "Industrial Equipment Parts",
        "quantity": 10000,
        "unit": "units"
      },
      "status": "active",
      "created_at": "2025-12-02T10:30:00Z",
      "expires_at": "2025-12-15T00:00:00Z"
    }
  ]
}
```

---

#### GET /signals/:id

Get a signal with its matched options.

**Required Scope**: `signals:read`

**Request**:
```http
GET /functions/v1/signals/550e8400-e29b-41d4-a716-446655440000
X-API-Key: sk_your_api_key
```

**Response** (200 OK):
```json
{
  "signal": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "org_id": "org_123",
    "type": "buyer",
    "content": {
      "product": "Industrial Equipment Parts",
      "quantity": 10000,
      "unit": "units"
    },
    "status": "active",
    "created_at": "2025-12-02T10:30:00Z"
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
      "confidence_score": 0.92,
      "data_source": {
        "name": "Primary Supplier",
        "type": "api"
      }
    }
  ]
}
```

---

#### GET /signals/:id/status

Get signal status and search progress.

**Required Scope**: `signals:read`

**Request**:
```http
GET /functions/v1/signals/550e8400-e29b-41d4-a716-446655440000/status
X-API-Key: sk_your_api_key
```

**Response** (200 OK):
```json
{
  "signalId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "active",
  "type": "buyer",
  "createdAt": "2025-12-02T10:30:00Z",
  "expiresAt": "2025-12-15T00:00:00Z",
  "updatedAt": "2025-12-02T10:35:00Z",
  "optionsCount": 5,
  "searchComplete": true
}
```

---

#### POST /signals/:id/select

Select an option from signal results.

**Required Scope**: `signals:write`

**Request**:
```http
POST /functions/v1/signals/550e8400-e29b-41d4-a716-446655440000/select
X-API-Key: sk_your_api_key
Content-Type: application/json

{
  "option_id": "opt_123"
}
```

**Response** (200 OK):
```json
{
  "selection_id": "sel_456",
  "handoff_token": "tok_789abc",
  "handoff_url": "https://supplier.example.com/order/123",
  "message": "Option selected. Handoff to source system."
}
```

---

#### DELETE /signals/:id

Cancel a signal.

**Required Scope**: `signals:write`

**Request**:
```http
DELETE /functions/v1/signals/550e8400-e29b-41d4-a716-446655440000
X-API-Key: sk_your_api_key
```

**Response** (204 No Content)

---

### Matches

Create trade matches and confirm intent with cryptographic proof.

> **Key Concept**: Only the **Confirm Intent** action (`POST /match/:id/settle`) creates audit/evidence records. All other interactions (viewing, browsing, skipping) are non-binding exploration actions that do NOT create any records.

#### POST /match

Record a match between buyer and seller with cryptographic proof.

**Required Scope**: `match:write`

**Request**:
```http
POST /functions/v1/match
X-API-Key: sk_your_api_key
Content-Type: application/json
Idempotency-Key: unique-key-123

{
  "buyer": {
    "id": "buyer_org_123",
    "name": "Buyer Company Ltd"
  },
  "seller": {
    "id": "seller_org_456",
    "name": "Supplier Inc"
  },
  "commodity": "Industrial Equipment Parts",
  "quantity": {
    "amount": 10000,
    "unit": "units"
  },
  "price": {
    "amount": 45000,
    "currency": "USD"
  },
  "terms": "Payment within 30 days, FOB Johannesburg",
  "metadata": {
    "po_number": "PO-2025-001",
    "priority": "high"
  }
}
```

**Request Fields**:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `buyer.id` | string | Yes | Buyer organisation ID |
| `buyer.name` | string | Yes | Buyer organisation name |
| `seller.id` | string | Yes | Seller organisation ID |
| `seller.name` | string | Yes | Seller organisation name |
| `commodity` | string | Yes | Product/service description |
| `quantity.amount` | number | Yes | Quantity amount |
| `quantity.unit` | string | Yes | Unit of measurement |
| `price.amount` | number | Yes | Price amount |
| `price.currency` | string | Yes | Currency code (ISO 4217) |
| `terms` | string | No | Terms and conditions |
| `metadata` | object | No | Additional metadata |

**Response** (201 Created):
```json
{
  "id": "match_789",
  "org_id": "org_123",
  "buyer_id": "buyer_org_123",
  "buyer_name": "Buyer Company Ltd",
  "seller_id": "seller_org_456",
  "seller_name": "Supplier Inc",
  "commodity": "Industrial Equipment Parts",
  "quantity_amount": 10000,
  "quantity_unit": "units",
  "price_amount": 45000,
  "price_currency": "USD",
  "terms": "Payment within 30 days, FOB Johannesburg",
  "hash": "a1b2c3d4e5f6789...",
  "status": "matched",
  "created_at": "2025-12-02T10:40:00Z",
  "settled_at": null
}
```

**Hash Calculation**: SHA-256 of buyer, seller, commodity, quantity, price, and terms.

**Special Headers**:
- `X-Match-Duplicate: true` - Returned if match already exists with same hash
- `X-Idempotent-Replay: true` - Returned if using cached idempotency response

---

#### GET /match

List your matches.

**Required Scope**: `match:read`

**Request**:
```http
GET /functions/v1/match?limit=50&status=matched&commodity=equipment
X-API-Key: sk_your_api_key
```

**Query Parameters**:

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | number | 50 | Maximum results |
| `offset` | number | 0 | Pagination offset |
| `status` | string | - | Filter: `matched`, `settled` |
| `commodity` | string | - | Search commodity (partial match) |
| `commodity_type` | string | - | Filter by metadata commodity_type |

**Response** (200 OK):
```json
{
  "items": [
    {
      "id": "match_789",
      "commodity": "Industrial Equipment Parts",
      "status": "matched",
      "hash": "a1b2c3d4...",
      "created_at": "2025-12-02T10:40:00Z"
    }
  ],
  "totalCount": 25
}
```

---

#### GET /match/:id

Get a specific match.

**Required Scope**: `match:read`

**Request**:
```http
GET /functions/v1/match/match_789
X-API-Key: sk_your_api_key
```

**Response** (200 OK):
```json
{
  "id": "match_789",
  "org_id": "org_123",
  "buyer_id": "buyer_org_123",
  "buyer_name": "Buyer Company Ltd",
  "seller_id": "seller_org_456",
  "seller_name": "Supplier Inc",
  "commodity": "Industrial Equipment Parts",
  "quantity_amount": 10000,
  "quantity_unit": "units",
  "price_amount": 45000,
  "price_currency": "USD",
  "hash": "a1b2c3d4...",
  "status": "matched",
  "created_at": "2025-12-02T10:40:00Z",
  "settled_at": null
}
```

---

#### POST /match/:id/settle

**Confirm Intent** for a match. 

> ⚠️ **Important**: This action signals serious interest to the seller so they can prepare final terms. **It does NOT create any contract, payment, or legal obligation.** This is the only action that creates an immutable audit/evidence record.

**Required Scope**: `match:write`

**Request**:
```http
POST /functions/v1/match/match_789/settle
X-API-Key: sk_your_api_key
```

**Response** (200 OK):
```json
{
  "id": "match_789",
  "status": "settled",
  "settled_at": "2025-12-02T11:00:00Z",
  "buyer_id": "buyer_org_123",
  "seller_id": "seller_org_456",
  "commodity": "Industrial Equipment Parts",
  "hash": "a1b2c3d4..."
}
```

**Notes**:
- **Idempotent**: Calling multiple times returns the same result
- **Not a contract**: This action only records interest - no payment or legal obligation
- Creates immutable audit log entry with cryptographic proof
- Triggers `intent.confirmed` webhook event (also `match.settled` for backward compatibility)
- **Only "Confirm Intent" creates evidence records** - all other actions (skip, maybe later, etc.) are non-binding behavioral signals

### Eligibility Requirements

Before Confirm Intent can proceed, the match must pass eligibility validation. All required fields must be present and unambiguous:

| Field | Requirement |
|-------|-------------|
| `buyer_id` | Must be a non-empty string |
| `buyer_name` | Must be a non-empty string |
| `seller_id` | Must be a non-empty string |
| `seller_name` | Must be a non-empty string |
| `commodity` | Must be a non-empty string |
| `quantity_amount` | Must be a positive number |
| `quantity_unit` | Must be a non-empty string |
| `price_amount` | Must be a positive number |
| `price_currency` | Must be a valid 3-letter currency code |

**Eligibility Failure Response (HTTP 422)**:
```json
{
  "code": "ELIGIBILITY_FAILED",
  "message": "Match does not meet eligibility requirements for Confirm Intent",
  "requestId": "123e4567-e89b-12d3-a456-426614174000",
  "details": {
    "eligible": false,
    "denialReasons": [
      "Missing required field: quantity_amount",
      "Invalid field: price_currency must be a valid 3-letter currency code"
    ],
    "checkedFields": ["buyer_id", "buyer_name", "seller_id", "seller_name", "commodity", "quantity_amount", "quantity_unit", "price_amount", "price_currency"],
    "passedFields": ["buyer_id", "buyer_name", "seller_id", "seller_name", "commodity"],
    "failedFields": ["quantity_amount", "price_currency"]
  }
}
```

---

### Action Types: Confirm vs. Exploration

| Action | Creates Records? | Creates Evidence? | Legal Meaning |
|--------|-----------------|-------------------|---------------|
| **Confirm Intent** | ✅ Yes | ✅ Yes | Signals serious interest (no contract/payment) |
| Skip / Not Now | ❌ No | ❌ No | No meaning - exploration only |
| Maybe Later | ❌ No | ❌ No | No meaning - exploration only |
| Browse / View | ❌ No | ❌ No | No meaning - exploration only |

---

### Evidence Pack

Generate cryptographic proof packages for compliance and audit purposes.

#### GET /evidence-pack/:matchId

Generate a complete evidence pack for a match.

**Required Scope**: `match:read`

**Request**:
```http
GET /functions/v1/evidence-pack/match_789
X-API-Key: sk_your_api_key
```

**Response** (200 OK):
```json
{
  "metadata": {
    "packId": "pack_abc123",
    "generatedAt": "2025-12-02T12:00:00Z",
    "generatedBy": "user_123",
    "requestId": "req_xyz"
  },
  "match": {
    "id": "match_789",
    "hash": "a1b2c3d4...",
    "status": "settled",
    "createdAt": "2025-12-02T10:40:00Z",
    "settledAt": "2025-12-02T11:00:00Z",
    "buyer": {
      "id": "buyer_org_123",
      "name": "Buyer Company Ltd"
    },
    "seller": {
      "id": "seller_org_456",
      "name": "Supplier Inc"
    },
    "commodity": "Industrial Equipment Parts",
    "quantity": { "amount": 10000, "unit": "units" },
    "price": { "amount": 45000, "currency": "USD" },
    "terms": "Payment within 30 days"
  },
  "timeline": {
    "events": [
      {
        "id": "evt_1",
        "event_type": "match.created",
        "created_at": "2025-12-02T10:40:00Z",
        "payload_hash": "hash1...",
        "previous_event_hash": null
      },
      {
        "id": "evt_2",
        "event_type": "intent.confirmed",
        "created_at": "2025-12-02T11:00:00Z",
        "payload_hash": "hash2...",
        "previous_event_hash": "hash1..."
      }
    ],
    "totalEvents": 2
  },
  "hashChainVerification": {
    "valid": true,
    "details": [
      {
        "eventId": "evt_1",
        "index": 0,
        "valid": true,
        "hash": "hash1...",
        "expectedPreviousHash": null,
        "actualPreviousHash": null
      }
    ]
  },
  "auditTrail": {
    "logs": [...],
    "totalLogs": 3
  },
  "verification": {
    "matchHashAlgorithm": "SHA-256",
    "eventHashAlgorithm": "SHA-256",
    "chainIntegrity": "VERIFIED",
    "immutabilityGuarantee": "All events are cryptographically linked"
  }
}
```

**Response Headers**:
```http
Content-Disposition: attachment; filename="evidence-pack-match_789.json"
```

---

### Reputation

Calculate and retrieve organisation reputation scores.

#### POST /calculate-reputation

Calculate reputation score for an organisation.

**Request**:
```http
POST /functions/v1/calculate-reputation
Content-Type: application/json

{
  "orgId": "org_123"
}
```

**Response** (200 OK):
```json
{
  "success": true,
  "reputation": {
    "overallScore": 85.5,
    "level": "gold",
    "reliability": 90.0,
    "responsiveness": 80.0,
    "completion": 85.0
  }
}
```

**Reputation Levels**:

| Level | Requirements |
|-------|-------------|
| `platinum` | 100+ matches, 90%+ score |
| `gold` | 50+ matches, 80%+ score |
| `silver` | 25+ matches, 70%+ score |
| `bronze` | 10+ matches, 60%+ score |
| `new` | Default for new organisations |

---

### API Keys

Manage API keys. Requires `api_keys:manage` scope.

#### POST /api-keys

Create a new API key.

**Request**:
```http
POST /functions/v1/api-keys
X-API-Key: sk_your_api_key
Content-Type: application/json

{
  "name": "Production API Key",
  "scopes": ["signals:write", "match:write"],
  "expires_at": "2026-12-02T00:00:00Z"
}
```

**Response** (201 Created):
```json
{
  "id": "key_123",
  "name": "Production API Key",
  "key": "sk_1a2b3c4d5e6f7g8h9i0j",
  "scopes": ["signals:write", "match:write"],
  "expires_at": "2026-12-02T00:00:00Z",
  "created_at": "2025-12-02T10:00:00Z"
}
```

**Important**: The `key` field is only shown once. Store it securely.

---

#### GET /api-keys

List your API keys.

**Response** (200 OK):
```json
{
  "data": [
    {
      "id": "key_123",
      "name": "Production API Key",
      "scopes": ["signals:write", "match:write"],
      "status": "active",
      "last_used_at": "2025-12-02T09:00:00Z",
      "expires_at": "2026-12-02T00:00:00Z",
      "created_at": "2025-12-02T10:00:00Z"
    }
  ]
}
```

---

#### DELETE /api-keys/:id

Revoke an API key.

**Response** (204 No Content)

---

### Webhooks

Configure webhook endpoints for real-time event notifications.

#### POST /webhooks

Create a webhook endpoint.

**Required Scope**: `webhooks:write`

**Request**:
```http
POST /functions/v1/webhooks
X-API-Key: sk_your_api_key
Content-Type: application/json

{
  "url": "https://your-domain.com/webhook",
  "events": ["match.created", "intent.confirmed", "signal.created"],
  "secret": "your-secret-key-min-16-chars"
}
```

**Response** (201 Created):
```json
{
  "id": "wh_123",
  "url": "https://your-domain.com/webhook",
  "events": ["match.created", "intent.confirmed", "signal.created"],
  "status": "active",
  "created_at": "2025-12-02T10:00:00Z"
}
```

---

#### GET /webhooks

List webhook endpoints.

**Required Scope**: `webhooks:read`

**Response** (200 OK):
```json
{
  "data": [
    {
      "id": "wh_123",
      "url": "https://your-domain.com/webhook",
      "events": ["match.created", "match.settled"],
      "status": "active",
      "last_delivery_at": "2025-12-02T09:30:00Z"
    }
  ]
}
```

---

#### PATCH /webhooks/:id

Update a webhook endpoint.

**Required Scope**: `webhooks:write`

**Request**:
```http
PATCH /functions/v1/webhooks/wh_123
Authorization: Bearer sk_your_api_key
Content-Type: application/json

{
  "events": ["match.created", "match.settled", "option.selected"],
  "status": "active"
}
```

---

#### DELETE /webhooks/:id

Delete a webhook endpoint.

**Required Scope**: `webhooks:write`

**Response** (204 No Content)

---

### Data Sources

Manage data source connectors.

#### POST /data-sources

Register a new data source.

**Required Scope**: `data_sources:write`

**Request**:
```http
POST /functions/v1/data-sources
Authorization: Bearer sk_your_api_key
Content-Type: application/json

{
  "name": "Primary Supplier API",
  "type": "api",
  "config": {
    "endpoint": "https://supplier.example.com/api",
    "auth_type": "bearer"
  }
}
```

---

#### GET /data-sources

List data sources.

**Required Scope**: `data_sources:read`

---

### Consents

Manage data sharing consents.

#### POST /consents

Grant consent for data access.

**Required Scope**: `consents:write`

**Request**:
```http
POST /functions/v1/consents
Authorization: Bearer sk_your_api_key
Content-Type: application/json

{
  "data_source_id": "ds_123",
  "scope": {
    "read": true,
    "write": false
  },
  "expires_at": "2026-12-02T00:00:00Z"
}
```

---

#### DELETE /consents/:id

Revoke a consent.

**Required Scope**: `consents:write`

**Response** (204 No Content)

---

### Organisations

Manage organisations (admin only).

#### GET /orgs

List all organisations.

**Required Role**: `admin`

---

#### PATCH /orgs/:id

Update an organisation.

**Required Role**: `admin`

---

### Audit Logs

Retrieve audit trail entries.

#### GET /audit-logs

Query audit logs with filters.

**Required Scope**: `audit_logs:read`

**Request**:
```http
GET /functions/v1/audit-logs?limit=100&action=match.created&startDate=2025-12-01
Authorization: Bearer sk_your_api_key
```

**Query Parameters**:

| Parameter | Type | Description |
|-----------|------|-------------|
| `limit` | number | Maximum results (default: 100) |
| `offset` | number | Pagination offset |
| `action` | string | Filter by action type |
| `entityType` | string | Filter by entity type |
| `entityId` | string | Filter by entity ID |
| `startDate` | string | Filter from date (ISO 8601) |
| `endDate` | string | Filter to date (ISO 8601) |

**Response** (200 OK):
```json
{
  "logs": [
    {
      "id": "log_123",
      "action": "match.created",
      "entity_type": "match",
      "entity_id": "match_789",
      "metadata": { "hash": "a1b2c3..." },
      "created_at": "2025-12-02T10:40:00Z"
    }
  ],
  "total": 150,
  "limit": 100,
  "offset": 0
}
```

---

## Webhook Events

### Event Format

```json
{
  "event": "match.created",
  "timestamp": "2025-12-02T10:40:00Z",
  "data": {
    "matchId": "match_789",
    "commodity": "Industrial Equipment Parts"
  }
}
```

### Available Events

| Event | Description |
|-------|-------------|
| `signal.created` | New signal created |
| `option.selected` | Option selected from signal |
| `match.created` | New match recorded |
| `match.settled` | Match intent confirmed |
| `intent.confirmed` | Match intent confirmed (alias for match.settled) |
| `intent.received` | Counterparty received intent notification |
| `token.low_balance` | Organisation token balance crossed warning threshold |

### Token Low Balance Event

Triggered when your organisation's token balance crosses a warning threshold (6,000, 5,500, or 5,001 tokens):

```json
{
  "event": "token.low_balance",
  "timestamp": "2026-01-11T10:30:00Z",
  "orgId": "org_123",
  "data": {
    "currentBalance": 5500,
    "threshold": 5500,
    "minimumRequired": 5000,
    "urgency": "urgent",
    "message": "Your token balance is running low. Top up soon to avoid service interruption.",
    "topUpUrl": "https://dashboard.example.com/billing"
  }
}
```

**Urgency Levels**:
- `warning` (6,000 tokens): "Your token balance is getting low. Consider topping up."
- `urgent` (5,500 tokens): "Your token balance is running low. Top up soon to avoid service interruption."
- `critical` (5,001 tokens): "CRITICAL: Your token balance is nearly depleted. Top up immediately to maintain service."

### Signature Verification

Verify webhook authenticity using HMAC-SHA256:

**Node.js**:
```javascript
const crypto = require('crypto');

function verifyWebhook(payload, signature, secret) {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  );
}
```

**Python**:
```python
import hmac
import hashlib

def verify_webhook(payload: bytes, signature: str, secret: str) -> bool:
    expected = hmac.new(
        secret.encode(),
        payload,
        hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(signature, expected)
```

### Retry Policy

| Attempt | Delay |
|---------|-------|
| 1 | Immediate |
| 2 | 5 minutes |
| 3 | 30 minutes |
| 4 | 2 hours |

After 4 failed attempts, events are moved to dead letter queue.

---

## Best Practices

### Security

1. **Store API keys securely** - Use environment variables, never commit to code
2. **Use HTTPS only** - All API calls must use TLS
3. **Verify webhook signatures** - Always validate incoming webhooks
4. **Rotate keys regularly** - Set expiry dates and rotate before expiration
5. **Use minimal scopes** - Only request permissions you need

### Error Handling

```javascript
try {
  const response = await fetch(url, options);
  
  if (response.status === 429) {
    const retryAfter = response.headers.get('Retry-After');
    await sleep(retryAfter * 1000);
    return retry();
  }
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(`${error.code}: ${error.message}`);
  }
  
  return await response.json();
} catch (error) {
  console.error('API Error:', error);
  throw error;
}
```

### Idempotency

Always use `Idempotency-Key` header for POST requests:

```http
POST /functions/v1/match
Idempotency-Key: order-12345-attempt-1
```

### Pagination

Use `limit` and `offset` for large result sets:

```http
GET /functions/v1/match?limit=50&offset=100
```

---

## Security Features

### Cryptographic Hashing

- All matches include SHA-256 hash of trade details
- Hash chain provides tamper-evident audit trail
- Evidence packs verify hash chain integrity

### Row-Level Security (RLS)

- All data is organisation-scoped
- Users can only access their organisation's data
- Admin functions require admin role

### API Key Security

- Keys are hashed before storage (never stored in plaintext)
- Automatic expiry warnings 7 days before expiration
- Automatic key disabling on expiration

### Input Validation

- All inputs validated with Zod schemas
- Strict type checking on all fields
- Maximum length limits enforced

---

## Breaking Changes

### v1.2 (2025-12-02)

- **Evidence Pack**: New endpoint for compliance proof generation
- **Health Check**: Expanded to include all system components
- **Input Validation**: Stricter validation on all endpoints

### v1.1 (2025-11-20)

- **API Key Expiry**: Keys now support expiration dates
- **Webhook Retry**: Automatic retry with exponential backoff
- **Rate Limiting**: Per-endpoint rate limits introduced

### v1.0 (2025-11-10)

- Initial release

---

## Support

- **Documentation**: [docs.trade-izenzo.com](https://docs.trade-izenzo.com)
- **API Status**: Check `/healthz` endpoint
- **Support**: support@izenzo.co.za
