# Webhooks Documentation

Webhooks allow you to receive real-time notifications when events occur in your organisation.

## Overview

When you register a webhook endpoint, the Compliance Matching API will send HTTP POST requests to your URL whenever subscribed events occur. Each webhook delivery includes:

- Event type
- Event data
- Timestamp
- Organisation ID
- HMAC signature for verification

## Available Events

| Event | Description | Payload |
|-------|-------------|---------|
| `signal.created` | Triggered when a new signal is created | `signalId`, `product`, `quantity`, `unit`, `status` |
| `option.selected` | Triggered when an option is selected for a signal | `signalId`, `optionId`, `selectionId`, `dataSourceType`, `sourceLink` |
| `match.created` | Triggered when a new match is created | `matchId`, `commodity`, `buyer`, `seller`, `quantity`, `price`, `hash` |
| `match.settled` | Triggered when a match is settled | `matchId`, `hash`, `settledAt`, `commodity`, `quantity` |
| `intent.confirmed` | Triggered when intent is confirmed (alias for match.settled) | `matchId`, `hash`, `settledAt`, `commodity`, `quantity` |
| `intent.received` | Triggered when counterparty receives intent notification | `matchId`, `counterpartyOrgId`, `notifiedAt` |
| `token.low_balance` | Triggered when token balance crosses warning threshold | `currentBalance`, `threshold`, `minimumRequired`, `urgency`, `message` |

## Managing Webhooks

### Create Webhook Endpoint

```bash
POST /webhooks
Content-Type: application/json
X-API-Key: your_api_key

{
  "url": "https://your-domain.com/webhook",
  "events": ["signal.created", "match.created"],
  "secret": "your_webhook_secret_min_16_chars" // Optional, will be auto-generated if not provided
}
```

**Response:**
```json
{
  "id": "webhook-uuid",
  "url": "https://your-domain.com/webhook",
  "events": ["signal.created", "match.created"],
  "status": "active",
  "secret": "auto-generated-secret", // Only returned if you didn't provide one
  "created_at": "2025-01-19T10:00:00Z",
  "message": "Webhook created. Save the secret - you won't see it again!"
}
```

### List Webhooks

```bash
GET /webhooks
X-API-Key: your_api_key
```

### Get Webhook Details

```bash
GET /webhooks/:id
X-API-Key: your_api_key
```

### Update Webhook

```bash
PATCH /webhooks/:id
Content-Type: application/json
X-API-Key: your_api_key

{
  "url": "https://new-url.com/webhook",
  "events": ["match.created"],
  "status": "inactive"
}
```

### Delete Webhook

```bash
DELETE /webhooks/:id
X-API-Key: your_api_key
```

## Webhook Payload Format

All webhook deliveries follow this format:

```json
{
  "event": "signal.created",
  "data": {
    "signalId": "signal-uuid",
    "product": "Paracetamol 500mg",
    "quantity": 1000,
    "unit": "boxes",
    "status": "active"
  },
  "timestamp": "2025-01-19T10:30:00.000Z",
  "orgId": "org-uuid"
}
```

### Token Low Balance Payload

The `token.low_balance` event is triggered when your organisation's token balance crosses warning thresholds:

```json
{
  "event": "token.low_balance",
  "data": {
    "currentBalance": 5500,
    "threshold": 5500,
    "minimumRequired": 5000,
    "urgency": "urgent",
    "message": "Your token balance is running low. Top up soon to avoid service interruption.",
    "topUpUrl": "https://dashboard.example.com/billing"
  },
  "timestamp": "2026-01-11T10:30:00.000Z",
  "orgId": "org-uuid"
}
```

**Threshold Levels**:
- **6,000 tokens** (Warning): Early warning to plan top-up
- **5,500 tokens** (Urgent): Top up soon to avoid interruption
- **5,001 tokens** (Critical): Immediate action required

## Webhook Headers

Each webhook request includes these headers:

| Header | Description |
|--------|-------------|
| `Content-Type` | Always `application/json` |
| `X-Webhook-Signature` | HMAC-SHA256 signature of the payload |
| `X-Webhook-Event` | The event type (e.g., `signal.created`) |
| `X-Webhook-Timestamp` | ISO 8601 timestamp of when the webhook was sent |

## Verifying Webhook Signatures

To verify that a webhook came from the Compliance Matching API, validate the signature:

### Node.js Example

```javascript
const crypto = require('crypto');

function verifyWebhook(payload, signature, secret) {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(payload);
  const expectedSignature = hmac.digest('hex');
  
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

// In your webhook handler
app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const signature = req.headers['x-webhook-signature'];
  const payload = req.body.toString();
  
  if (!verifyWebhook(payload, signature, YOUR_WEBHOOK_SECRET)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }
  
  const data = JSON.parse(payload);
  console.log('Received event:', data.event);
  
  // Process the webhook
  // ...
  
  res.status(200).json({ received: true });
});
```

### Python Example

```python
import hmac
import hashlib
import json
from flask import Flask, request

app = Flask(__name__)
WEBHOOK_SECRET = "your_webhook_secret"

def verify_webhook(payload, signature, secret):
    expected_signature = hmac.new(
        secret.encode(),
        payload.encode(),
        hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(signature, expected_signature)

@app.route('/webhook', methods=['POST'])
def webhook():
    signature = request.headers.get('X-Webhook-Signature')
    payload = request.get_data(as_text=True)
    
    if not verify_webhook(payload, signature, WEBHOOK_SECRET):
        return {'error': 'Invalid signature'}, 401
    
    data = json.loads(payload)
    print(f"Received event: {data['event']}")
    
    # Process the webhook
    # ...
    
    return {'received': True}, 200
```

## Replay Protection

Inbound webhooks the platform **receives** (e.g. Resend delivery/bounce events into `auth-email-hook` and `handle-email-suppression`, plus any handler that uses `_shared/webhooks.ts`) are de-duplicated by the `webhook_replay_guard` ledger via the `assertNotReplayed` helper.

If the same `(provider, event_id)` is seen twice, the platform returns:

```json
{
  "code": "WEBHOOK_REPLAY",
  "message": "Webhook already processed",
  "requestId": "…"
}
```

with HTTP **409**. This response is **deterministic and stable** — providers (and your own retry logic) should treat it as a successful delivery and stop retrying. The ledger is pruned daily by `lifecycle-scheduler`, so very old event ids may eventually be re-accepted.

For webhooks the platform **sends to your endpoint**, you should mirror this behaviour: de-duplicate on `X-Webhook-Event` + `X-Webhook-Timestamp` (or your own event id field) so retries from our side don't double-process.

## Subject Length Contract

All notification emails and Slack messages emitted alongside webhook events (engagement requests, lifecycle reminders, team invites, dispatch fan-out) pass through `clampSubject()` from `supabase/functions/_shared/email-subject.ts`. Subjects are hard-clamped to **200 characters** and the trailing trace tail (request id / org id) is preserved when truncation is needed. Free-text fields — commodity, organisation name, inviter name — are never concatenated raw into a subject line. If you parse subjects on your side, treat them as bounded but variable-length.


## Best Practices

### 1. Respond Quickly
Your endpoint should respond with a 2xx status code within 5 seconds. Perform time-consuming tasks asynchronously.

```javascript
app.post('/webhook', async (req, res) => {
  // Verify signature first
  if (!verifyWebhook(req.body, req.headers['x-webhook-signature'], secret)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }
  
  // Respond immediately
  res.status(200).json({ received: true });
  
  // Process async
  processWebhookAsync(req.body).catch(console.error);
});
```

### 2. Handle Idempotency
Use the event ID and timestamp to prevent processing the same event multiple times.

```javascript
const processedEvents = new Set();

function processWebhook(data) {
  const eventKey = `${data.event}-${data.timestamp}`;
  
  if (processedEvents.has(eventKey)) {
    console.log('Event already processed');
    return;
  }
  
  processedEvents.add(eventKey);
  // Process the event
}
```

### 3. Implement Retry Logic
Your endpoint may occasionally be unavailable. Implement proper error handling:

- Return 2xx for success
- Return 4xx for permanent failures (we won't retry)
- Return 5xx for temporary failures (we may retry)

### 4. Secure Your Endpoint

- Always verify the webhook signature
- Use HTTPS for your webhook URL
- Consider IP allowlisting if needed
- Implement rate limiting on your endpoint

### 5. Monitor Webhook Health

Track webhook delivery failures and investigate:
- Check the `last_delivery_at` field
- Monitor your endpoint's response times
- Set up alerts for repeated failures

## Testing Webhooks Locally

For local development, use tools like [ngrok](https://ngrok.com/) to expose your local server:

```bash
# Start ngrok
ngrok http 3000

# Use the ngrok URL in your webhook registration
curl -X POST https://api.trade-izenzo.com/webhooks \
  -H "X-API-Key: your_key" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-ngrok-url.ngrok.io/webhook",
    "events": ["signal.created"]
  }'
```

## Troubleshooting

### Webhook not being delivered

1. Check webhook status is `active`
2. Verify the URL is accessible from the internet
3. Ensure your endpoint returns 2xx status codes
4. Check that the event type is in your subscribed events

### Signature verification failing

1. Use the raw request body (before parsing)
2. Verify you're using the correct secret
3. Check that the signature header is present
4. Ensure consistent encoding (UTF-8)

### Rate limiting

Webhook deliveries are subject to the same rate limits as API requests. If you're receiving many events, consider:

- Processing webhooks asynchronously
- Batching operations
- Implementing exponential backoff for retries

## Support

For webhook-related issues, contact support with:
- Webhook ID
- Timestamp of failed delivery
- Response status code from your endpoint
- Relevant logs
