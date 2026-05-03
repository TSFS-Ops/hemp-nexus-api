# Getting Started with the Compliance Matching API

**Last Updated**: 2026-05-03 (USD-native pricing, Trade Request entity, SECDEF Stage D1)
**Time Required**: 15–20 minutes

---

## What You'll Learn

By the end of this guide, you'll be able to:

- ✅ Create your account and verify your email
- ✅ Generate and securely store API keys
- ✅ Make your first API request
- ✅ Understand responses and handle errors
- ✅ Create a Trade Request and progress to a POI

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Account Setup](#account-setup)
3. [Creating Your API Key](#creating-your-api-key)
4. [Your First API Call](#your-first-api-call)
5. [Creating a Trade Request](#creating-a-trade-request)
6. [Progressing to a POI](#progressing-to-a-poi)
7. [Understanding Responses](#understanding-responses)
8. [Common Errors](#common-errors)
9. [Billing & Credits](#billing--credits)
10. [Next Steps](#next-steps)

---

## Prerequisites

### What You Need
- A valid email address
- A text editor or terminal
- Basic understanding of HTTP requests (helpful but not required)

### What You Don't Need
- Prior API experience
- Special software
- Programming skills (we provide copy-paste examples)

---

## Account Setup

### Step 1: Sign Up

1. Navigate to the signup page
2. Enter your email and password (minimum 8 characters; HIBP-checked against breached password lists)
3. Click "Sign Up"

### Step 2: Verify Your Email

1. Check your inbox for "Verify Your Email"
2. Click the verification link
3. You'll be redirected to log in

> **Email confirmation is mandatory.** There is no auto-confirmation in production. (Test accounts at `@test.izenzo.co.za` are auto-verified for the UAT framework.)

**Troubleshooting**:
- **Email not received?** Check spam folder, wait 5 minutes
- **Link expired?** Request a new verification email from the login page

### Step 3: Log In

1. Enter your verified email and password
2. You'll see the Desk (the trade-user surface) or the Developer Dashboard, depending on your role

**What happens on first login**:
- An organisation is automatically created for you
- You're assigned `org_admin` + `org_member` roles
- A jurisdiction is locked in during onboarding (regional data-residency lock — this is permanent)
- You're ready to create API keys or begin trading

---

## Creating Your API Key

### Step 1: Navigate to API Keys

1. From the Developer Dashboard, click **"API Keys"** in the sidebar
2. Click **"Create API Key"**

### Step 2: Configure Your Key

**Name** (Required):
```
Example: "Development Key" or "Production Key"
```

**Expiry** (Required):
- `Never` — Key doesn't expire (use for testing only)
- `30 days` — Short-term projects
- `90 days` — Recommended for production
- `365 days` — Long-term integrations

**Scopes** (Select based on needs):
- ✅ `signals:read` / `signals:write` — Trade Request discovery
- ✅ `match:read` / `match:write` — POI lifecycle
- ✅ `webhooks:read` / `webhooks:write` — Event subscriptions

**For getting started, select all of the above.**

### Step 3: Save Your Key

**⚠️ IMPORTANT**: Copy your API key immediately!

```
Your key looks like: sk_1a2b3c4d5e6f7g8h9i0j
```

**This is the only time you'll see the full key.** Store it securely:

```bash
# In a .env file (never commit this!)
API_KEY=sk_1a2b3c4d5e6f7g8h9i0j
```

**Never do this**:
- ❌ Commit to Git
- ❌ Share via email/chat
- ❌ Hardcode in your application

---

## Your First API Call

### Test Your Setup

Let's verify your API key works.

**Using cURL** (Terminal):
```bash
curl https://api.trade.izenzo.co.za/functions/v1/healthz
```

**Expected Response**:
```json
{
  "status": "healthy",
  "timestamp": "2026-05-03T10:00:00Z"
}
```

### Test Authentication

API keys use the `X-API-Key` header. JWT user sessions use `Authorization: Bearer`.

```bash
curl https://api.trade.izenzo.co.za/functions/v1/signals \
  -H "X-API-Key: YOUR_API_KEY_HERE"
```

**Expected Response** (empty list is normal):
```json
{ "data": [] }
```

If you see this, your API key is working. 🎉

---

## Creating a Trade Request

A **Trade Request** expresses your intent to buy or sell. Trade Requests persist across counterparty attempts — if a chosen counterparty declines or your engagement expires, the same Trade Request can be re-engaged with a new counterparty without re-keying.

> **Terminology:** This platform uses **Counterparty**, **Trade Request**, **Proof of Intent (POI)**, and **WaD** ("Without a Doubt"). We never use "Bid/Offer".

### Create a Buyer Trade Request

```bash
curl -X POST https://api.trade.izenzo.co.za/functions/v1/signals \
  -H "X-API-Key: YOUR_API_KEY_HERE" \
  -H "Content-Type: application/json" \
  -d '{
    "product": "Industrial Equipment Parts",
    "quantity": 1000,
    "unit": "units",
    "location": "Johannesburg",
    "budget": 50000,
    "currency": "ZAR"
  }'
```

> The `currency` field on a **Trade Request** is the *commercial currency of the trade* (ZAR, EUR, USD, etc.) — it is *not* the platform billing currency. **Platform credits are USD-native, $1 per credit.**

**Response**:
```json
{
  "signalId": "550e8400-e29b-41d4-a716-446655440000",
  "trade_request_id": "trq_abc123",
  "options": []
}
```

---

## Progressing to a POI

The POI (Proof of Intent) lifecycle is an **8-state machine** managed by `atomic_generate_poi_v2`.

The headline gates:

1. **Engagement hold-point** — your chosen counterparty must accept the engagement (`409 / ENGAGEMENT_PENDING` until then).
2. **Mandatory commercial terms** — you must enter price, quantity, currency, and incoterms before the POI can be minted.
3. **Probability ≥ 50.1%** — bilateral completion probability must clear the threshold.
4. **Acknowledgements** — every POI mint requires `p_acks={declaration_ack:true, atb_ack:true}`.
5. **Evidence (bilateral)** — at least one document per side. **No waivers.**
6. **Evidence Strength Indicator** — a visual red→amber→green bar surfaces how strong the bundle is. Documents are not individually mandatory beyond the per-side minimum, but more docs = stronger.

POIs are minted server-side only. The browser never calls the atomic functions directly — they are `service_role` only since SECDEF Stage D1 (2026-04-22).

**Endpoint**: `POST /functions/v1/poi-mint`

---

## Understanding Responses

### Successful Response

```json
{
  "id": "resource_id",
  "status": "active",
  "created_at": "2026-05-03T10:00:00Z"
}
```

### Error Response

All errors follow this format:

```json
{
  "code": "VALIDATION_ERROR",
  "message": "product is required",
  "requestId": "req_123abc",
  "details": {
    "field": "product",
    "issue": "missing"
  }
}
```

**Always save the `requestId`** when contacting support. Sentry traces are keyed off it.

---

## Common Errors

### 401 Unauthorised
Invalid or missing API key. Confirm `X-API-Key` (API key) or `Authorization: Bearer` (JWT) is present.

### 403 Forbidden
Your API key doesn't have the required scope. Create a new key with the needed scopes.

### 400 Validation Error
Check your request body matches the expected Zod schema.

### 409 Conflict — `ENGAGEMENT_PENDING`
Your counterparty has not yet accepted the engagement. Poll engagement status or wait for the `engagement.accepted` webhook.

### 409 Conflict — `DISPUTE_ACTIVE`
Commercial mutations are blocked while a dispute is open on the match. Disputes can only be resolved by the raising organisation.

### 409 Conflict — `WEBHOOK_REPLAY`
The same webhook delivery `id` was already processed. Treat as success and ignore.

### 429 Rate Limited
```json
{
  "code": "RATE_LIMIT_EXCEEDED",
  "message": "Rate limit exceeded",
  "details": { "retryAfter": 60 }
}
```
Honour the `Retry-After` header.

---

## Billing & Credits

Platform billing is **USD-native end-to-end**. Paystack settles directly in USD (the FX/ZAR layer was retired on 2026-05-01).

| Tier | Credits | Price (USD) | Saving |
|------|---------|-------------|--------|
| `single` | 1 | $1 | — |
| `pack_10` | 10 | $10 | — |
| `pack_50` | 50 | $45 | -10% |
| `pack_200` | 200 | $160 | -20% |

**1 credit = $1.00 USD.** Trade-side currencies (ZAR, EUR, etc.) are commercial terms, not billing claims.

Credit consumption is recorded via `atomic_token_burn`. Founder/admin accounts use `exempt_burn` (zero-cost) within capped limits.

---

## Next Steps

### Explore More Features

1. **Webhooks** — real-time notifications. See [Webhooks Guide](./webhooks.md). All inbound webhook handlers must verify HMAC signatures and use `assertNotReplayed()`.
2. **Evidence Packs** — generate compliance proof for matches. See [API Reference](./api-reference.md).
3. **WaD (Without a Doubt) certification** — 9-gate hard verification + SHA-256 seal. See [WaD Certification Rules](./api-reference.md#wad).

### Read More Documentation

- [Full API Reference](./api-reference.md) — every endpoint documented
- [How to Test](./how-to-test.md) — complete testing guide
- [Product Guide](./product-guide.md) — feature deep-dives
- [Webhooks](./webhooks.md) — real-time notifications + replay protection
- [End-to-End Walkthrough](../public/docs/end-to-end-walkthrough.md) — full happy path

### Get Help

- **Dashboard Testing**: built-in API Playground
- **Health Check**: `GET /healthz` for system status
- **Support**: support@izenzo.co.za

---

## Quick Reference

### Base URL
```
https://api.trade.izenzo.co.za/functions/v1
```

### Required Headers
```http
X-API-Key: YOUR_API_KEY              # API key auth
Authorization: Bearer YOUR_JWT       # User session auth (alternative)
Content-Type: application/json
Idempotency-Key: <unique-per-write>  # Required on writes
```

### Key Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/healthz` | GET | System health (no auth) |
| `/signals` | POST | Create Trade Request |
| `/signals` | GET | List Trade Requests |
| `/signals/:id` | GET | Get Trade Request with options |
| `/poi-mint` | POST | Mint a POI (after engagement accepted) |
| `/match/:id` | GET | Get match (POI record) |
| `/wad` | POST | Create WaD certificate |
| `/wad/:id/attest` | POST | Buyer/seller attestation |
| `/wad/:id/seal` | POST | Seal sealed deal certificate |
| `/evidence-pack/:id` | GET | Generate evidence proof |
| `/audit-logs` | GET | Audit trail |

### HTTP Status Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 201 | Created |
| 204 | No Content (deleted) |
| 400 | Bad Request |
| 401 | Unauthorised |
| 403 | Forbidden |
| 404 | Not Found |
| 409 | Conflict (`ENGAGEMENT_PENDING` / `DISPUTE_ACTIVE` / `WEBHOOK_REPLAY`) |
| 422 | Unprocessable (gate failure, e.g. probability < 50.1%) |
| 429 | Rate Limited |
| 500 | Server Error |

---

**Congratulations!** You're now ready to use the Compliance Matching API. 🚀
