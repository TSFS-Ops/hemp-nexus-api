import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Copy, Download, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { CodeBlock } from "@/components/ui/code-block";

const typescriptExample = `import { IzenzoClient } from '@/lib/izenzo-sdk';

// Initialize the client
const client = new IzenzoClient('sk_your_api_key');

// Create a match
const match = await client.matches.create({
  buyer: { id: 'B001', name: 'Acme Corp' },
  seller: { id: 'S001', name: 'Supplier Inc' },
  commodity: 'Steel Coils',
  quantity: { amount: 100, unit: 'tonnes' },
  price: { amount: 50000, currency: 'USD' },
  terms: 'FOB Shanghai, 30 days credit'
});

console.log('Match created:', match.id);
console.log('Proof hash:', match.hash);

// Confirm intent (non-binding)
const confirmed = await client.matches.confirmIntent(match.id);
console.log('Intent confirmed at:', confirmed.settled_at);`;

const pythonExample = `import requests

class IzenzoClient:
    def __init__(self, api_key: str, base_url: str = None):
        self.api_key = api_key
        self.base_url = base_url or "https://ugrfyhwlonlmlcmcpcdm.supabase.co/functions/v1"
    
    def _headers(self):
        return {
            "X-API-Key": self.api_key,
            "Content-Type": "application/json"
        }
    
    def create_match(self, data: dict) -> dict:
        response = requests.post(
            f"{self.base_url}/match",
            json=data,
            headers=self._headers()
        )
        response.raise_for_status()
        return response.json()
    
    def get_match(self, match_id: str) -> dict:
        response = requests.get(
            f"{self.base_url}/match/{match_id}",
            headers=self._headers()
        )
        response.raise_for_status()
        return response.json()
    
    def confirm_intent(self, match_id: str) -> dict:
        response = requests.post(
            f"{self.base_url}/match/{match_id}/settle",
            headers=self._headers()
        )
        response.raise_for_status()
        return response.json()

# Usage
client = IzenzoClient("sk_your_api_key")

match = client.create_match({
    "buyer": {"id": "B001", "name": "Acme Corp"},
    "seller": {"id": "S001", "name": "Supplier Inc"},
    "commodity": "Steel Coils",
    "quantity": {"amount": 100, "unit": "tonnes"},
    "price": {"amount": 50000, "currency": "USD"}
})

print(f"Match created: {match['id']}")`;

const curlExample = `# Create a match
curl -X POST https://ugrfyhwlonlmlcmcpcdm.supabase.co/functions/v1/match \\
  -H "X-API-Key: sk_your_api_key" \\
  -H "Content-Type: application/json" \\
  -d '{
    "buyer": {"id": "B001", "name": "Acme Corp"},
    "seller": {"id": "S001", "name": "Supplier Inc"},
    "commodity": "Steel Coils",
    "quantity": {"amount": 100, "unit": "tonnes"},
    "price": {"amount": 50000, "currency": "USD"}
  }'

# Get a match
curl https://ugrfyhwlonlmlcmcpcdm.supabase.co/functions/v1/match/{match_id} \\
  -H "X-API-Key: sk_your_api_key"

# Confirm intent (non-binding)
curl -X POST https://ugrfyhwlonlmlcmcpcdm.supabase.co/functions/v1/match/{match_id}/settle \\
  -H "X-API-Key: sk_your_api_key"

# List matches
curl "https://ugrfyhwlonlmlcmcpcdm.supabase.co/functions/v1/matches?limit=10&status=matched" \\
  -H "X-API-Key: sk_your_api_key"`;


const v3DealPipelineExample = `import { IzenzoClient } from '@/lib/izenzo-sdk';

const client = new IzenzoClient('sk_your_api_key');

// ── Step 1: Register an entity ──
const entity = await client.entities.create({
  legal_name: 'Acme Trading (Pty) Ltd',
  entity_type: 'COMPANY',
  jurisdiction_code: 'ZA',
  registration_number: '2024/123456/07',
});
console.log('Entity:', entity.id);

// ── Step 2: Register UBO and ATB ──
await client.authority.createUbo(directorEntityId, entity.id, 51);
await client.authority.createAtb(directorEntityId, entity.id, 'resolution');

// ── Step 3: Check ATB/UBO gates ──
const gates = await client.authority.checkGates(directorEntityId, entity.id);
console.log('UBO passed:', gates.ubo_passed); // true when ≥ 100%
console.log('ATB passed:', gates.atb_passed); // true when verified

// ── Step 4: Get trade approval status ──
const tradeStatus = await client.tradeApprovals.getStatus(orgId);
console.log('Approved to trade:', tradeStatus.approved_to_trade);

// ── Step 5: Create a PoD with milestones ──
const pod = await client.pods.create(
  {
    wad_id: wadId,
    milestones: [
      { name: 'Goods shipped', due_at: '2026-04-01T00:00:00Z' },
      { name: 'Customs cleared', due_at: '2026-04-15T00:00:00Z' },
      { name: 'Delivery confirmed', due_at: '2026-04-30T00:00:00Z' },
    ],
  },
  crypto.randomUUID() // Idempotency key
);
console.log('PoD:', pod.id, pod.state);

// ── Step 6: Complete milestones ──
await client.pods.completeMilestone(milestoneId);
await client.pods.finalise(pod.id);`;


const errorHandlingExample = `import { IzenzoClient, IzenzoApiError } from '@/lib/izenzo-sdk';

const client = new IzenzoClient('sk_your_api_key');

try {
  const match = await client.matches.create({
    buyer: { id: 'B001', name: 'Acme Corp' },
    seller: { id: 'S001', name: 'Supplier Inc' },
    commodity: 'Steel Coils',
    quantity: { amount: 100, unit: 'tonnes' },
    price: { amount: 50000, currency: 'USD' }
  });
} catch (error) {
  if (error instanceof IzenzoApiError) {
    console.error('API Error:', error.code);
    console.error('Message:', error.message);
    console.error('Request ID:', error.requestId);
    
    switch (error.code) {
      case 'VALIDATION_ERROR':
        // Handle validation errors
        break;
      case 'RATE_LIMIT_EXCEEDED':
        // Wait and retry
        break;
      case 'UNAUTHORIZED':
        // Invalid API key
        break;
    }
  }
}`;

const webhookExample = `// Setting up webhooks
const webhook = await client.webhooks.create({
  url: 'https://your-app.com/webhooks/izenzo',
  events: ['match.created', 'match.settled']
});

// Webhook payload example
{
  "event": "match.created",
  "timestamp": "2025-12-03T10:30:00Z",
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "status": "matched",
    "buyer_name": "Acme Corp",
    "seller_name": "Supplier Inc",
    "commodity": "Steel Coils",
    "hash": "a3b2c1d4..."
  },
  "signature": "sha256=..."
}

// Verify webhook signature (Node.js)
const crypto = require('crypto');

function verifyWebhookSignature(payload, signature, secret) {
  const hmac = crypto.createHmac('sha256', secret);
  const digest = 'sha256=' + hmac.update(payload).digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(digest)
  );
}`;

export function SdkDocumentation() {
  const copyToClipboard = (code: string) => {
    navigator.clipboard.writeText(code);
    toast.success('Copied to clipboard');
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">SDK & Integration</h2>
          <p className="text-muted-foreground">
            Libraries, examples, and integration guides
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" asChild>
            <a href="/openapi.yaml" download>
              <Download className="h-4 w-4 mr-2" />
              OpenAPI Spec
            </a>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <a 
              href="https://editor.swagger.io/?url=https://ugrfyhwlonlmlcmcpcdm.supabase.co/storage/v1/object/public/docs/openapi.yaml" 
              target="_blank" 
              rel="noopener noreferrer"
            >
              <ExternalLink className="h-4 w-4 mr-2" />
              Swagger UI
            </a>
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">TypeScript SDK</CardTitle>
            <CardDescription>Full-featured client with types</CardDescription>
          </CardHeader>
          <CardContent>
            <Badge variant="secondary">Built-in</Badge>
            <p className="text-sm text-muted-foreground mt-2">
              Import from <code className="text-xs bg-muted px-1 rounded">@/lib/izenzo-sdk</code>
            </p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">OpenAPI 3.1</CardTitle>
            <CardDescription>Machine-readable API spec</CardDescription>
          </CardHeader>
          <CardContent>
            <Badge variant="outline">YAML</Badge>
            <p className="text-sm text-muted-foreground mt-2">
              Generate clients for any language
            </p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Rate Limits</CardTitle>
            <CardDescription>Current limits per key</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Per minute:</span>
                <span>60 requests</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Per hour:</span>
                <span>1,000 requests</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Per day:</span>
                <span>10,000 requests</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Quick Start Examples</CardTitle>
          <CardDescription>
            Code examples in multiple languages
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="typescript" className="w-full">
            <TabsList className="grid w-full grid-cols-5">
              <TabsTrigger value="typescript">TypeScript</TabsTrigger>
              <TabsTrigger value="v3-pipeline">V3 Pipeline</TabsTrigger>
              <TabsTrigger value="python">Python</TabsTrigger>
              <TabsTrigger value="curl">cURL</TabsTrigger>
              <TabsTrigger value="errors">Error Handling</TabsTrigger>
            </TabsList>
            
            <TabsContent value="typescript" className="relative">
              <CodeBlock code={typescriptExample} language="typescript" />
            </TabsContent>

            <TabsContent value="v3-pipeline" className="relative">
              <CodeBlock code={v3DealPipelineExample} language="typescript" />
            </TabsContent>
            
            <TabsContent value="python" className="relative">
              <CodeBlock code={pythonExample} language="python" />
            </TabsContent>
            
            <TabsContent value="curl" className="relative">
              <CodeBlock code={curlExample} language="bash" />
            </TabsContent>
            
            <TabsContent value="errors" className="relative">
              <CodeBlock code={errorHandlingExample} language="typescript" />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Webhooks Integration</CardTitle>
          <CardDescription>
            Receive real-time notifications for events
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 md:grid-cols-2">
            <div>
              <h4 className="font-medium mb-2">Available Events</h4>
              <ul className="space-y-1 text-sm">
                <li><code className="bg-muted px-1 rounded">match.created</code> - New match recorded</li>
                <li><code className="bg-muted px-1 rounded">match.settled</code> - Intent confirmed</li>
                <li><code className="bg-muted px-1 rounded">signal.created</code> - New signal created</li>
                <li><code className="bg-muted px-1 rounded">signal.matched</code> - Options found</li>
                <li><code className="bg-muted px-1 rounded">option.selected</code> - Option selected</li>
              </ul>
              <h4 className="font-medium mt-4 mb-2">V3 Events</h4>
              <ul className="space-y-1 text-sm">
                <li><code className="bg-muted px-1 rounded">entity.created</code> - Entity registered</li>
                <li><code className="bg-muted px-1 rounded">entity.screened</code> - Screening completed</li>
                <li><code className="bg-muted px-1 rounded">poi.collapsed</code> - POI reached COLLAPSED</li>
                <li><code className="bg-muted px-1 rounded">wad.issued</code> - WaD bundle sealed</li>
                <li><code className="bg-muted px-1 rounded">wad.denied</code> - WaD hard-gate failure</li>
                <li><code className="bg-muted px-1 rounded">pod.finalised</code> - Delivery confirmed</li>
                <li><code className="bg-muted px-1 rounded">breach.detected</code> - PoD breach recorded</li>
                <li><code className="bg-muted px-1 rounded">compliance.case.opened</code> - Case opened</li>
              </ul>
            </div>
            <div>
              <h4 className="font-medium mb-2">Security</h4>
              <ul className="space-y-1 text-sm text-muted-foreground">
                <li>• All payloads are signed with HMAC-SHA256</li>
                <li>• Verify signatures before processing</li>
                <li>• Respond with 2xx within 30 seconds</li>
                <li>• Failed deliveries retry with exponential backoff</li>
              </ul>
            </div>
          </div>
          
          <div className="relative">
            <Button
              variant="ghost"
              size="sm"
              className="absolute top-2 right-2 z-10"
              onClick={() => copyToClipboard(webhookExample)}
            >
              <Copy className="h-4 w-4" />
            </Button>
            <SyntaxHighlighter
              language="typescript"
              style={atomOneDark}
              customStyle={{ borderRadius: '0.5rem', padding: '1rem' }}
            >
              {webhookExample}
            </SyntaxHighlighter>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>API Response Codes</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <h4 className="font-medium mb-2 text-primary">Success Codes</h4>
              <ul className="space-y-1 text-sm">
                <li><code className="bg-muted px-1 rounded">200</code> - OK</li>
                <li><code className="bg-muted px-1 rounded">201</code> - Created</li>
                <li><code className="bg-muted px-1 rounded">204</code> - No Content</li>
              </ul>
            </div>
            <div>
              <h4 className="font-medium mb-2 text-destructive">Error Codes</h4>
              <ul className="space-y-1 text-sm">
                <li><code className="bg-muted px-1 rounded">400</code> - Validation Error</li>
                <li><code className="bg-muted px-1 rounded">401</code> - Unauthorized</li>
                <li><code className="bg-muted px-1 rounded">403</code> - Forbidden</li>
                <li><code className="bg-muted px-1 rounded">404</code> - Not Found</li>
                <li><code className="bg-muted px-1 rounded">429</code> - Rate Limited</li>
                <li><code className="bg-muted px-1 rounded">500</code> - Internal Error</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
