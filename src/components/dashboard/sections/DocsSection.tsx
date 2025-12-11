import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

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
            <CardTitle className="text-base sm:text-lg">Quick Start</CardTitle>
            <CardDescription className="text-sm leading-relaxed">
              Get started with your first API call in minutes
            </CardDescription>
          </CardHeader>
        </Card>
        <Card className="border-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base sm:text-lg">Authentication</CardTitle>
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
