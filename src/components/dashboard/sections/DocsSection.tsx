import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Coins, Shield, Webhook, AlertCircle } from "lucide-react";

export function DocsSection() {
  return (
    <div className="space-y-6 sm:space-y-8">
      <header className="space-y-2">
        <h1 className="font-bold tracking-tight">Compliance Matching API</h1>
        <p className="text-muted-foreground text-sm sm:text-base leading-relaxed max-w-3xl">
          Cross-industry REST API for logging, matching, and settling verified trade intent between buyers and sellers, with audit logs and compliance event tracking
        </p>
      </header>

      <div className="grid gap-4 sm:gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        <Card className="border-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base sm:text-lg flex items-center gap-2">
              <Coins className="h-4 w-4" />
              Token Metering
            </CardTitle>
            <CardDescription className="text-sm leading-relaxed">
              1 token per API call. Minimum balance: 5,000 tokens
            </CardDescription>
          </CardHeader>
        </Card>
        <Card className="border-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base sm:text-lg flex items-center gap-2">
              <Shield className="h-4 w-4" />
              Authentication
            </CardTitle>
            <CardDescription className="text-sm leading-relaxed">
              Secure your API requests with bearer tokens
            </CardDescription>
          </CardHeader>
        </Card>
        <Card className="border-2 sm:col-span-2 lg:col-span-1">
          <CardHeader className="pb-3">
            <CardTitle className="text-base sm:text-lg">Rate Limits</CardTitle>
            <CardDescription className="text-sm leading-relaxed">
              1000 requests per hour per API key
            </CardDescription>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base sm:text-lg">Base URL</CardTitle>
        </CardHeader>
        <CardContent>
          <code className="block p-3 sm:p-4 bg-muted rounded-lg text-xs sm:text-sm font-mono break-all">
            https://ugrfyhwlonlmlcmcpcdm.supabase.co/functions/v1
          </code>
        </CardContent>
      </Card>

      {/* Token Metering Section */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base sm:text-lg flex items-center gap-2">
            <Coins className="h-4 w-4" />
            Token Metering
          </CardTitle>
          <CardDescription className="text-sm">Usage-based billing for API calls</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="p-3 bg-muted rounded-lg">
              <p className="text-xs text-muted-foreground mb-1">Cost per call</p>
              <p className="text-lg font-semibold">1 token</p>
            </div>
            <div className="p-3 bg-muted rounded-lg">
              <p className="text-xs text-muted-foreground mb-1">Minimum balance</p>
              <p className="text-lg font-semibold">5,000 tokens</p>
            </div>
          </div>
          
          <div>
            <p className="text-sm font-medium mb-2">Billable Endpoints</p>
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">/signals</Badge>
              <Badge variant="secondary">/search</Badge>
              <Badge variant="secondary">/match</Badge>
              <Badge variant="secondary">/sr-discover</Badge>
            </div>
          </div>

          <Alert>
            <Webhook className="h-4 w-4" />
            <AlertDescription className="text-sm">
              <strong>Low Balance Webhooks:</strong> Get notified when your balance reaches 6,000, 5,500, or 5,001 tokens via the <code className="text-xs">token.low_balance</code> webhook event.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      {/* Confirm Intent Eligibility Section */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base sm:text-lg flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Confirm Intent Eligibility
          </CardTitle>
          <CardDescription className="text-sm">Required fields for Confirm Intent to succeed</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert className="border-amber-200 bg-amber-50 dark:bg-amber-950">
            <AlertCircle className="h-4 w-4 text-amber-600" />
            <AlertDescription className="text-amber-800 dark:text-amber-200 text-sm">
              Confirm Intent will be blocked if required fields are missing or ambiguous, returning HTTP 422 with detailed denial reasons.
            </AlertDescription>
          </Alert>

          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="p-2 bg-muted rounded">buyer_id</div>
            <div className="p-2 bg-muted rounded">buyer_name</div>
            <div className="p-2 bg-muted rounded">seller_id</div>
            <div className="p-2 bg-muted rounded">seller_name</div>
            <div className="p-2 bg-muted rounded">commodity</div>
            <div className="p-2 bg-muted rounded">quantity_amount</div>
            <div className="p-2 bg-muted rounded">quantity_unit</div>
            <div className="p-2 bg-muted rounded">price_amount</div>
            <div className="p-2 bg-muted rounded col-span-2">price_currency (3-letter code)</div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base sm:text-lg">Quick Example</CardTitle>
          <CardDescription className="text-sm">Create a signal in under 30 seconds</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="text-sm font-medium mb-2">cURL</p>
            <pre className="p-3 sm:p-4 bg-muted rounded-lg overflow-x-auto text-xs sm:text-sm">
              <code className="font-mono whitespace-pre">{`curl -X POST https://api.example.com/v1/signals \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "type": "buyer",
    "what": "Industrial Equipment Parts",
    "how_much": 10000,
    "unit": "units"
  }'`}</code>
            </pre>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
