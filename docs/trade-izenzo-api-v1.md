# Compliance Matching API v1 Documentation

## Overview

**Compliance Matching API** is a generic, sector-agnostic backend service that records trade "matches" between buyers and sellers and returns cryptographic proof records. It is completely decoupled from any specific marketplace or frontend.

### What it does
- Records trade agreements (matches) with full details
- Generates SHA-256 cryptographic proofs for each match
- Allows matches to be marked as "settled"
- Provides lookup and listing capabilities
- Maintains an immutable audit trail

### What it doesn't do
- Match buyers with sellers (this happens in your marketplace/app)
- Handle payments or logistics
- Store proprietary data long-term
- Implement sector-specific business logic

---

## Core Concepts

### Match Record
A **match** represents a trade agreement that has been made. Each match includes:

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Unique identifier |
| `created_at` | Timestamp | When the match was recorded |
| `status` | String | Either `matched` or `settled` |
| `hash` | String | SHA-256 hash of canonical match data |
| `buyer_id` | String | Buyer's system ID |
| `buyer_name` | String | Buyer's display name |
| `seller_id` | String | Seller's system ID |
| `seller_name` | String | Seller's display name |
| `commodity` | String | Product or service being traded |
| `quantity_amount` | Number | Quantity amount |
| `quantity_unit` | String | Unit (kg, tons, liters, etc.) |
| `price_amount` | Number | Price amount |
| `price_currency` | String | Currency code (EUR, USD, etc.) |
| `terms` | String | Commercial terms in plain text |
| `metadata` | JSONB | Optional extra fields (region, channel, notes) |
| `settled_at` | Timestamp | When the match was settled (if applicable) |

### Cryptographic Proof
Every match generates a tamper-evident proof:
1. Canonical JSON is constructed from match data
2. SHA-256 hash is computed
3. Hash is stored with the match record
4. Anyone can verify the match by recomputing the hash

This provides an independent, verifiable record of the agreement.

---

## Authentication

All endpoints require an API key in the `X-API-Key` header:

```bash
X-API-Key: sk_your_api_key_here
```

To obtain an API key, sign up at the dashboard or use the `/api-keys` endpoint with JWT authentication.

---

## API Endpoints

### Base URL
```
https://api.trade.izenzo.co.za/functions/v1
```

---

### POST /match

**Create a new match** and return proof record.

#### Request Body Examples

**Hemp Biomass Trade:**
```json
{
  "buyer": { "id": "BUYER123", "name": "GreenTech Industries" },
  "seller": { "id": "SELLER456", "name": "BioFarm Cooperative" },
  "commodity": "Hemp Biomass",
  "quantity": { "amount": 1000, "unit": "kg" },
  "price": { "amount": 50000, "currency": "EUR" },
  "terms": "Delivery within 30 days, payment on delivery",
  "metadata": {
    "commodity_type": "hemp_cannabis",
    "region": "EU-Africa",
    "channel": "izenzo platform"
  }
}
```

**Steel Coils Trade:**
```json
{
  "buyer": { "id": "CONST789", "name": "BuildCo Construction" },
  "seller": { "id": "STEEL101", "name": "Arcelor Steel Mills" },
  "commodity": "Hot-Rolled Steel Coils",
  "quantity": { "amount": 50, "unit": "tonnes" },
  "price": { "amount": 125000, "currency": "USD" },
  "terms": "FOB Shanghai, 60 days credit",
  "metadata": {
    "commodity_type": "steel",
    "grade": "HRC-A36",
    "region": "Asia-Pacific"
  }
}
```

**Aviation Fuel Trade:**
```json
{
  "buyer": { "id": "AERO202", "name": "SkyHigh Airlines" },
  "seller": { "id": "FUEL303", "name": "Global Energy Traders" },
  "commodity": "Jet A-1 Aviation Fuel",
  "quantity": { "amount": 10000, "unit": "barrels" },
  "price": { "amount": 950000, "currency": "USD" },
  "terms": "Delivery to JFK Airport, immediate payment",
  "metadata": {
    "commodity_type": "fuel",
    "grade": "Jet A-1",
    "region": "North America"
  }
}
```

**SaaS License Trade:**
```json
{
  "buyer": { "id": "CORP404", "name": "Enterprise Solutions Inc" },
  "seller": { "id": "SAAS505", "name": "CloudTech Software" },
  "commodity": "Enterprise CRM Platform - Annual License",
  "quantity": { "amount": 500, "unit": "seats" },
  "price": { "amount": 75000, "currency": "USD" },
  "terms": "12-month subscription, quarterly billing",
  "metadata": {
    "commodity_type": "saas",
    "tier": "enterprise",
    "region": "Global"
  }
}
```

#### Required Fields
- `buyer.id`, `buyer.name`
- `seller.id`, `seller.name`
- `commodity`
- `quantity.amount`, `quantity.unit`
- `price.amount`, `price.currency`

#### Optional Fields
- `terms` (string)
- `metadata` (object)

#### Response (201 Created)
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "created_at": "2025-01-10T12:00:00.000Z",
  "status": "matched",
  "hash": "a3b2c1d4e5f6789...",
  "buyer_id": "BUYER123",
  "buyer_name": "Example Buyer Ltd",
  "seller_id": "SELLER456",
  "seller_name": "Example Seller Ltd",
  "commodity": "Industrial Hemp Fibre",
  "quantity_amount": 1000,
  "quantity_unit": "kg",
  "price_amount": 50000,
  "price_currency": "EUR",
  "terms": "Delivery within 30 days, payment on delivery",
  "metadata": {
    "region": "EU-Africa",
    "channel": "Your platform"
  },
  "settled_at": null
}
```

#### Errors
- `400 VALIDATION_ERROR` - Missing or invalid required fields
- `401 UNAUTHORIZED` - Missing or invalid API key
- `500 INTERNAL_ERROR` - Server error

---

### GET /match/:id

**Retrieve a single match** and its proof record.

#### Example
```bash
curl https://api.trade.izenzo.co.za/functions/v1/match/550e8400-e29b-41d4-a716-446655440000 \
  -H "X-API-Key: sk_your_key_here"
```

#### Response (200 OK)
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "created_at": "2025-01-10T12:00:00.000Z",
  "status": "matched",
  "hash": "a3b2c1d4e5f6789...",
  "buyer_id": "BUYER123",
  "buyer_name": "Example Buyer Ltd",
  "seller_id": "SELLER456",
  "seller_name": "Example Seller Ltd",
  "commodity": "Hot-Rolled Steel Coils",
  "quantity_amount": 50,
  "quantity_unit": "tonnes",
  "price_amount": 125000,
  "price_currency": "USD",
  "terms": "FOB Shanghai, 60 days credit",
  "metadata": {
    "commodity_type": "steel",
    "region": "Asia-Pacific"
  },
  "settled_at": null
}
```

#### Errors
- `404 NOT_FOUND` - Match does not exist
- `401 UNAUTHORIZED` - Missing or invalid API key

---

### POST /match/:id/settle

**Confirm intent for a match** (non-binding). This is idempotent - calling it multiple times on an already-confirmed match will simply return the existing record.

**Important:** This endpoint records intention only. It does NOT:
- Create a binding contract
- Process any payment
- Execute fulfillment

#### Example
```bash
curl -X POST https://api.trade.izenzo.co.za/functions/v1/match/550e8400-e29b-41d4-a716-446655440000/settle \
  -H "X-API-Key: sk_your_key_here"
```

#### Request Body
None required (empty body).

#### Response (200 OK)
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "created_at": "2025-01-10T12:00:00.000Z",
  "status": "settled",
  "hash": "a3b2c1d4e5f6789...",
  "buyer_id": "BUYER123",
  "buyer_name": "Example Buyer Ltd",
  "seller_id": "SELLER456",
  "seller_name": "Example Seller Ltd",
  "commodity": "Hot-Rolled Steel Coils",
  "quantity_amount": 50,
  "quantity_unit": "tonnes",
  "price_amount": 125000,
  "price_currency": "USD",
  "terms": "FOB Shanghai, 60 days credit",
  "metadata": {
    "commodity_type": "steel",
    "region": "Asia-Pacific"
  },
  "settled_at": "2025-01-10T14:30:00.000Z"
}
```

#### Behavior
- If `status` is `matched`: updates to `settled` and sets `settled_at` timestamp
- If `status` is already `settled`: returns existing record unchanged (idempotent)
- Creates an audit log entry
- Adds event to the evidence chain

#### Errors
- `404 NOT_FOUND` - Match does not exist
- `401 UNAUTHORIZED` - Missing or invalid API key

---

### GET /matches

**List matches** with pagination and filtering.

#### Query Parameters
- `limit` (number, default: 50) - Max results to return
- `offset` (number, default: 0) - Skip N results
- `status` (string, optional) - Filter by status (`matched` or `settled`)
- `commodity` (string, optional) - Filter by commodity name (case-insensitive partial match)
- `commodity_type` (string, optional) - Filter by commodity type from metadata (e.g., `hemp_cannabis`, `steel`, `fuel`, `saas`)

#### Example Requests

**Get all settled matches:**
```bash
curl "https://api.trade.izenzo.co.za/functions/v1/matches?limit=10&status=settled" \
  -H "X-API-Key: sk_your_key_here"
```

**Search for steel trades:**
```bash
curl "https://api.trade.izenzo.co.za/functions/v1/matches?commodity=steel&limit=20" \
  -H "X-API-Key: sk_your_key_here"
```

**Filter by commodity type:**
```bash
curl "https://api.trade.izenzo.co.za/functions/v1/matches?commodity_type=saas&status=matched" \
  -H "X-API-Key: sk_your_key_here"
```

#### Response (200 OK)
```json
{
  "items": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "created_at": "2025-01-10T12:00:00.000Z",
      "status": "matched",
      "buyer_name": "Example Buyer Ltd",
      "seller_name": "Example Seller Ltd",
      "commodity": "Hot-Rolled Steel Coils",
      "quantity_amount": 50,
      "quantity_unit": "tonnes",
      "price_amount": 125000,
      "price_currency": "USD",
      "hash": "a3b2c1d4e5f6789..."
    }
  ],
  "totalCount": 145
}
```

#### Errors
- `401 UNAUTHORIZED` - Missing or invalid API key

---

## Example Workflow

### 1. Create a match
```bash
curl -X POST https://api.trade.izenzo.co.za/functions/v1/match \
  -H "X-API-Key: sk_your_key_here" \
  -H "Content-Type: application/json" \
  -d '{
    "buyer": {"id": "BUYER123", "name": "Example Buyer Ltd"},
    "seller": {"id": "SELLER456", "name": "Example Seller Ltd"},
    "commodity": "Hot-Rolled Steel Coils",
    "quantity": {"amount": 50, "unit": "tonnes"},
    "price": {"amount": 125000, "currency": "USD"},
    "terms": "FOB Shanghai, 60 days credit",
    "metadata": {"commodity_type": "steel", "region": "Asia-Pacific"}
  }'
```

Save the returned `id`.

### 2. Retrieve the match
```bash
curl https://api.trade.izenzo.co.za/functions/v1/match/{id} \
  -H "X-API-Key: sk_your_key_here"
```

### 3. Mark as settled
```bash
curl -X POST https://api.trade.izenzo.co.za/functions/v1/match/{id}/settle \
  -H "X-API-Key: sk_your_key_here"
```

### 4. Verify it's settled
```bash
curl https://api.trade.izenzo.co.za/functions/v1/match/{id} \
  -H "X-API-Key: sk_your_key_here"
```

The response will show `"status": "settled"` and a `settled_at` timestamp.

---

## Error Handling

All errors return JSON in this format:

```json
{
  "code": "ERROR_CODE",
  "message": "Human-readable message",
  "details": {},
  "requestId": "uuid"
}
```

### Common Error Codes
- `VALIDATION_ERROR` (400) - Invalid request data
- `UNAUTHORIZED` (401) - Missing or invalid API key
- `FORBIDDEN` (403) - Insufficient permissions
- `NOT_FOUND` (404) - Resource not found
- `METHOD_NOT_ALLOWED` (405) - HTTP method not supported
- `INTERNAL_ERROR` (500) - Server error

---

## Hash Verification

To independently verify a match:

1. Get the match record from the API
2. Rebuild the canonical JSON:
```json
{
  "buyer": {"id": "...", "name": "..."},
  "seller": {"id": "...", "name": "..."},
  "commodity": "...",
  "quantity": {"amount": 1000, "unit": "kg"},
  "price": {"amount": 50000, "currency": "EUR"},
  "terms": "...",
  "metadata": {}
}
```
3. Compute SHA-256 hash
4. Compare with the `hash` field in the match record

If they match, the record is authentic and hasn't been tampered with.

---

## Integration Guide

### For Marketplaces
1. When buyer and seller agree on a deal in your UI, call `POST /match`
2. Store the returned `match.id` in your system
3. When payment/delivery completes, call `POST /match/:id/settle`
4. Display match status and proof hash to users

### For ERPs/Systems
1. When recording a trade agreement, call `POST /match`
2. Link the returned `match.id` to your internal order/transaction ID
3. Use `GET /match/:id` to check status at any time
4. Call `POST /match/:id/settle` when fulfillment is complete

### For Auditors
1. Request match IDs from the trading parties
2. Call `GET /match/:id` to retrieve proof records
3. Verify the cryptographic hashes independently
4. Check timestamps and settlement status

---

## API Key Management

### Creating API Keys
Sign up at the dashboard or use the `/api-keys` endpoint with JWT authentication:

```bash
curl -X POST https://api.trade.izenzo.co.za/functions/v1/api-keys \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My API Key",
    "scopes": ["signals:write", "signals:read"]
  }'
```

**Important**: The API key is only shown once. Save it securely.

### Revoking API Keys
Use the dashboard or call `DELETE /api-keys/:id` with JWT authentication.

---

## Rate Limits & Performance

- **Rate limits**: Currently no hard limits, but abuse will be throttled
- **Response times**: Typically < 100ms for reads, < 200ms for writes
- **Hash computation**: SHA-256 is computed server-side for consistency

---

## Support & Questions

For support or questions about the Compliance Matching API:
- Email: api-support@izenzo.co.za
- Check logs in your Lovable Cloud dashboard
- Review the [Lovable Discord community](https://discord.com/channels/1119885301872070706/1280461670979993613)

---

## Changelog

### v1.3.1 (2025-12-03)
- Added TypeScript SDK (`src/lib/izenzo-sdk.ts`)
- Added OpenAPI 3.1 specification (`/openapi.yaml`)
- Added SDK documentation page
- Clarified "Confirm Intent" is non-binding (no payment, no contract)
- Enhanced security with stricter RLS policies

### v1.3.0 (2025-12-03)
- Renamed "Settle" to "Confirm Intent" throughout
- Added behavioral analytics (non-binding signals)
- Updated documentation for compliance clarity

### v1.0 (2025-01-10)
- Initial release
- Core endpoints: POST /match, GET /match/:id, POST /match/:id/settle, GET /matches
- SHA-256 cryptographic proofs
- API key authentication
- Generic, sector-agnostic design