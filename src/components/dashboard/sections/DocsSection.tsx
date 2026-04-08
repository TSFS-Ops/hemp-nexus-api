import { Alert, AlertDescription } from "@/components/ui/alert";
import { Coins, Key, Gauge, Info } from "lucide-react";

export function DocsSection() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-foreground mb-1">Overview</h1>
        <p className="text-muted-foreground">
          Izenzo API - trade request for regulated B2B commerce
        </p>
      </header>

      {/* What It Does */}
      <div className="p-4 border border-border rounded-lg bg-muted/30">
        <h3 className="font-medium text-foreground mb-2">What does this API do?</h3>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Search for trading partners, record trade request, and generate tamper-evident audit trails. 
          <strong className="text-foreground"> Confirm Intent</strong> creates an information-only record - no payment, no contract, no legal obligation.
        </p>
      </div>

      {/* Key Concepts */}
      <div className="grid sm:grid-cols-3 gap-4">
        <div className="p-4 border border-border rounded-lg bg-background">
          <div className="flex items-center gap-2 mb-2">
            <Coins className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium text-foreground">Token Metering</span>
          </div>
          <p className="text-sm text-muted-foreground">
            API calls consume tokens. 5,000 minimum balance required.
          </p>
        </div>

        <div className="p-4 border border-border rounded-lg bg-background">
          <div className="flex items-center gap-2 mb-2">
            <Key className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium text-foreground">Authentication</span>
          </div>
          <p className="text-sm text-muted-foreground">
            All requests require <code className="text-xs bg-muted px-1 py-0.5 rounded">X-API-Key</code> header.
          </p>
        </div>

        <div className="p-4 border border-border rounded-lg bg-background">
          <div className="flex items-center gap-2 mb-2">
            <Gauge className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium text-foreground">Rate Limits</span>
          </div>
          <p className="text-sm text-muted-foreground">
            60 requests/minute per API key.
          </p>
        </div>
      </div>

      {/* Base URL */}
      <div>
        <h3 className="text-sm font-medium text-foreground mb-2">Base URL</h3>
        <code className="block p-3 bg-muted rounded-lg text-sm font-mono text-foreground">
          https://api.compliancematch.dev/v1
        </code>
      </div>

      {/* Quick Example */}
      <div>
        <h3 className="text-sm font-medium text-foreground mb-2">Quick example</h3>
        <div className="border border-border rounded-lg overflow-hidden">
          <div className="px-3 py-2 bg-muted/50 border-b border-border">
            <span className="text-xs font-mono text-muted-foreground">POST /v1/match</span>
          </div>
          <pre className="p-4 text-sm overflow-x-auto font-mono">
{`curl -X POST https://api.compliancematch.dev/v1/match \\
  -H "X-API-Key: YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "buyer_id": "org_abc",
    "seller_id": "org_xyz", 
    "commodity": "cashew",
    "quantity": { "amount": 1000, "unit": "MT" },
    "price": { "amount": 1250, "currency": "USD" }
  }'`}
          </pre>
        </div>
      </div>

      {/* Confirm Intent Behaviour */}
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          <strong>Confirm Intent behaviour:</strong> Records interest between parties. Creates tamper-evident evidence with SHA-256 hash. 
          Does not create payment, contract, or legal obligation. Required fields must be present or request is rejected (HTTP 422).
        </AlertDescription>
      </Alert>
    </div>
  );
}
