# How to Test the Compliance Matching API

**Last Updated**: 2026-05-03 (USD-native examples)

This guide covers all testing methods available for the Compliance Matching API, from quick smoke tests to comprehensive integration testing.

---

## Table of Contents

1. [Quick Start Testing](#quick-start-testing)
2. [Dashboard Testing Tools](#dashboard-testing-tools)
3. [Command Line Testing](#command-line-testing)
4. [Integration Testing](#integration-testing)
5. [Webhook Testing](#webhook-testing)
6. [Load Testing](#load-testing)
7. [Troubleshooting Tests](#troubleshooting-tests)

---

## Quick Start Testing

### 1. Health Check (No Authentication Required)

Test if the API is running:

```bash
curl https://api.izenzo.co.za/functions/v1/healthz
```

**Expected Response**:
```json
{
  "status": "healthy",
  "timestamp": "2025-12-02T10:00:00Z",
  "summary": {
    "healthy": 7,
    "degraded": 0,
    "unhealthy": 0
  }
}
```

### 2. Authentication Test

Test your API key:

```bash
curl https://api.izenzo.co.za/functions/v1/signals \
  -H "Authorization: Bearer YOUR_API_KEY"
```

**Expected Response** (200 OK):
```json
{
  "data": []
}
```

If you get `401 Unauthorised`, check:
- API key is correct
- Key has not expired
- Key has required scopes

---

## Dashboard Testing Tools

### Smoke Tests

The dashboard includes automated smoke tests that verify core functionality.

**Location**: Dashboard → Testing → Smoke Tests

**What It Tests**:
1. ✅ Create Match - Creates a test match
2. ✅ Verify Match Hash - Confirms SHA-256 hash calculation
3. ✅ Verify Audit Log - Checks audit trail creation
4. ✅ Confirm Intent - Tests settlement (interest only)
5. ✅ Verify Intent Audit - Confirms settlement audit log

**How to Run**:
1. Navigate to the Testing tab
2. Enter your API key
3. Click "Run Smoke Tests"
4. Wait for all tests to complete

**Interpreting Results**:

| Status | Meaning |
|--------|---------|
| ✅ PASSED | Test succeeded |
| ❌ FAILED | Test failed - see error message |
| ⏳ RUNNING | Test in progress |

### API Playground

Interactive testing environment for any endpoint.

**Location**: Dashboard → API Docs → Playground

**Features**:
- Pre-built request templates
- Real-time response viewing
- Request/response history
- Copy as cURL command

---

## Command Line Testing

### Complete Test Suite

Run all endpoint tests from the command line:

```bash
# Set your API key
export API_KEY="sk_your_api_key"
export BASE_URL="https://api.izenzo.co.za/functions/v1"

# Test 1: Health Check
echo "Testing Health Check..."
curl -s "$BASE_URL/healthz" | jq '.status'

# Test 2: Create Signal
echo "Testing Create Signal..."
SIGNAL_RESPONSE=$(curl -s -X POST "$BASE_URL/signals" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "product": "Test Product",
    "quantity": 100,
    "unit": "units",
    "location": "Test Location"
  }')
echo $SIGNAL_RESPONSE | jq '.signalId'
SIGNAL_ID=$(echo $SIGNAL_RESPONSE | jq -r '.signalId')

# Test 3: Get Signal
echo "Testing Get Signal..."
curl -s "$BASE_URL/signals/$SIGNAL_ID" \
  -H "Authorization: Bearer $API_KEY" | jq '.signal.status'

# Test 4: Create Match
echo "Testing Create Match..."
MATCH_RESPONSE=$(curl -s -X POST "$BASE_URL/match" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: test-$(date +%s)" \
  -d '{
    "buyer": {"id": "test-buyer", "name": "Test Buyer"},
    "seller": {"id": "test-seller", "name": "Test Seller"},
    "commodity": "Test Commodity",
    "quantity": {"amount": 100, "unit": "units"},
    "price": {"amount": 1000, "currency": "USD"},
    "terms": "Test terms"
  }')
echo $MATCH_RESPONSE | jq '.id, .hash'
MATCH_ID=$(echo $MATCH_RESPONSE | jq -r '.id')

# Test 5: Get Match
echo "Testing Get Match..."
curl -s "$BASE_URL/match/$MATCH_ID" \
  -H "Authorization: Bearer $API_KEY" | jq '.status'

# Test 6: Settle Match
echo "Testing Settle Match..."
curl -s -X POST "$BASE_URL/match/$MATCH_ID/settle" \
  -H "Authorization: Bearer $API_KEY" | jq '.status, .settled_at'

# Test 7: Get Evidence Pack
echo "Testing Evidence Pack..."
curl -s "$BASE_URL/evidence-pack/$MATCH_ID" \
  -H "Authorization: Bearer $API_KEY" | jq '.verification.chainIntegrity'

# Test 8: Audit Logs
echo "Testing Audit Logs..."
curl -s "$BASE_URL/audit-logs?limit=5" \
  -H "Authorization: Bearer $API_KEY" | jq '.total'

echo "All tests complete!"
```

### Individual Endpoint Tests

#### Test Signal Creation

```bash
curl -X POST "$BASE_URL/signals" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "product": "Medical Supplies",
    "quantity": 500,
    "unit": "boxes",
    "location": "Johannesburg",
    "deliveryWindow": {
      "start": "2025-12-15",
      "end": "2025-12-31"
    },
    "budget": 25000,
    "currency": "USD"
  }'
```

#### Test Match Creation with Idempotency

```bash
# First request
curl -X POST "$BASE_URL/match" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: unique-order-123" \
  -d '{
    "buyer": {"id": "buyer-001", "name": "Acme Corp"},
    "seller": {"id": "seller-001", "name": "Supplier Ltd"},
    "commodity": "Industrial Parts",
    "quantity": {"amount": 1000, "unit": "pieces"},
    "price": {"amount": 50000, "currency": "USD"},
    "terms": "Net 30"
  }'

# Second request (same idempotency key) - should return same response
curl -X POST "$BASE_URL/match" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: unique-order-123" \
  -d '{
    "buyer": {"id": "buyer-001", "name": "Acme Corp"},
    "seller": {"id": "seller-001", "name": "Supplier Ltd"},
    "commodity": "Industrial Parts",
    "quantity": {"amount": 1000, "unit": "pieces"},
    "price": {"amount": 50000, "currency": "USD"},
    "terms": "Net 30"
  }'
# Check for X-Idempotent-Replay: true header
```

#### Test Rate Limiting

```bash
# Send 60 requests rapidly to trigger rate limiting
for i in {1..60}; do
  curl -s -o /dev/null -w "%{http_code}\n" \
    "$BASE_URL/signals" \
    -H "Authorization: Bearer $API_KEY"
done
# Should see 429 responses after limit exceeded
```

---

## Integration Testing

### JavaScript/Node.js Test Suite

```javascript
const assert = require('assert');

const BASE_URL = 'https://api.izenzo.co.za/functions/v1';
const API_KEY = process.env.API_KEY;

const headers = {
  'Authorization': `Bearer ${API_KEY}`,
  'Content-Type': 'application/json'
};

async function runTests() {
  console.log('Starting integration tests...\n');

  // Test 1: Health Check
  console.log('Test 1: Health Check');
  const healthRes = await fetch(`${BASE_URL}/healthz`);
  const health = await healthRes.json();
  assert.strictEqual(health.status, 'healthy', 'System should be healthy');
  console.log('✅ Health check passed\n');

  // Test 2: Create Signal
  console.log('Test 2: Create Signal');
  const signalRes = await fetch(`${BASE_URL}/signals`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      product: 'Test Product',
      quantity: 100,
      unit: 'units'
    })
  });
  assert.strictEqual(signalRes.status, 201, 'Signal should be created');
  const signal = await signalRes.json();
  assert.ok(signal.signalId, 'Should return signalId');
  console.log(`✅ Signal created: ${signal.signalId}\n`);

  // Test 3: Get Signal
  console.log('Test 3: Get Signal');
  const getSignalRes = await fetch(`${BASE_URL}/signals/${signal.signalId}`, {
    headers
  });
  assert.strictEqual(getSignalRes.status, 200, 'Should get signal');
  const signalData = await getSignalRes.json();
  assert.strictEqual(signalData.signal.status, 'active');
  console.log('✅ Signal retrieved\n');

  // Test 4: Create Match
  console.log('Test 4: Create Match');
  const matchRes = await fetch(`${BASE_URL}/match`, {
    method: 'POST',
    headers: {
      ...headers,
      'Idempotency-Key': `test-${Date.now()}`
    },
    body: JSON.stringify({
      buyer: { id: 'test-buyer', name: 'Test Buyer' },
      seller: { id: 'test-seller', name: 'Test Seller' },
      commodity: 'Test Commodity',
      quantity: { amount: 100, unit: 'units' },
      price: { amount: 1000, currency: 'USD' },
      terms: 'Test terms'
    })
  });
  assert.strictEqual(matchRes.status, 201, 'Match should be created');
  const match = await matchRes.json();
  assert.ok(match.hash, 'Should have hash');
  console.log(`✅ Match created: ${match.id}\n`);

  // Test 5: Verify Hash
  console.log('Test 5: Verify Hash Format');
  assert.strictEqual(match.hash.length, 64, 'Hash should be 64 characters');
  assert.match(match.hash, /^[a-f0-9]+$/, 'Hash should be hex');
  console.log('✅ Hash verification passed\n');

  // Test 6: Settle Match
  console.log('Test 6: Settle Match');
  const settleRes = await fetch(`${BASE_URL}/match/${match.id}/settle`, {
    method: 'POST',
    headers
  });
  assert.strictEqual(settleRes.status, 200, 'Should settle match');
  const settled = await settleRes.json();
  assert.strictEqual(settled.status, 'settled');
  assert.ok(settled.settled_at, 'Should have settled_at');
  console.log('✅ Match settled\n');

  // Test 7: Evidence Pack
  console.log('Test 7: Evidence Pack');
  const evidenceRes = await fetch(`${BASE_URL}/evidence-pack/${match.id}`, {
    headers
  });
  assert.strictEqual(evidenceRes.status, 200, 'Should get evidence pack');
  const evidence = await evidenceRes.json();
  assert.strictEqual(evidence.verification.chainIntegrity, 'VERIFIED');
  console.log('✅ Evidence pack generated\n');

  // Test 8: Audit Logs
  console.log('Test 8: Audit Logs');
  const logsRes = await fetch(`${BASE_URL}/audit-logs?entityId=${match.id}`, {
    headers
  });
  assert.strictEqual(logsRes.status, 200, 'Should get audit logs');
  const logs = await logsRes.json();
  assert.ok(logs.total >= 2, 'Should have at least 2 audit entries');
  console.log(`✅ Found ${logs.total} audit entries\n`);

  console.log('🎉 All tests passed!');
}

runTests().catch(err => {
  console.error('❌ Test failed:', err.message);
  process.exit(1);
});
```

### Python Test Suite

```python
import os
import requests
import time
from datetime import datetime

BASE_URL = 'https://api.izenzo.co.za/functions/v1'
API_KEY = os.environ.get('API_KEY')

headers = {
    'Authorization': f'Bearer {API_KEY}',
    'Content-Type': 'application/json'
}

def test_health_check():
    """Test health endpoint"""
    print('Test: Health Check')
    response = requests.get(f'{BASE_URL}/healthz')
    assert response.status_code == 200
    data = response.json()
    assert data['status'] == 'healthy'
    print('✅ Health check passed\n')

def test_create_signal():
    """Test signal creation"""
    print('Test: Create Signal')
    response = requests.post(
        f'{BASE_URL}/signals',
        headers=headers,
        json={
            'product': 'Test Product',
            'quantity': 100,
            'unit': 'units'
        }
    )
    assert response.status_code == 201
    data = response.json()
    assert 'signalId' in data
    print(f'✅ Signal created: {data["signalId"]}\n')
    return data['signalId']

def test_create_match():
    """Test match creation"""
    print('Test: Create Match')
    response = requests.post(
        f'{BASE_URL}/match',
        headers={
            **headers,
            'Idempotency-Key': f'test-{int(time.time())}'
        },
        json={
            'buyer': {'id': 'test-buyer', 'name': 'Test Buyer'},
            'seller': {'id': 'test-seller', 'name': 'Test Seller'},
            'commodity': 'Test Commodity',
            'quantity': {'amount': 100, 'unit': 'units'},
            'price': {'amount': 1000, 'currency': 'USD'},
            'terms': 'Test terms'
        }
    )
    assert response.status_code == 201
    data = response.json()
    assert 'hash' in data
    assert len(data['hash']) == 64
    print(f'✅ Match created: {data["id"]}\n')
    return data['id']

def test_settle_match(match_id):
    """Test match settlement"""
    print('Test: Settle Match')
    response = requests.post(
        f'{BASE_URL}/match/{match_id}/settle',
        headers=headers
    )
    assert response.status_code == 200
    data = response.json()
    assert data['status'] == 'settled'
    print('✅ Match settled\n')

def test_evidence_pack(match_id):
    """Test evidence pack generation"""
    print('Test: Evidence Pack')
    response = requests.get(
        f'{BASE_URL}/evidence-pack/{match_id}',
        headers=headers
    )
    assert response.status_code == 200
    data = response.json()
    assert data['verification']['chainIntegrity'] == 'VERIFIED'
    print('✅ Evidence pack verified\n')

def run_all_tests():
    """Run complete test suite"""
    print(f'\n{"="*50}')
    print('COMPLIANCE MATCHING API TEST SUITE')
    print(f'Started: {datetime.now().isoformat()}')
    print(f'{"="*50}\n')
    
    try:
        test_health_check()
        signal_id = test_create_signal()
        match_id = test_create_match()
        test_settle_match(match_id)
        test_evidence_pack(match_id)
        
        print(f'\n{"="*50}')
        print('🎉 ALL TESTS PASSED!')
        print(f'{"="*50}\n')
    except AssertionError as e:
        print(f'\n❌ TEST FAILED: {e}')
        exit(1)

if __name__ == '__main__':
    run_all_tests()
```

---

## Webhook Testing

### Local Webhook Testing with ngrok

1. **Start a local server**:
```javascript
// webhook-receiver.js
const http = require('http');
const crypto = require('crypto');

const SECRET = 'your-webhook-secret';

const server = http.createServer((req, res) => {
  let body = '';
  
  req.on('data', chunk => body += chunk);
  
  req.on('end', () => {
    const signature = req.headers['x-webhook-signature'];
    const expected = crypto
      .createHmac('sha256', SECRET)
      .update(body)
      .digest('hex');
    
    const valid = signature === expected;
    
    console.log('Webhook received:');
    console.log('- Event:', req.headers['x-webhook-event']);
    console.log('- Signature valid:', valid);
    console.log('- Body:', body);
    
    res.writeHead(200);
    res.end('OK');
  });
});

server.listen(3000, () => {
  console.log('Webhook receiver listening on port 3000');
});
```

2. **Expose with ngrok**:
```bash
ngrok http 3000
```

3. **Register webhook**:
```bash
curl -X POST "$BASE_URL/webhooks" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-ngrok-url.ngrok.io",
    "events": ["match.created", "match.settled"],
    "secret": "your-webhook-secret"
  }'
```

4. **Trigger event** by creating a match

### Testing Webhook Retries

1. Return error status (500) from your webhook
2. Watch for retry attempts
3. Retry schedule: immediate, 5 min, 30 min, 2 hours

---

## Load Testing

### Using wrk

```bash
# Install wrk
# macOS: brew install wrk
# Ubuntu: apt install wrk

# Test read endpoint
wrk -t4 -c100 -d30s \
  -H "Authorization: Bearer $API_KEY" \
  "$BASE_URL/signals"

# Test with POST requests
wrk -t4 -c50 -d30s \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -s post.lua \
  "$BASE_URL/signals"
```

**post.lua**:
```lua
wrk.method = "POST"
wrk.body   = '{"product":"Load Test","quantity":1,"unit":"units"}'
wrk.headers["Content-Type"] = "application/json"
```

### Expected Performance

| Metric | Target |
|--------|--------|
| Response time (p50) | < 200ms |
| Response time (p99) | < 1000ms |
| Throughput | > 50 req/s |
| Error rate | < 1% |

---

## Troubleshooting Tests

### Common Issues

#### 401 Unauthorised

```bash
# Check API key
curl -v "$BASE_URL/signals" \
  -H "Authorization: Bearer $API_KEY" 2>&1 | grep -i auth
```

**Solutions**:
- Verify API key is correct
- Check key hasn't expired
- Ensure key has required scopes

#### 403 Forbidden

```bash
# Check scopes
curl "$BASE_URL/api-keys" \
  -H "Authorization: Bearer $API_KEY" | jq '.data[].scopes'
```

**Solutions**:
- Create new key with required scopes
- Contact admin for scope upgrade

#### 429 Rate Limited

```bash
# Check rate limit headers
curl -v "$BASE_URL/signals" \
  -H "Authorization: Bearer $API_KEY" 2>&1 | grep -i ratelimit
```

**Solutions**:
- Wait for `Retry-After` duration
- Implement exponential backoff
- Request rate limit increase

#### 500 Internal Error

```bash
# Check system health
curl "$BASE_URL/healthz" | jq '.checks[] | select(.status != "healthy")'
```

**Solutions**:
- Check health endpoint for degraded systems
- Contact support with requestId from error response

### Debug Mode

Add verbose logging to requests:

```bash
curl -v "$BASE_URL/signals" \
  -H "Authorization: Bearer $API_KEY" \
  2>&1 | tee debug.log
```

### Contact Support

If tests continue to fail:

1. Capture the `requestId` from error response
2. Note the timestamp
3. Include your organisation ID
4. Email support@izenzo.co.za

---

## Test Checklist

Before going to production, verify:

- [ ] Health check returns `healthy`
- [ ] Authentication works with your API key
- [ ] Signal creation returns 201
- [ ] Signal retrieval works
- [ ] Match creation returns 201 with hash
- [ ] Match settlement works
- [ ] Evidence pack generation works
- [ ] Audit logs are being created
- [ ] Webhooks are received and verified
- [ ] Rate limiting works as expected
- [ ] Error responses are properly formatted
- [ ] Idempotency keys prevent duplicates
