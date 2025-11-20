import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CheckCircle2, XCircle, Loader2, Play, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface TestResult {
  name: string;
  endpoint: string;
  status: "pending" | "running" | "passed" | "failed" | "skipped";
  message?: string;
  duration?: number;
  details?: any;
}

interface TestSuite {
  name: string;
  tests: TestResult[];
}

export default function ComprehensiveApiTests() {
  const [running, setRunning] = useState(false);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const { toast } = useToast();

  const [testSuites, setTestSuites] = useState<TestSuite[]>([
    {
      name: "Authentication",
      tests: [
        { name: "Valid API Key", endpoint: "GET /signals", status: "pending" },
        { name: "Invalid API Key", endpoint: "GET /signals", status: "pending" },
        { name: "Missing API Key", endpoint: "GET /signals", status: "pending" },
      ],
    },
    {
      name: "API Keys Management",
      tests: [
        { name: "Create API Key", endpoint: "POST /api-keys", status: "pending" },
        { name: "List API Keys", endpoint: "GET /api-keys", status: "pending" },
        { name: "Create Key with Expiry", endpoint: "POST /api-keys", status: "pending" },
        { name: "Revoke API Key", endpoint: "DELETE /api-keys/:id", status: "pending" },
      ],
    },
    {
      name: "Signals",
      tests: [
        { name: "Create Buyer Signal", endpoint: "POST /signals", status: "pending" },
        { name: "Create Seller Signal", endpoint: "POST /signals", status: "pending" },
        { name: "Get Signal by ID", endpoint: "GET /signals/:id", status: "pending" },
        { name: "List All Signals", endpoint: "GET /signals", status: "pending" },
        { name: "Signal Validation", endpoint: "POST /signals", status: "pending" },
      ],
    },
    {
      name: "Matches",
      tests: [
        { name: "Create Match", endpoint: "POST /match", status: "pending" },
        { name: "Verify Hash Generation", endpoint: "POST /match", status: "pending" },
        { name: "Settle Match", endpoint: "PUT /match/:id/settle", status: "pending" },
        { name: "Idempotency Check", endpoint: "POST /match", status: "pending" },
      ],
    },
    {
      name: "Webhooks",
      tests: [
        { name: "Create Webhook", endpoint: "POST /webhooks", status: "pending" },
        { name: "List Webhooks", endpoint: "GET /webhooks", status: "pending" },
        { name: "Update Webhook", endpoint: "PUT /webhooks/:id", status: "pending" },
        { name: "Delete Webhook", endpoint: "DELETE /webhooks/:id", status: "pending" },
      ],
    },
    {
      name: "Data Sources",
      tests: [
        { name: "Create Data Source", endpoint: "POST /data-sources", status: "pending" },
        { name: "List Data Sources", endpoint: "GET /data-sources", status: "pending" },
        { name: "Update Data Source", endpoint: "PUT /data-sources/:id", status: "pending" },
      ],
    },
  ]);

  const baseUrl = import.meta.env.VITE_SUPABASE_URL + "/functions/v1";

  const updateTest = (suiteName: string, testName: string, updates: Partial<TestResult>) => {
    setTestSuites((prev) =>
      prev.map((suite) =>
        suite.name === suiteName
          ? {
              ...suite,
              tests: suite.tests.map((test) =>
                test.name === testName ? { ...test, ...updates } : test
              ),
            }
          : suite
      )
    );
  };

  const resetTests = () => {
    setTestSuites((prev) =>
      prev.map((suite) => ({
        ...suite,
        tests: suite.tests.map((test) => ({
          ...test,
          status: "pending" as const,
          message: undefined,
          duration: undefined,
          details: undefined,
        })),
      }))
    );
  };

  const runTests = async () => {
    setRunning(true);
    resetTests();

    try {
      // Get session token for authenticated requests
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast({
          title: "Authentication Required",
          description: "Please log in to run tests",
          variant: "destructive",
        });
        setRunning(false);
        return;
      }

      const token = session.access_token;

      // Test Suite 1: Authentication Tests
      await testAuthentication(token);

      // Test Suite 2: API Keys Management
      await testApiKeysManagement(token);

      // Test Suite 3: Signals
      await testSignals(token);

      // Test Suite 4: Matches
      await testMatches(token);

      // Test Suite 5: Webhooks
      await testWebhooks(token);

      // Test Suite 6: Data Sources
      await testDataSources(token);

      toast({
        title: "Tests Complete",
        description: "All API tests have finished running",
      });
    } catch (error) {
      console.error("Test suite error:", error);
      toast({
        title: "Test Suite Error",
        description: error instanceof Error ? error.message : "Unknown error occurred",
        variant: "destructive",
      });
    } finally {
      setRunning(false);
    }
  };

  const testAuthentication = async (token: string) => {
    const suite = "Authentication";

    // Test 1: Valid API Key (using JWT token)
    try {
      updateTest(suite, "Valid API Key", { status: "running" });
      const start = Date.now();
      
      const response = await fetch(`${baseUrl}/signals`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      
      const duration = Date.now() - start;
      
      if (response.ok) {
        updateTest(suite, "Valid API Key", {
          status: "passed",
          message: "Successfully authenticated",
          duration,
        });
      } else {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (error) {
      updateTest(suite, "Valid API Key", {
        status: "failed",
        message: error instanceof Error ? error.message : "Authentication failed",
      });
    }

    // Test 2: Invalid API Key
    try {
      updateTest(suite, "Invalid API Key", { status: "running" });
      const start = Date.now();
      
      const response = await fetch(`${baseUrl}/signals`, {
        headers: { Authorization: "Bearer invalid_key_123" },
      });
      
      const duration = Date.now() - start;
      
      if (response.status === 401) {
        updateTest(suite, "Invalid API Key", {
          status: "passed",
          message: "Correctly rejected invalid key",
          duration,
        });
      } else {
        throw new Error(`Expected 401, got ${response.status}`);
      }
    } catch (error) {
      updateTest(suite, "Invalid API Key", {
        status: "failed",
        message: error instanceof Error ? error.message : "Test failed",
      });
    }

    // Test 3: Missing API Key
    try {
      updateTest(suite, "Missing API Key", { status: "running" });
      const start = Date.now();
      
      const response = await fetch(`${baseUrl}/signals`);
      
      const duration = Date.now() - start;
      
      if (response.status === 401) {
        updateTest(suite, "Missing API Key", {
          status: "passed",
          message: "Correctly rejected missing authentication",
          duration,
        });
      } else {
        throw new Error(`Expected 401, got ${response.status}`);
      }
    } catch (error) {
      updateTest(suite, "Missing API Key", {
        status: "failed",
        message: error instanceof Error ? error.message : "Test failed",
      });
    }
  };

  const testApiKeysManagement = async (token: string) => {
    const suite = "API Keys Management";
    let createdKeyId: string | null = null;

    // Test 1: Create API Key
    try {
      updateTest(suite, "Create API Key", { status: "running" });
      const start = Date.now();
      
      const response = await fetch(`${baseUrl}/api-keys`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "Test Key " + Date.now(),
          scopes: ["signals:read", "signals:write"],
          expires_at: null,
        }),
      });
      
      const duration = Date.now() - start;
      
      if (response.ok) {
        const data = await response.json();
        createdKeyId = data.id;
        setApiKey(data.key);
        
        updateTest(suite, "Create API Key", {
          status: "passed",
          message: `Created key: ${data.id}`,
          duration,
          details: data,
        });
      } else {
        const error = await response.json();
        throw new Error(error.message || `HTTP ${response.status}`);
      }
    } catch (error) {
      updateTest(suite, "Create API Key", {
        status: "failed",
        message: error instanceof Error ? error.message : "Failed to create key",
      });
    }

    // Test 2: List API Keys
    try {
      updateTest(suite, "List API Keys", { status: "running" });
      const start = Date.now();
      
      const response = await fetch(`${baseUrl}/api-keys`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      
      const duration = Date.now() - start;
      
      if (response.ok) {
        const data = await response.json();
        updateTest(suite, "List API Keys", {
          status: "passed",
          message: `Found ${data.data.length} keys`,
          duration,
        });
      } else {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (error) {
      updateTest(suite, "List API Keys", {
        status: "failed",
        message: error instanceof Error ? error.message : "Failed to list keys",
      });
    }

    // Test 3: Create Key with Expiry
    try {
      updateTest(suite, "Create Key with Expiry", { status: "running" });
      const start = Date.now();
      
      const expiryDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      
      const response = await fetch(`${baseUrl}/api-keys`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "Expiring Test Key",
          scopes: ["signals:read"],
          expires_at: expiryDate,
        }),
      });
      
      const duration = Date.now() - start;
      
      if (response.ok) {
        const data = await response.json();
        updateTest(suite, "Create Key with Expiry", {
          status: "passed",
          message: "Created key with expiry date",
          duration,
        });
        
        // Clean up - revoke this key
        await fetch(`${baseUrl}/api-keys/${data.id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        });
      } else {
        const error = await response.json();
        throw new Error(error.message || `HTTP ${response.status}`);
      }
    } catch (error) {
      updateTest(suite, "Create Key with Expiry", {
        status: "failed",
        message: error instanceof Error ? error.message : "Failed to create key with expiry",
      });
    }

    // Test 4: Revoke API Key
    if (createdKeyId) {
      try {
        updateTest(suite, "Revoke API Key", { status: "running" });
        const start = Date.now();
        
        const response = await fetch(`${baseUrl}/api-keys/${createdKeyId}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        });
        
        const duration = Date.now() - start;
        
        if (response.ok || response.status === 204) {
          updateTest(suite, "Revoke API Key", {
            status: "passed",
            message: "Successfully revoked key",
            duration,
          });
        } else {
          throw new Error(`HTTP ${response.status}`);
        }
      } catch (error) {
        updateTest(suite, "Revoke API Key", {
          status: "failed",
          message: error instanceof Error ? error.message : "Failed to revoke key",
        });
      }
    } else {
      updateTest(suite, "Revoke API Key", {
        status: "skipped",
        message: "No key to revoke",
      });
    }
  };

  const testSignals = async (token: string) => {
    const suite = "Signals";
    let signalId: string | null = null;

    // Test 1: Create Buyer Signal
    try {
      updateTest(suite, "Create Buyer Signal", { status: "running" });
      const start = Date.now();
      
      const response = await fetch(`${baseUrl}/signals`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: "buyer",
          product: "Test Product",
          quantity: 100,
          unit: "kg",
          location: "Test Location",
          budget: 5000,
          currency: "USD",
        }),
      });
      
      const duration = Date.now() - start;
      
      if (response.ok) {
        const data = await response.json();
        signalId = data.signal.id;
        updateTest(suite, "Create Buyer Signal", {
          status: "passed",
          message: `Created signal: ${data.signal.id}`,
          duration,
        });
      } else {
        const error = await response.json();
        throw new Error(error.message || `HTTP ${response.status}`);
      }
    } catch (error) {
      updateTest(suite, "Create Buyer Signal", {
        status: "failed",
        message: error instanceof Error ? error.message : "Failed to create signal",
      });
    }

    // Test 2: Create Seller Signal
    try {
      updateTest(suite, "Create Seller Signal", { status: "running" });
      const start = Date.now();
      
      const response = await fetch(`${baseUrl}/signals`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: "seller",
          product: "Test Product for Sale",
          quantity: 200,
          unit: "kg",
          location: "Warehouse A",
        }),
      });
      
      const duration = Date.now() - start;
      
      if (response.ok) {
        updateTest(suite, "Create Seller Signal", {
          status: "passed",
          message: "Created seller signal",
          duration,
        });
      } else {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (error) {
      updateTest(suite, "Create Seller Signal", {
        status: "failed",
        message: error instanceof Error ? error.message : "Failed",
      });
    }

    // Test 3: Get Signal by ID
    if (signalId) {
      try {
        updateTest(suite, "Get Signal by ID", { status: "running" });
        const start = Date.now();
        
        const response = await fetch(`${baseUrl}/signals/${signalId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        
        const duration = Date.now() - start;
        
        if (response.ok) {
          updateTest(suite, "Get Signal by ID", {
            status: "passed",
            message: "Retrieved signal details",
            duration,
          });
        } else {
          throw new Error(`HTTP ${response.status}`);
        }
      } catch (error) {
        updateTest(suite, "Get Signal by ID", {
          status: "failed",
          message: error instanceof Error ? error.message : "Failed",
        });
      }
    } else {
      updateTest(suite, "Get Signal by ID", {
        status: "skipped",
        message: "No signal to retrieve",
      });
    }

    // Test 4: List All Signals
    try {
      updateTest(suite, "List All Signals", { status: "running" });
      const start = Date.now();
      
      const response = await fetch(`${baseUrl}/signals`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      
      const duration = Date.now() - start;
      
      if (response.ok) {
        const data = await response.json();
        updateTest(suite, "List All Signals", {
          status: "passed",
          message: `Found ${data.length} signals`,
          duration,
        });
      } else {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (error) {
      updateTest(suite, "List All Signals", {
        status: "failed",
        message: error instanceof Error ? error.message : "Failed",
      });
    }

    // Test 5: Signal Validation
    try {
      updateTest(suite, "Signal Validation", { status: "running" });
      const start = Date.now();
      
      const response = await fetch(`${baseUrl}/signals`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: "buyer",
          // Missing required 'product' field
        }),
      });
      
      const duration = Date.now() - start;
      
      if (response.status === 400) {
        updateTest(suite, "Signal Validation", {
          status: "passed",
          message: "Correctly validated input",
          duration,
        });
      } else {
        throw new Error(`Expected 400, got ${response.status}`);
      }
    } catch (error) {
      updateTest(suite, "Signal Validation", {
        status: "failed",
        message: error instanceof Error ? error.message : "Failed",
      });
    }
  };

  const testMatches = async (token: string) => {
    const suite = "Matches";
    let matchId: string | null = null;
    let matchHash: string | null = null;
    const idempotencyKey = `test-${Date.now()}`;

    // Test 1: Create Match
    try {
      updateTest(suite, "Create Match", { status: "running" });
      const start = Date.now();
      
      const matchBody = {
        buyer: { id: "TEST_BUYER_1", name: "Test Buyer Corp" },
        seller: { id: "TEST_SELLER_1", name: "Test Seller Inc" },
        commodity: "Test Commodity",
        quantity: { amount: 100, unit: "kg" },
        price: { amount: 1000, currency: "USD" },
        terms: "Test terms and conditions",
      };
      
      const response = await fetch(`${baseUrl}/match`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify(matchBody),
      });
      
      const duration = Date.now() - start;
      
      if (response.ok) {
        const data = await response.json();
        matchId = data.id;
        matchHash = data.hash;
        updateTest(suite, "Create Match", {
          status: "passed",
          message: `Created match: ${data.id}`,
          duration,
        });
      } else {
        const error = await response.json();
        throw new Error(error.message || `HTTP ${response.status}`);
      }
    } catch (error) {
      updateTest(suite, "Create Match", {
        status: "failed",
        message: error instanceof Error ? error.message : "Failed",
      });
    }

    // Test 2: Verify Hash Generation
    if (matchHash) {
      updateTest(suite, "Verify Hash Generation", {
        status: "passed",
        message: `Hash generated: ${matchHash.substring(0, 16)}...`,
      });
    } else {
      updateTest(suite, "Verify Hash Generation", {
        status: "failed",
        message: "No hash was generated",
      });
    }

    // Test 3: Settle Match
    if (matchId) {
      try {
        updateTest(suite, "Settle Match", { status: "running" });
        const start = Date.now();
        
        const response = await fetch(`${baseUrl}/match/${matchId}/settle`, {
          method: "PUT",
          headers: { Authorization: `Bearer ${token}` },
        });
        
        const duration = Date.now() - start;
        
        if (response.ok) {
          updateTest(suite, "Settle Match", {
            status: "passed",
            message: "Match settled successfully",
            duration,
          });
        } else {
          throw new Error(`HTTP ${response.status}`);
        }
      } catch (error) {
        updateTest(suite, "Settle Match", {
          status: "failed",
          message: error instanceof Error ? error.message : "Failed",
        });
      }
    } else {
      updateTest(suite, "Settle Match", {
        status: "skipped",
        message: "No match to settle",
      });
    }

    // Test 4: Idempotency Check
    try {
      updateTest(suite, "Idempotency Check", { status: "running" });
      const start = Date.now();
      
      const matchBody = {
        buyer: { id: "TEST_BUYER_2", name: "Test Buyer 2" },
        seller: { id: "TEST_SELLER_2", name: "Test Seller 2" },
        commodity: "Idempotency Test",
        quantity: { amount: 50, unit: "units" },
        price: { amount: 500, currency: "USD" },
      };
      
      const response = await fetch(`${baseUrl}/match`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey, // Same key as test 1
        },
        body: JSON.stringify(matchBody),
      });
      
      const duration = Date.now() - start;
      
      if (response.ok) {
        const data = await response.json();
        // Should return the same match as before
        if (data.id === matchId) {
          updateTest(suite, "Idempotency Check", {
            status: "passed",
            message: "Idempotency key working correctly",
            duration,
          });
        } else {
          throw new Error("Different match returned");
        }
      } else {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (error) {
      updateTest(suite, "Idempotency Check", {
        status: "failed",
        message: error instanceof Error ? error.message : "Failed",
      });
    }
  };

  const testWebhooks = async (token: string) => {
    const suite = "Webhooks";
    let webhookId: string | null = null;

    // Test 1: Create Webhook
    try {
      updateTest(suite, "Create Webhook", { status: "running" });
      const start = Date.now();
      
      const response = await fetch(`${baseUrl}/webhooks`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url: "https://example.com/webhook-test",
          events: ["signal.created", "match.created"],
        }),
      });
      
      const duration = Date.now() - start;
      
      if (response.ok) {
        const data = await response.json();
        webhookId = data.id;
        updateTest(suite, "Create Webhook", {
          status: "passed",
          message: `Created webhook: ${data.id}`,
          duration,
        });
      } else {
        const error = await response.json();
        throw new Error(error.message || `HTTP ${response.status}`);
      }
    } catch (error) {
      updateTest(suite, "Create Webhook", {
        status: "failed",
        message: error instanceof Error ? error.message : "Failed",
      });
    }

    // Test 2: List Webhooks
    try {
      updateTest(suite, "List Webhooks", { status: "running" });
      const start = Date.now();
      
      const response = await fetch(`${baseUrl}/webhooks`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      
      const duration = Date.now() - start;
      
      if (response.ok) {
        const data = await response.json();
        updateTest(suite, "List Webhooks", {
          status: "passed",
          message: `Found ${data.length} webhooks`,
          duration,
        });
      } else {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (error) {
      updateTest(suite, "List Webhooks", {
        status: "failed",
        message: error instanceof Error ? error.message : "Failed",
      });
    }

    // Test 3: Update Webhook
    if (webhookId) {
      try {
        updateTest(suite, "Update Webhook", { status: "running" });
        const start = Date.now();
        
        const response = await fetch(`${baseUrl}/webhooks/${webhookId}`, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            events: ["signal.created"],
          }),
        });
        
        const duration = Date.now() - start;
        
        if (response.ok) {
          updateTest(suite, "Update Webhook", {
            status: "passed",
            message: "Webhook updated",
            duration,
          });
        } else {
          throw new Error(`HTTP ${response.status}`);
        }
      } catch (error) {
        updateTest(suite, "Update Webhook", {
          status: "failed",
          message: error instanceof Error ? error.message : "Failed",
        });
      }
    } else {
      updateTest(suite, "Update Webhook", {
        status: "skipped",
        message: "No webhook to update",
      });
    }

    // Test 4: Delete Webhook
    if (webhookId) {
      try {
        updateTest(suite, "Delete Webhook", { status: "running" });
        const start = Date.now();
        
        const response = await fetch(`${baseUrl}/webhooks/${webhookId}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        });
        
        const duration = Date.now() - start;
        
        if (response.ok || response.status === 204) {
          updateTest(suite, "Delete Webhook", {
            status: "passed",
            message: "Webhook deleted",
            duration,
          });
        } else {
          throw new Error(`HTTP ${response.status}`);
        }
      } catch (error) {
        updateTest(suite, "Delete Webhook", {
          status: "failed",
          message: error instanceof Error ? error.message : "Failed",
        });
      }
    } else {
      updateTest(suite, "Delete Webhook", {
        status: "skipped",
        message: "No webhook to delete",
      });
    }
  };

  const testDataSources = async (token: string) => {
    const suite = "Data Sources";
    let dataSourceId: string | null = null;

    // Test 1: Create Data Source
    try {
      updateTest(suite, "Create Data Source", { status: "running" });
      const start = Date.now();
      
      const response = await fetch(`${baseUrl}/data-sources`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "Test Data Source",
          type: "api",
          config: {
            endpoint: "https://api.example.com/data",
            method: "GET",
          },
        }),
      });
      
      const duration = Date.now() - start;
      
      if (response.ok) {
        const data = await response.json();
        dataSourceId = data.id;
        updateTest(suite, "Create Data Source", {
          status: "passed",
          message: `Created data source: ${data.id}`,
          duration,
        });
      } else {
        const error = await response.json();
        throw new Error(error.message || `HTTP ${response.status}`);
      }
    } catch (error) {
      updateTest(suite, "Create Data Source", {
        status: "failed",
        message: error instanceof Error ? error.message : "Failed",
      });
    }

    // Test 2: List Data Sources
    try {
      updateTest(suite, "List Data Sources", { status: "running" });
      const start = Date.now();
      
      const response = await fetch(`${baseUrl}/data-sources`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      
      const duration = Date.now() - start;
      
      if (response.ok) {
        const data = await response.json();
        updateTest(suite, "List Data Sources", {
          status: "passed",
          message: `Found ${data.length} data sources`,
          duration,
        });
      } else {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (error) {
      updateTest(suite, "List Data Sources", {
        status: "failed",
        message: error instanceof Error ? error.message : "Failed",
      });
    }

    // Test 3: Update Data Source
    if (dataSourceId) {
      try {
        updateTest(suite, "Update Data Source", { status: "running" });
        const start = Date.now();
        
        const response = await fetch(`${baseUrl}/data-sources/${dataSourceId}`, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: "Updated Test Data Source",
          }),
        });
        
        const duration = Date.now() - start;
        
        if (response.ok) {
          updateTest(suite, "Update Data Source", {
            status: "passed",
            message: "Data source updated",
            duration,
          });
        } else {
          throw new Error(`HTTP ${response.status}`);
        }
      } catch (error) {
        updateTest(suite, "Update Data Source", {
          status: "failed",
          message: error instanceof Error ? error.message : "Failed",
        });
      }
    } else {
      updateTest(suite, "Update Data Source", {
        status: "skipped",
        message: "No data source to update",
      });
    }
  };

  const getStatusIcon = (status: TestResult["status"]) => {
    switch (status) {
      case "passed":
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case "failed":
        return <XCircle className="h-4 w-4 text-red-500" />;
      case "running":
        return <Loader2 className="h-4 w-4 animate-spin text-blue-500" />;
      case "skipped":
        return <RefreshCw className="h-4 w-4 text-gray-400" />;
      default:
        return <div className="h-4 w-4 rounded-full bg-muted" />;
    }
  };

  const getStatusBadge = (status: TestResult["status"]) => {
    const variants: Record<TestResult["status"], any> = {
      passed: "default",
      failed: "destructive",
      running: "secondary",
      pending: "outline",
      skipped: "outline",
    };

    return (
      <Badge variant={variants[status]} className="text-xs">
        {status}
      </Badge>
    );
  };

  const calculateStats = () => {
    const allTests = testSuites.flatMap((suite) => suite.tests);
    return {
      total: allTests.length,
      passed: allTests.filter((t) => t.status === "passed").length,
      failed: allTests.filter((t) => t.status === "failed").length,
      skipped: allTests.filter((t) => t.status === "skipped").length,
      pending: allTests.filter((t) => t.status === "pending").length,
    };
  };

  const stats = calculateStats();

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Comprehensive API Test Suite</span>
            <Button onClick={runTests} disabled={running}>
              {running ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Running Tests...
                </>
              ) : (
                <>
                  <Play className="mr-2 h-4 w-4" />
                  Run All Tests
                </>
              )}
            </Button>
          </CardTitle>
          <CardDescription>
            Automated testing suite covering all API endpoints and functionality
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Test Statistics */}
          <div className="grid grid-cols-5 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-foreground">{stats.total}</div>
              <div className="text-xs text-muted-foreground">Total Tests</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-500">{stats.passed}</div>
              <div className="text-xs text-muted-foreground">Passed</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-red-500">{stats.failed}</div>
              <div className="text-xs text-muted-foreground">Failed</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-gray-400">{stats.skipped}</div>
              <div className="text-xs text-muted-foreground">Skipped</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-muted-foreground">{stats.pending}</div>
              <div className="text-xs text-muted-foreground">Pending</div>
            </div>
          </div>

          {apiKey && (
            <Alert>
              <AlertDescription>
                <div className="font-medium mb-1">API Key Created</div>
                <code className="text-xs bg-muted p-1 rounded">{apiKey}</code>
                <div className="text-xs text-muted-foreground mt-1">
                  Save this key to test with external tools
                </div>
              </AlertDescription>
            </Alert>
          )}

          {/* Test Results by Suite */}
          <Tabs defaultValue={testSuites[0]?.name} className="w-full">
            <TabsList className="grid w-full grid-cols-6">
              {testSuites.map((suite) => (
                <TabsTrigger key={suite.name} value={suite.name}>
                  {suite.name}
                </TabsTrigger>
              ))}
            </TabsList>

            {testSuites.map((suite) => (
              <TabsContent key={suite.name} value={suite.name} className="space-y-4 mt-4">
                {suite.tests.map((test) => (
                  <div
                    key={test.name}
                    className="flex items-start justify-between p-4 border rounded-lg"
                  >
                    <div className="flex items-start gap-3 flex-1">
                      {getStatusIcon(test.status)}
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{test.name}</span>
                          {getStatusBadge(test.status)}
                        </div>
                        <code className="text-xs text-muted-foreground">{test.endpoint}</code>
                        {test.message && (
                          <p className="text-sm text-muted-foreground mt-1">{test.message}</p>
                        )}
                        {test.duration && (
                          <p className="text-xs text-muted-foreground mt-1">
                            Duration: {test.duration}ms
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
