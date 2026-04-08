# Getting Started with the Compliance Matching API

**Last Updated**: 2025-12-02  
**Time Required**: 15-20 minutes

---

## What You'll Learn

By the end of this guide, you'll be able to:

- ✅ Create your account and verify your email
- ✅ Generate and securely store API keys
- ✅ Make your first API request
- ✅ Understand responses and handle errors
- ✅ Create a signal and match

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Account Setup](#account-setup)
3. [Creating Your API Key](#creating-your-api-key)
4. [Your First API Call](#your-first-api-call)
5. [Creating a Signal](#creating-a-signal)
6. [Creating a Match](#creating-a-match)
7. [Understanding Responses](#understanding-responses)
8. [Common Errors](#common-errors)
9. [Next Steps](#next-steps)

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
2. Enter your email and password (minimum 8 characters)
3. Click "Sign Up"

### Step 2: Verify Your Email

1. Check your inbox for "Verify Your Email"
2. Click the verification link
3. You'll be redirected to log in

**Troubleshooting**:
- **Email not received?** Check spam folder, wait 5 minutes
- **Link expired?** Request a new verification email from the login page

### Step 3: Log In

1. Enter your verified email and password
2. You'll see the Dashboard

**What happens on first login**:
- An organization is automatically created for you
- You're assigned a default role
- You're ready to create API keys

---

## Creating Your API Key

### Step 1: Navigate to API Keys

1. From the Dashboard, click **"API Keys"** in the sidebar
2. Click **"Create API Key"**

### Step 2: Configure Your Key

**Name** (Required):
```
Example: "Development Key" or "Production Key"
```

**Expiry** (Required):
- `Never` - Key doesn't expire (use for testing)
- `30 days` - Short-term projects
- `90 days` - Recommended for production
- `365 days` - Long-term integrations

**Scopes** (Select based on needs):
- ✅ `signals:read` - View signals
- ✅ `signals:write` - Create signals
- ✅ `match:read` - View matches
- ✅ `match:write` - Create matches

**For getting started, select all four scopes above.**

### Step 3: Save Your Key

**⚠️ IMPORTANT**: Copy your API key immediately!

```
Your key looks like: sk_1a2b3c4d5e6f7g8h9i0j
```

**This is the only time you'll see the full key.** Store it securely:

**Good practices**:
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
curl https://api.izenzo.co.za/functions/v1/healthz
```

**Expected Response**:
```json
{
  "status": "healthy",
  "timestamp": "2025-12-02T10:00:00Z"
}
```

### Test Authentication

```bash
curl https://api.izenzo.co.za/functions/v1/signals \
  -H "Authorization: Bearer YOUR_API_KEY_HERE"
```

**Expected Response** (empty list is normal):
```json
{
  "data": []
}
```

If you see this, your API key is working! 🎉

---

## Creating a Signal

A **signal** expresses your intent to buy or sell something.

### Create a Buyer Signal

**cURL**:
```bash
curl -X POST https://api.izenzo.co.za/functions/v1/signals \
  -H "Authorization: Bearer YOUR_API_KEY_HERE" \
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

**JavaScript**:
```javascript
const response = await fetch(
  'https://api.izenzo.co.za/functions/v1/signals',
  {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer YOUR_API_KEY_HERE',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      product: 'Industrial Equipment Parts',
      quantity: 1000,
      unit: 'units',
      location: 'Johannesburg',
      budget: 50000,
      currency: 'ZAR'
    })
  }
);

const data = await response.json();
console.log('Signal ID:', data.signalId);
```

**Python**:
```python
import requests

response = requests.post(
    'https://api.izenzo.co.za/functions/v1/signals',
    headers={
        'Authorization': 'Bearer YOUR_API_KEY_HERE',
        'Content-Type': 'application/json'
    },
    json={
        'product': 'Industrial Equipment Parts',
        'quantity': 1000,
        'unit': 'units',
        'location': 'Johannesburg',
        'budget': 50000,
        'currency': 'ZAR'
    }
)

data = response.json()
print(f"Signal ID: {data['signalId']}")
```

**Response**:
```json
{
  "signalId": "550e8400-e29b-41d4-a716-446655440000",
  "options": []
}
```

### Get Signal with Options

```bash
curl https://api.izenzo.co.za/functions/v1/signals/YOUR_SIGNAL_ID \
  -H "Authorization: Bearer YOUR_API_KEY_HERE"
```

---

## Creating a Match

A **match** records a trade agreement between buyer and seller with cryptographic proof.

### Create a Match

**cURL**:
```bash
curl -X POST https://api.izenzo.co.za/functions/v1/match \
  -H "Authorization: Bearer YOUR_API_KEY_HERE" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: my-unique-order-123" \
  -d '{
    "buyer": {
      "id": "buyer-org-001",
      "name": "Acme Corporation"
    },
    "seller": {
      "id": "seller-org-002",
      "name": "Industrial Supplies Ltd"
    },
    "commodity": "Industrial Equipment Parts",
    "quantity": {
      "amount": 1000,
      "unit": "units"
    },
    "price": {
      "amount": 45000,
      "currency": "ZAR"
    },
    "terms": "Payment within 30 days, FOB Johannesburg"
  }'
```

**Response**:
```json
{
  "id": "match_abc123",
  "hash": "a1b2c3d4e5f6789...",
  "status": "matched",
  "created_at": "2025-12-02T10:45:00Z"
}
```

### Understanding the Hash

The `hash` field is a SHA-256 hash of the trade details. This creates an **immutable proof** that this exact agreement was recorded.

### Confirm Intent (Settle)

To signal interest in proceeding:

```bash
curl -X POST https://api.izenzo.co.za/functions/v1/match/YOUR_MATCH_ID/settle \
  -H "Authorization: Bearer YOUR_API_KEY_HERE"
```

**Important**: This only signals interest. It does **not** create a legal contract or payment obligation.

---

## Understanding Responses

### Successful Response

All successful responses include relevant data:

```json
{
  "id": "resource_id",
  "status": "active",
  "created_at": "2025-12-02T10:00:00Z"
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

**Always save the `requestId`** when contacting support.

---

## Common Errors

### 401 Unauthorized

```json
{
  "code": "UNAUTHORIZED",
  "message": "Invalid or missing API key"
}
```

**Fix**: Check your API key is correct and included in the header.

### 403 Forbidden

```json
{
  "code": "FORBIDDEN",
  "message": "Insufficient permissions"
}
```

**Fix**: Your API key doesn't have the required scope. Create a new key with the needed scopes.

### 400 Validation Error

```json
{
  "code": "VALIDATION_ERROR",
  "message": "quantity must be a positive number"
}
```

**Fix**: Check your request body matches the expected format.

### 429 Rate Limited

```json
{
  "code": "RATE_LIMIT_EXCEEDED",
  "message": "Rate limit exceeded",
  "details": {
    "retryAfter": 60
  }
}
```

**Fix**: Wait for the `retryAfter` seconds before retrying.

---

## Next Steps

### Explore More Features

1. **Webhooks**: Get real-time notifications when events occur
   - See: [Webhooks Guide](./webhooks.md)

2. **Evidence Packs**: Generate compliance proof for matches
   - See: [API Reference](./api-reference.md#evidence-pack)

3. **Analytics**: View your usage statistics
   - See: Dashboard → Analytics tab

### Read More Documentation

- [Full API Reference](./api-reference.md) - Every endpoint documented
- [How to Test](./how-to-test.md) - Complete testing guide
- [Product Guide](./product-guide.md) - Feature deep-dives
- [Webhooks](./webhooks.md) - Real-time notifications

### Get Help

- **Dashboard Testing**: Use the built-in API Playground
- **Health Check**: `GET /healthz` for system status
- **Support**: support@izenzo.co.za

---

## Quick Reference

### Base URL
```
https://api.izenzo.co.za/functions/v1
```

### Required Headers
```http
Authorization: Bearer YOUR_API_KEY
Content-Type: application/json
```

### Key Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/healthz` | GET | System health (no auth) |
| `/signals` | POST | Create signal |
| `/signals` | GET | List signals |
| `/signals/:id` | GET | Get signal with options |
| `/match` | POST | Create match |
| `/match/:id` | GET | Get match |
| `/match/:id/settle` | POST | Confirm intent |
| `/evidence-pack/:id` | GET | Generate proof |

### HTTP Status Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 201 | Created |
| 204 | No Content (deleted) |
| 400 | Bad Request |
| 401 | Unauthorized |
| 403 | Forbidden |
| 404 | Not Found |
| 429 | Rate Limited |
| 500 | Server Error |

---

**Congratulations!** You're now ready to use the Compliance Matching API. 🚀
