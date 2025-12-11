import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function DocsSection() {
  return (
    <div className="space-y-8 overflow-hidden">
      <div>
        <h1 className="text-2xl sm:text-4xl font-bold tracking-tight mb-2">Compliance Matching API</h1>
        <p className="text-base sm:text-lg text-muted-foreground">
          Cross-industry REST API for logging, matching, and settling verified trade intent between buyers and sellers, with audit logs and compliance event tracking
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <Card className="border-2">
          <CardHeader>
            <CardTitle className="text-lg">Quick Start</CardTitle>
            <CardDescription>
              Get started with your first API call in minutes
            </CardDescription>
          </CardHeader>
        </Card>
        <Card className="border-2">
          <CardHeader>
            <CardTitle className="text-lg">Authentication</CardTitle>
            <CardDescription>
              Secure your API requests with bearer tokens
            </CardDescription>
          </CardHeader>
        </Card>
        <Card className="border-2">
          <CardHeader>
            <CardTitle className="text-lg">Rate Limits</CardTitle>
            <CardDescription>
              1000 requests per hour per API key
            </CardDescription>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Base URL</CardTitle>
        </CardHeader>
        <CardContent>
          <code className="block p-4 bg-muted rounded-lg text-sm font-mono break-all overflow-x-auto">
            https://ugrfyhwlonlmlcmcpcdm.supabase.co/functions/v1
          </code>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Quick Example</CardTitle>
          <CardDescription>Create a signal in under 30 seconds</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="text-sm font-medium mb-2">cURL</p>
            <pre className="p-4 bg-muted rounded-lg overflow-x-auto">
              <code className="text-sm font-mono">{`curl -X POST https://api.example.com/v1/signals \\
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
