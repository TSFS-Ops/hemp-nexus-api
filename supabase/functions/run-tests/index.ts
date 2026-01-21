import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { hashApiKey, authenticateRequest, requireRole } from "../_shared/auth.ts";
import { ApiException, errorResponse } from "../_shared/errors.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";

interface TestResult {
  name: string;
  category: string;
  status: "passed" | "failed" | "skipped";
  duration: number;
  error?: string;
  details?: any;
}

/**
 * Automated Test Suite Runner
 * 
 * SECURITY: This endpoint requires admin authentication to prevent:
 * - Unauthorized test data creation
 * - Exposure of internal API structure
 * - Resource exhaustion attacks
 * 
 * Rate limited to 2 requests/minute, 10/hour, 50/day per admin
 */

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  const allowedOrigins = Deno.env.get("ALLOWED_ORIGINS") || "*";
  const origin = req.headers.get("origin");
  const headers = corsHeaders(allowedOrigins, origin);

  const corsResponse = handleCors(req, allowedOrigins);
  if (corsResponse) return corsResponse;

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    // SECURITY: Require admin authentication to run tests
    const authCtx = await authenticateRequest(req, supabaseUrl, supabaseKey);
    requireRole(authCtx, 'admin');

    // SECURITY: Strict rate limit - tests are expensive operations
    // 2 per minute, 10 per hour, 50 per day
    await checkRateLimit(
      supabase,
      authCtx.orgId,
      null, // No API key for admin auth
      "run-tests",
      "admin:tests"
    );

  const results: TestResult[] = [];
  let testApiKey: string | null = null;
  let testOrgId: string | null = null;
  let testUserId: string | null = null;

  // Helper function to run a test
  const runTest = async (
    name: string,
    category: string,
    testFn: () => Promise<void>
  ): Promise<void> => {
    const start = Date.now();
    try {
      await testFn();
      results.push({
        name,
        category,
        status: "passed",
        duration: Date.now() - start
      });
    } catch (error) {
      results.push({
        name,
        category,
        status: "failed",
        duration: Date.now() - start,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  };

  // Setup: Create test organization and API key
  try {
    // Create test org
    const { data: org, error: orgError } = await supabase
      .from("organizations")
      .insert({ name: "Test Organization (Auto-Test)", status: "active" })
      .select()
      .single();

    if (orgError) throw orgError;
    testOrgId = org.id;

    // Generate test API key
    const rawKey = `test_${crypto.randomUUID()}`;
    const keyHash = await hashApiKey(rawKey);

    const { data: apiKeyData, error: keyError } = await supabase
      .from("api_keys")
      .insert({
        org_id: testOrgId,
        name: "Auto-Test Key",
        key_hash: keyHash,
        scopes: ["signals:read", "signals:write", "match:write"],
        status: "active",
        environment: "sandbox"
      })
      .select()
      .single();

    if (keyError) throw keyError;
    testApiKey = rawKey;
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: "Failed to setup test environment",
        message: error instanceof Error ? error.message : String(error)
      }),
      { status: 500, headers: { "Content-Type": "application/json", ...headers } }
    );
  }

  // === AUTHENTICATION TESTS ===

  await runTest("API Key Authentication - Valid Key", "authentication", async () => {
    const response = await fetch(`${supabaseUrl}/functions/v1/healthz`, {
      headers: { "x-api-key": testApiKey! }
    });
    if (!response.ok) throw new Error(`Expected 200, got ${response.status}`);
  });

  await runTest("API Key Authentication - Invalid Key", "authentication", async () => {
    const response = await fetch(`${supabaseUrl}/functions/v1/signals`, {
      method: "POST",
      headers: {
        "x-api-key": "invalid_key_12345",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ product: "Test" })
    });
    if (response.status !== 401) throw new Error(`Expected 401, got ${response.status}`);
  });

  await runTest("API Key Authentication - Missing Key", "authentication", async () => {
    const response = await fetch(`${supabaseUrl}/functions/v1/signals`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ product: "Test" })
    });
    if (response.status !== 401) throw new Error(`Expected 401, got ${response.status}`);
  });

  // === SIGNALS ENDPOINT TESTS ===

  let createdSignalId: string | null = null;

  await runTest("Signals - Create Valid Signal", "signals", async () => {
    const response = await fetch(`${supabaseUrl}/functions/v1/signals`, {
      method: "POST",
      headers: {
        "x-api-key": testApiKey!,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        product: "Test Product for Automated Testing",
        quantity: 100,
        unit: "units",
        location: "Test Location",
        budget: 1000,
        currency: "USD"
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Expected 201, got ${response.status}: ${JSON.stringify(errorData)}`);
    }

    const data = await response.json();
    if (!data.signalId) throw new Error("No signalId in response");
    createdSignalId = data.signalId;
  });

  await runTest("Signals - Create Signal Missing Required Field", "signals", async () => {
    const response = await fetch(`${supabaseUrl}/functions/v1/signals`, {
      method: "POST",
      headers: {
        "x-api-key": testApiKey!,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        quantity: 100,
        unit: "units"
      })
    });
    if (response.status !== 400) throw new Error(`Expected 400, got ${response.status}`);
  });

  await runTest("Signals - Get Signal by ID", "signals", async () => {
    if (!createdSignalId) throw new Error("No signal ID from previous test");

    const response = await fetch(`${supabaseUrl}/functions/v1/signals/${createdSignalId}`, {
      headers: { "x-api-key": testApiKey! }
    });

    if (!response.ok) throw new Error(`Expected 200, got ${response.status}`);
    
    const data = await response.json();
    if (!data.signal) throw new Error("No signal in response");
    if (data.signal.id !== createdSignalId) throw new Error("Signal ID mismatch");
  });

  await runTest("Signals - List Signals", "signals", async () => {
    const response = await fetch(`${supabaseUrl}/functions/v1/signals`, {
      headers: { "x-api-key": testApiKey! }
    });

    if (!response.ok) throw new Error(`Expected 200, got ${response.status}`);
    
    const data = await response.json();
    if (!Array.isArray(data.data)) throw new Error("Expected array of signals");
  });

  await runTest("Signals - Get Non-existent Signal", "signals", async () => {
    const fakeId = crypto.randomUUID();
    const response = await fetch(`${supabaseUrl}/functions/v1/signals/${fakeId}`, {
      headers: { "x-api-key": testApiKey! }
    });

    if (response.status !== 404 && response.status !== 500) {
      throw new Error(`Expected 404 or 500, got ${response.status}`);
    }
  });

  // === MATCH ENDPOINT TESTS ===

  await runTest("Match - Create Valid Match", "matches", async () => {
    const response = await fetch(`${supabaseUrl}/functions/v1/match`, {
      method: "POST",
      headers: {
        "x-api-key": testApiKey!,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        buyer: {
          id: "test-buyer-001",
          name: "Test Buyer Corp"
        },
        seller: {
          id: "test-seller-001",
          name: "Test Seller Inc"
        },
        commodity: "Test Product",
        quantity: {
          amount: 100,
          unit: "units"
        },
        price: {
          amount: 50.00,
          currency: "USD"
        },
        terms: "Net 30 days"
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Expected 201, got ${response.status}: ${JSON.stringify(errorData)}`);
    }

    const data = await response.json();
    if (!data.matchId) throw new Error("No matchId in response");
  });

  await runTest("Match - Create Match Missing Required Field", "matches", async () => {
    const response = await fetch(`${supabaseUrl}/functions/v1/match`, {
      method: "POST",
      headers: {
        "x-api-key": testApiKey!,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        buyer: { id: "test-buyer", name: "Test" },
        seller: { id: "test-seller", name: "Test" }
        // Missing commodity, quantity, price
      })
    });
    if (response.status !== 400) throw new Error(`Expected 400, got ${response.status}`);
  });

  // === API KEYS ENDPOINT TESTS ===

  await runTest("API Keys - List Keys (Requires Auth)", "api-keys", async () => {
    // This test would require JWT auth, skip for now
    results[results.length - 1].status = "skipped";
    results[results.length - 1].details = { reason: "Requires JWT authentication" };
  });

  // === VALIDATION TESTS ===

  await runTest("Validation - Invalid JSON", "validation", async () => {
    const response = await fetch(`${supabaseUrl}/functions/v1/signals`, {
      method: "POST",
      headers: {
        "x-api-key": testApiKey!,
        "Content-Type": "application/json"
      },
      body: "{ invalid json }"
    });
    if (response.status !== 400 && response.status !== 500) {
      throw new Error(`Expected 400 or 500, got ${response.status}`);
    }
  });

  await runTest("Validation - Invalid Data Types", "validation", async () => {
    const response = await fetch(`${supabaseUrl}/functions/v1/signals`, {
      method: "POST",
      headers: {
        "x-api-key": testApiKey!,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        product: "Test",
        quantity: "not-a-number", // Should be number
        unit: "units"
      })
    });
    if (response.status !== 400) throw new Error(`Expected 400, got ${response.status}`);
  });

  // Cleanup: Delete test data
  try {
    if (testOrgId) {
      // Delete API keys
      await supabase.from("api_keys").delete().eq("org_id", testOrgId);
      // Delete signals
      await supabase.from("signals").delete().eq("org_id", testOrgId);
      // Delete matches
      await supabase.from("matches").delete().eq("org_id", testOrgId);
      // Delete org
      await supabase.from("organizations").delete().eq("id", testOrgId);
    }
  } catch (error) {
    console.error("Cleanup error:", error);
  }

  // Calculate summary
  const summary = {
    total: results.length,
    passed: results.filter(r => r.status === "passed").length,
    failed: results.filter(r => r.status === "failed").length,
    skipped: results.filter(r => r.status === "skipped").length,
    duration: results.reduce((sum, r) => sum + r.duration, 0)
  };

  const categories = [...new Set(results.map(r => r.category))].map(category => ({
    name: category,
    total: results.filter(r => r.category === category).length,
    passed: results.filter(r => r.category === category && r.status === "passed").length,
    failed: results.filter(r => r.category === category && r.status === "failed").length
  }));

  return new Response(
    JSON.stringify({
      summary,
      categories,
      results,
      timestamp: new Date().toISOString()
    }, null, 2),
    {
      status: summary.failed > 0 ? 207 : 200,
      headers: { "Content-Type": "application/json", ...headers }
    }
  );
  } catch (error) {
    console.error(`[${requestId}] Run-tests error:`, error);
    return errorResponse(error as Error, requestId, headers);
  }
});
