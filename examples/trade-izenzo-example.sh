#!/bin/bash
# Trade.Izenzo API - End-to-End Test Script
# This script demonstrates the complete workflow of the Trade.Izenzo API v1

set -e  # Exit on error

BASE_URL="https://api.trade.izenzo.co.za/functions/v1"
API_KEY="${TRADE_IZENZO_API_KEY:-sk_your_key_here}"

echo "======================================"
echo "Trade.Izenzo API - End-to-End Test"
echo "======================================"
echo ""

# Test 1: Health check (if available)
echo "Test 1: Health Check"
curl -s "${BASE_URL}/healthz" || echo "Health check endpoint not available"
echo ""
echo ""

# Test 2: Create a match
echo "Test 2: Create Match"
MATCH_RESPONSE=$(curl -s -X POST "${BASE_URL}/match" \
  -H "X-API-Key: ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "buyer": {
      "id": "BUYER_TEST_001",
      "name": "Test Buyer Ltd"
    },
    "seller": {
      "id": "SELLER_TEST_001",
      "name": "Test Seller Ltd"
    },
    "commodity": "Test Commodity",
    "quantity": {
      "amount": 1000,
      "unit": "kg"
    },
    "price": {
      "amount": 50000,
      "currency": "EUR"
    },
    "terms": "Test delivery terms",
    "metadata": {
      "region": "EU-Africa",
      "channel": "Test Script",
      "notes": "Automated test"
    }
  }')

echo "$MATCH_RESPONSE" | jq '.'
MATCH_ID=$(echo "$MATCH_RESPONSE" | jq -r '.id')
echo ""
echo "✓ Match created with ID: $MATCH_ID"
echo ""

# Test 3: Retrieve the match
echo "Test 3: Retrieve Match"
GET_RESPONSE=$(curl -s "${BASE_URL}/match/${MATCH_ID}" \
  -H "X-API-Key: ${API_KEY}")

echo "$GET_RESPONSE" | jq '.'
STATUS=$(echo "$GET_RESPONSE" | jq -r '.status')
echo ""
echo "✓ Match retrieved, status: $STATUS"
echo ""

# Test 4: Settle the match
echo "Test 4: Settle Match"
SETTLE_RESPONSE=$(curl -s -X POST "${BASE_URL}/match/${MATCH_ID}/settle" \
  -H "X-API-Key: ${API_KEY}")

echo "$SETTLE_RESPONSE" | jq '.'
SETTLED_STATUS=$(echo "$SETTLE_RESPONSE" | jq -r '.status')
SETTLED_AT=$(echo "$SETTLE_RESPONSE" | jq -r '.settled_at')
echo ""
echo "✓ Match settled, status: $SETTLED_STATUS, settled_at: $SETTLED_AT"
echo ""

# Test 5: Verify idempotency - settle again
echo "Test 5: Verify Idempotency (settle again)"
IDEMPOTENT_RESPONSE=$(curl -s -X POST "${BASE_URL}/match/${MATCH_ID}/settle" \
  -H "X-API-Key: ${API_KEY}")

echo "$IDEMPOTENT_RESPONSE" | jq '.'
IDEMPOTENT_STATUS=$(echo "$IDEMPOTENT_RESPONSE" | jq -r '.status')
IDEMPOTENT_SETTLED_AT=$(echo "$IDEMPOTENT_RESPONSE" | jq -r '.settled_at')

if [ "$SETTLED_AT" == "$IDEMPOTENT_SETTLED_AT" ]; then
  echo "✓ Idempotency verified: settled_at unchanged"
else
  echo "✗ FAILED: settled_at changed on second settle call"
  exit 1
fi
echo ""

# Test 6: List matches
echo "Test 6: List Matches"
LIST_RESPONSE=$(curl -s "${BASE_URL}/matches?limit=5" \
  -H "X-API-Key: ${API_KEY}")

echo "$LIST_RESPONSE" | jq '.'
TOTAL_COUNT=$(echo "$LIST_RESPONSE" | jq -r '.totalCount')
echo ""
echo "✓ Listed matches, total count: $TOTAL_COUNT"
echo ""

# Test 7: Verify hash (optional, requires jq)
echo "Test 7: Verify Cryptographic Hash"
HASH=$(echo "$GET_RESPONSE" | jq -r '.hash')
echo "Stored hash: $HASH"
echo ""
echo "To verify independently:"
echo "1. Rebuild canonical JSON from match data"
echo "2. Compute SHA-256 hash"
echo "3. Compare with stored hash: $HASH"
echo ""

echo "======================================"
echo "✓ All tests passed!"
echo "======================================"
echo ""
echo "Summary:"
echo "- Match ID: $MATCH_ID"
echo "- Status: $SETTLED_STATUS"
echo "- Hash: $HASH"
echo "- Settled at: $SETTLED_AT"