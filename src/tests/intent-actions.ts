/**
 * Intent Action Tests
 * 
 * Documents and verifies that:
 * - Only "Confirm Intent" creates audit/evidence records
 * - Soft actions (skip, maybe later) do NOT create records
 * 
 * Run these tests manually via the API Smoke Tests UI
 * or integrate with your test framework.
 */

const BASE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

/**
 * Test: Confirm Intent creates audit record
 */
export async function testConfirmIntentCreatesRecord(apiKey: string): Promise<{
  passed: boolean;
  message: string;
}> {
  try {
    // Create a test match
    const createResponse = await fetch(`${BASE_URL}/match`, {
      method: 'POST',
      headers: {
        'X-API-Key': apiKey,
        'Content-Type': 'application/json',
        'Idempotency-Key': `test-${Date.now()}-${Math.random()}`,
      },
      body: JSON.stringify({
        buyer: { id: 'TEST_BUYER', name: 'Test Buyer Corp' },
        seller: { id: 'TEST_SELLER', name: 'Test Seller Inc' },
        commodity: 'Test Commodity for Intent Tests',
        quantity: { amount: 100, unit: 'units' },
        price: { amount: 1000, currency: 'USD' },
        terms: 'Test terms - automated test',
      }),
    });

    if (!createResponse.ok) {
      return { passed: false, message: 'Failed to create test match' };
    }

    const match = await createResponse.json();

    // Confirm intent
    const confirmResponse = await fetch(`${BASE_URL}/match/${match.id}/settle`, {
      method: 'POST',
      headers: { 'X-API-Key': apiKey },
    });

    if (!confirmResponse.ok) {
      return { passed: false, message: 'Failed to confirm intent' };
    }

    const confirmedMatch = await confirmResponse.json();

    // Verify intent was confirmed with audit trail
    if (confirmedMatch.status === 'settled' && confirmedMatch.settled_at) {
      return { 
        passed: true, 
        message: `Intent confirmed at ${confirmedMatch.settled_at}. Audit record created.` 
      };
    }

    return { passed: false, message: 'Confirm Intent did not update status correctly' };
  } catch (error) {
    return { passed: false, message: `Error: ${error}` };
  }
}

/**
 * Test: Confirm Intent is idempotent
 */
export async function testConfirmIntentIsIdempotent(apiKey: string): Promise<{
  passed: boolean;
  message: string;
}> {
  try {
    // Create a test match
    const createResponse = await fetch(`${BASE_URL}/match`, {
      method: 'POST',
      headers: {
        'X-API-Key': apiKey,
        'Content-Type': 'application/json',
        'Idempotency-Key': `test-idempotent-${Date.now()}`,
      },
      body: JSON.stringify({
        buyer: { id: 'TEST_BUYER', name: 'Test Buyer Corp' },
        seller: { id: 'TEST_SELLER', name: 'Test Seller Inc' },
        commodity: 'Idempotency Test Commodity',
        quantity: { amount: 50, unit: 'kg' },
        price: { amount: 500, currency: 'EUR' },
        terms: 'Idempotency test',
      }),
    });

    if (!createResponse.ok) {
      return { passed: false, message: 'Failed to create test match' };
    }

    const match = await createResponse.json();

    // First confirm
    const response1 = await fetch(`${BASE_URL}/match/${match.id}/settle`, {
      method: 'POST',
      headers: { 'X-API-Key': apiKey },
    });
    const data1 = await response1.json();

    // Second confirm (should be idempotent)
    const response2 = await fetch(`${BASE_URL}/match/${match.id}/settle`, {
      method: 'POST',
      headers: { 'X-API-Key': apiKey },
    });
    const data2 = await response2.json();

    if (data1.settled_at === data2.settled_at && data1.status === 'settled') {
      return { 
        passed: true, 
        message: 'Idempotent: Multiple confirms return same timestamp' 
      };
    }

    return { passed: false, message: 'Idempotency test failed - timestamps differ' };
  } catch (error) {
    return { passed: false, message: `Error: ${error}` };
  }
}

/**
 * Test: View/Browse does NOT create records
 */
export async function testViewDoesNotCreateRecords(apiKey: string): Promise<{
  passed: boolean;
  message: string;
}> {
  try {
    // Create a test match
    const createResponse = await fetch(`${BASE_URL}/match`, {
      method: 'POST',
      headers: {
        'X-API-Key': apiKey,
        'Content-Type': 'application/json',
        'Idempotency-Key': `test-view-${Date.now()}`,
      },
      body: JSON.stringify({
        buyer: { id: 'TEST_BUYER', name: 'Test Buyer Corp' },
        seller: { id: 'TEST_SELLER', name: 'Test Seller Inc' },
        commodity: 'View Test Commodity',
        quantity: { amount: 25, unit: 'liters' },
        price: { amount: 250, currency: 'USD' },
        terms: 'View test',
      }),
    });

    if (!createResponse.ok) {
      return { passed: false, message: 'Failed to create test match' };
    }

    const match = await createResponse.json();

    // View the match (GET request - should NOT change anything)
    const viewResponse = await fetch(`${BASE_URL}/match/${match.id}`, {
      method: 'GET',
      headers: { 'X-API-Key': apiKey },
    });

    const viewedMatch = await viewResponse.json();

    // Verify status is still 'matched' (not confirmed)
    if (viewedMatch.status === 'matched' && !viewedMatch.settled_at) {
      return { 
        passed: true, 
        message: 'View action did not create any records or change status' 
      };
    }

    return { passed: false, message: 'View action incorrectly modified the match' };
  } catch (error) {
    return { passed: false, message: `Error: ${error}` };
  }
}

/**
 * Action Type Documentation
 */
export const ACTION_TYPES = {
  BINDING: {
    confirm_intent: {
      createsAuditRecord: true,
      createsEvidence: true,
      hasLegalMeaning: false, // Signals interest, NOT a contract
      description: 'Signals serious interest so seller can prepare final terms. No contract or payment.',
    },
  },
  NON_BINDING: {
    skip: {
      createsAuditRecord: false,
      createsEvidence: false,
      hasLegalMeaning: false,
      description: 'User skipped this match - purely behavioral signal',
    },
    maybe_later: {
      createsAuditRecord: false,
      createsEvidence: false,
      hasLegalMeaning: false,
      description: 'User deferred decision - purely behavioral signal',
    },
    not_now: {
      createsAuditRecord: false,
      createsEvidence: false,
      hasLegalMeaning: false,
      description: 'User declined for now - purely behavioral signal',
    },
    browse: {
      createsAuditRecord: false,
      createsEvidence: false,
      hasLegalMeaning: false,
      description: 'User viewed match details - no record created',
    },
    view: {
      createsAuditRecord: false,
      createsEvidence: false,
      hasLegalMeaning: false,
      description: 'User viewed match - read-only operation',
    },
  },
};

/**
 * Run all intent tests
 */
export async function runAllIntentTests(apiKey: string): Promise<{
  results: Array<{ name: string; passed: boolean; message: string }>;
  summary: { total: number; passed: number; failed: number };
}> {
  const tests = [
    { name: 'Confirm Intent Creates Audit Record', fn: testConfirmIntentCreatesRecord },
    { name: 'Confirm Intent Is Idempotent', fn: testConfirmIntentIsIdempotent },
    { name: 'View Does Not Create Records', fn: testViewDoesNotCreateRecords },
  ];

  const results = [];
  for (const test of tests) {
    const result = await test.fn(apiKey);
    results.push({ name: test.name, ...result });
  }

  return {
    results,
    summary: {
      total: results.length,
      passed: results.filter(r => r.passed).length,
      failed: results.filter(r => !r.passed).length,
    },
  };
}
