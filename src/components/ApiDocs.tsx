import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileText, Code, Book, Shield, Zap, Webhook, AlertCircle } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import ApiPlayground from "./ApiPlayground";
import GettingStartedGuide from "./GettingStartedGuide";

export default function ApiDocs() {
  const baseUrl = "https://ugrfyhwlonlmlcmcpcdm.supabase.co/functions/v1";

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Book className="h-5 w-5" />
            <CardTitle>API Documentation</CardTitle>
          </div>
          <CardDescription>
            Complete reference for integrating with the Compliance Matching API
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="getting-started" className="w-full">
            <TabsList className="flex flex-wrap h-auto gap-1 p-1 w-full">
              <TabsTrigger value="getting-started" className="flex-1 min-w-[70px] text-xs sm:text-sm">Tutorial</TabsTrigger>
              <TabsTrigger value="playground" className="flex-1 min-w-[70px] text-xs sm:text-sm">Playground</TabsTrigger>
              <TabsTrigger value="authentication" className="flex-1 min-w-[60px] text-xs sm:text-sm">Auth</TabsTrigger>
              <TabsTrigger value="signals" className="flex-1 min-w-[60px] text-xs sm:text-sm">Signals</TabsTrigger>
              <TabsTrigger value="match" className="flex-1 min-w-[60px] text-xs sm:text-sm">Matches</TabsTrigger>
              <TabsTrigger value="webhooks" className="flex-1 min-w-[70px] text-xs sm:text-sm">Webhooks</TabsTrigger>
              <TabsTrigger value="errors" className="flex-1 min-w-[60px] text-xs sm:text-sm">Errors</TabsTrigger>
            </TabsList>

            {/* Getting Started Tab */}
            <TabsContent value="getting-started" className="mt-6">
              <GettingStartedGuide />
            </TabsContent>

            {/* Playground Tab */}
            <TabsContent value="playground" className="mt-6">
              <ApiPlayground />
            </TabsContent>

            {/* Authentication Tab */}
            <TabsContent value="authentication" className="space-y-6 mt-6">
              <div>
                <h3 className="text-lg font-semibold mb-2 flex items-center gap-2">
                  <Shield className="h-4 w-4" />
                  Authentication
                </h3>
                <p className="text-sm text-muted-foreground mb-4">
                  All API requests require authentication using an API key in the Authorization header.
                </p>
                
                <Alert className="mb-4">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    Keep your API keys secure. Never share them in public repositories or client-side code.
                  </AlertDescription>
                </Alert>

                <div className="space-y-4">
                  <div>
                    <h4 className="font-medium mb-2">Header Format</h4>
                    <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
{`Authorization: Bearer YOUR_API_KEY`}
                    </pre>
                  </div>

                  <div>
                    <h4 className="font-medium mb-2">cURL Example</h4>
                    <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
{`curl -X GET "${baseUrl}/signals" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json"`}
                    </pre>
                  </div>

                  <div>
                    <h4 className="font-medium mb-2">JavaScript Example</h4>
                    <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
{`const response = await fetch('${baseUrl}/signals', {
  method: 'GET',
  headers: {
    'Authorization': 'Bearer YOUR_API_KEY',
    'Content-Type': 'application/json'
  }
});

const data = await response.json();`}
                    </pre>
                  </div>

                  <div>
                    <h4 className="font-medium mb-2">Python Example</h4>
                    <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
{`import requests

headers = {
    'Authorization': 'Bearer YOUR_API_KEY',
    'Content-Type': 'application/json'
}

response = requests.get('${baseUrl}/signals', headers=headers)
data = response.json()`}
                    </pre>
                  </div>
                </div>
              </div>
            </TabsContent>

            {/* Signals Tab */}
            <TabsContent value="signals" className="space-y-6 mt-6">
              <div>
                <h3 className="text-lg font-semibold mb-2 flex items-center gap-2">
                  <Zap className="h-4 w-4" />
                  Signals API
                </h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Create buyer or seller signals to discover matching opportunities.
                </p>

                <Separator className="my-4" />

                {/* POST /signals */}
                <div className="space-y-4 mb-8">
                  <div className="flex items-center gap-2">
                    <Badge variant="default" className="bg-green-600">POST</Badge>
                    <code className="text-sm">/signals</code>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Create a new signal and discover matching options.
                  </p>

                  <div>
                    <h4 className="font-medium mb-2">Request Body</h4>
                    <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
{`{
  "type": "buyer",  // or "seller"
  "content": {
    "what": "Industrial fiber",
    "how_much": 10000,
    "unit": "kg",
    "where": "Rotterdam, Netherlands",
    "when": "2024-Q1",
    "budget": 50000,
    "currency": "USD"
  }
}`}
                    </pre>
                  </div>

                  <div>
                    <h4 className="font-medium mb-2">Response</h4>
                    <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
{`{
  "signal_id": "uuid",
  "status": "active",
  "options": [
    {
      "id": "uuid",
      "what": "Industrial fiber",
      "how_much": 10000,
      "unit": "kg",
      "where_location": "Rotterdam",
      "price": 45000,
      "currency": "USD",
      "score": 95.5,
      "freshness": "recent",
      "quality_flags": {
        "sahpra_verified": true
      }
    }
  ]
}`}
                    </pre>
                  </div>

                  <div>
                    <h4 className="font-medium mb-2">Complete Example</h4>
                    <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
{`const response = await fetch('${baseUrl}/signals', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer YOUR_API_KEY',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    type: 'buyer',
    content: {
      what: 'Industrial fiber',
      how_much: 10000,
      unit: 'kg',
      where: 'Rotterdam, Netherlands',
      when: '2024-Q1',
      budget: 50000,
      currency: 'USD'
    }
  })
});

const data = await response.json();
console.log('Signal created:', data.signal_id);
console.log('Options found:', data.options.length);`}
                    </pre>
                  </div>
                </div>

                <Separator className="my-4" />

                {/* GET /signals/:id */}
                <div className="space-y-4 mb-8">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">GET</Badge>
                    <code className="text-sm">/signals/:id</code>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Retrieve a specific signal by ID.
                  </p>

                  <div>
                    <h4 className="font-medium mb-2">Example</h4>
                    <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
{`const response = await fetch('${baseUrl}/signals/SIGNAL_ID', {
  method: 'GET',
  headers: {
    'Authorization': 'Bearer YOUR_API_KEY'
  }
});

const signal = await response.json();`}
                    </pre>
                  </div>
                </div>

                <Separator className="my-4" />

                {/* POST /signals/:id/select */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <Badge variant="default" className="bg-green-600">POST</Badge>
                    <code className="text-sm">/signals/:id/select</code>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Select an option for a signal.
                  </p>

                  <div>
                    <h4 className="font-medium mb-2">Request Body</h4>
                    <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
{`{
  "option_id": "uuid"
}`}
                    </pre>
                  </div>

                  <div>
                    <h4 className="font-medium mb-2">Example</h4>
                    <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
{`const response = await fetch('${baseUrl}/signals/SIGNAL_ID/select', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer YOUR_API_KEY',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    option_id: 'OPTION_ID'
  })
});`}
                    </pre>
                  </div>
                </div>
              </div>
            </TabsContent>

            {/* Match Tab */}
            <TabsContent value="match" className="space-y-6 mt-6">
              <div>
                <h3 className="text-lg font-semibold mb-2">Match Recording API</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Record trade matches and confirm intent between buyers and sellers.
                </p>

                <Separator className="my-4" />

                {/* POST /match */}
                <div className="space-y-4 mb-8">
                  <div className="flex items-center gap-2">
                    <Badge variant="default" className="bg-green-600">POST</Badge>
                    <code className="text-sm">/match</code>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Record a new trade match between buyer and seller.
                  </p>

                  <div>
                    <h4 className="font-medium mb-2">Request Body</h4>
                    <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
{`{
  "buyer_id": "BUYER_001",
  "buyer_name": "Acme Corp",
  "seller_id": "SELLER_001",
  "seller_name": "Supply Co",
  "commodity": "Industrial fiber",
  "quantity": {
    "amount": 1000,
    "unit": "kg"
  },
  "price": {
    "amount": 50000,
    "currency": "USD"
  },
  "terms": "Delivery within 30 days"
}`}
                    </pre>
                  </div>

                  <div>
                    <h4 className="font-medium mb-2">Response</h4>
                    <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
{`{
  "match_id": "uuid",
  "hash": "unique_match_hash",
  "status": "pending"
}`}
                    </pre>
                  </div>

                  <div>
                    <h4 className="font-medium mb-2">Python Example</h4>
                    <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
{`import requests

match_data = {
    "buyer_id": "BUYER_001",
    "buyer_name": "Acme Corp",
    "seller_id": "SELLER_001",
    "seller_name": "Supply Co",
    "commodity": "Industrial fiber",
    "quantity": {"amount": 1000, "unit": "kg"},
    "price": {"amount": 50000, "currency": "USD"},
    "terms": "Delivery within 30 days"
}

response = requests.post(
    '${baseUrl}/match',
    headers={
        'Authorization': 'Bearer YOUR_API_KEY',
        'Content-Type': 'application/json'
    },
    json=match_data
)

match = response.json()
print(f"Match created: {match['match_id']}")`}
                    </pre>
                  </div>
                </div>

                <Separator className="my-4" />

                {/* GET /match/:id */}
                <div className="space-y-4 mb-8">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">GET</Badge>
                    <code className="text-sm">/match/:id</code>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Retrieve match details by ID.
                  </p>
                </div>

                <Separator className="my-4" />

                {/* POST /match/:id/settle - Confirm Intent */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <Badge variant="default" className="bg-green-600">POST</Badge>
                    <code className="text-sm">/match/:id/settle</code>
                    <Badge variant="outline" className="text-xs">Confirm Intent</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Confirm intent for a match. This signals serious interest to the counterparty.
                  </p>
                  
                  <Alert className="border-amber-200 bg-amber-50 dark:bg-amber-950">
                    <AlertCircle className="h-4 w-4 text-amber-600" />
                    <AlertDescription className="text-amber-800 dark:text-amber-200">
                      <strong>No payment, no contract, no legal obligation.</strong> This action creates an 
                      audit record and evidence chain entry to signal serious interest, allowing the seller 
                      to prepare final terms.
                    </AlertDescription>
                  </Alert>

                  <div className="bg-muted/50 p-4 rounded-lg">
                    <h4 className="font-medium mb-2">Eligibility Requirements</h4>
                    <p className="text-sm text-muted-foreground mb-2">
                      Before Confirm Intent can proceed, the match must pass eligibility validation:
                    </p>
                    <ul className="text-xs text-muted-foreground list-disc list-inside space-y-1">
                      <li>buyer_id, buyer_name - must be non-empty strings</li>
                      <li>seller_id, seller_name - must be non-empty strings</li>
                      <li>commodity - must be a non-empty string</li>
                      <li>quantity_amount - must be a positive number</li>
                      <li>quantity_unit - must be a non-empty string</li>
                      <li>price_amount - must be a positive number</li>
                      <li>price_currency - must be a valid 3-letter currency code</li>
                    </ul>
                    <p className="text-xs text-muted-foreground mt-2">
                      If eligibility fails, you'll receive a 422 response with detailed denial reasons.
                    </p>
                  </div>

                  <div>
                    <h4 className="font-medium mb-2">Example</h4>
                    <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
{`const response = await fetch('${baseUrl}/match/MATCH_ID/settle', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer YOUR_API_KEY',
    'Content-Type': 'application/json'
  }
});

const result = await response.json();
console.log('Intent confirmed at:', result.settled_at);`}
                    </pre>
                  </div>
                </div>
              </div>
            </TabsContent>

            {/* Webhooks Tab */}
            <TabsContent value="webhooks" className="space-y-6 mt-6">
              <div>
                <h3 className="text-lg font-semibold mb-2 flex items-center gap-2">
                  <Webhook className="h-4 w-4" />
                  Webhooks
                </h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Receive real-time notifications when events occur in your account.
                </p>

                <Alert className="mb-4">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    Webhook payloads are signed with HMAC-SHA256. Always verify signatures before processing.
                  </AlertDescription>
                </Alert>

                <Separator className="my-4" />

                {/* Available Events */}
                <div className="space-y-4 mb-8">
                  <h4 className="font-medium">Available Events</h4>
                  <div className="grid grid-cols-2 gap-2">
                    <Badge variant="outline">signal.created</Badge>
                    <Badge variant="outline">option.selected</Badge>
                    <Badge variant="outline">match.created</Badge>
                    <Badge variant="outline">intent.confirmed</Badge>
                    <Badge variant="outline">intent.received</Badge>
                    <Badge variant="outline">token.low_balance</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground space-y-2">
                    <p>
                      <code>intent.confirmed</code> (also sent as <code>match.settled</code> for backward compatibility) 
                      is triggered when a user confirms intent. This is the only event that creates audit/evidence records.
                    </p>
                    <p>
                      <code>token.low_balance</code> is triggered when your organization's token balance crosses 
                      warning thresholds (6,000, 5,500, or 5,001 tokens). Use this to set up automated top-up alerts.
                    </p>
                  </div>
                </div>

                <Separator className="my-4" />

                {/* Create Webhook */}
                <div className="space-y-4 mb-8">
                  <div className="flex items-center gap-2">
                    <Badge variant="default" className="bg-green-600">POST</Badge>
                    <code className="text-sm">/webhooks</code>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Create a new webhook endpoint.
                  </p>

                  <div>
                    <h4 className="font-medium mb-2">Request Body</h4>
                    <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
{`{
  "url": "https://your-domain.com/webhook",
  "events": ["signal.created", "match.created"],
  "secret": "your_webhook_secret"
}`}
                    </pre>
                  </div>
                </div>

                <Separator className="my-4" />

                {/* Payload Format */}
                <div className="space-y-4 mb-8">
                  <h4 className="font-medium">Webhook Payload Format</h4>
                  <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
{`{
  "id": "evt_uuid",
  "type": "signal.created",
  "created": 1640000000,
  "data": {
    "signal_id": "uuid",
    "type": "buyer",
    "status": "active",
    "org_id": "uuid"
  }
}`}
                  </pre>
                </div>

                <Separator className="my-4" />

                {/* Signature Verification */}
                <div className="space-y-4">
                  <h4 className="font-medium">Signature Verification</h4>
                  <p className="text-sm text-muted-foreground mb-2">
                    Verify webhook signatures to ensure requests are from the API.
                  </p>

                  <div>
                    <h5 className="font-medium text-sm mb-2">Node.js Example</h5>
                    <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
{`const crypto = require('crypto');

function verifyWebhookSignature(payload, signature, secret) {
  const hmac = crypto.createHmac('sha256', secret);
  const digest = hmac.update(payload).digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(digest)
  );
}

// In your webhook handler
app.post('/webhook', (req, res) => {
  const signature = req.headers['x-webhook-signature'];
  const payload = JSON.stringify(req.body);
  
  if (!verifyWebhookSignature(payload, signature, YOUR_SECRET)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }
  
  // Process webhook
  console.log('Event type:', req.body.type);
  res.json({ received: true });
});`}
                    </pre>
                  </div>

                  <div>
                    <h5 className="font-medium text-sm mb-2">Python Example</h5>
                    <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
{`import hmac
import hashlib

def verify_webhook_signature(payload: str, signature: str, secret: str) -> bool:
    expected = hmac.new(
        secret.encode(),
        payload.encode(),
        hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(signature, expected)

# In your webhook handler
@app.route('/webhook', methods=['POST'])
def webhook():
    signature = request.headers.get('X-Webhook-Signature')
    payload = request.get_data(as_text=True)
    
    if not verify_webhook_signature(payload, signature, YOUR_SECRET):
        return {'error': 'Invalid signature'}, 401
    
    data = request.json
    print(f"Event type: {data['type']}")
    return {'received': True}`}
                    </pre>
                  </div>
                </div>
              </div>
            </TabsContent>

            {/* Errors Tab */}
            <TabsContent value="errors" className="space-y-6 mt-6">
              <div>
                <h3 className="text-lg font-semibold mb-2 flex items-center gap-2">
                  <AlertCircle className="h-4 w-4" />
                  Error Handling
                </h3>
                <p className="text-sm text-muted-foreground mb-4">
                  The API uses standard HTTP status codes and returns error details in JSON format.
                </p>

                <Separator className="my-4" />

                {/* Status Codes */}
                <div className="space-y-4 mb-8">
                  <h4 className="font-medium">HTTP Status Codes</h4>
                  <div className="space-y-2">
                    <div className="flex items-start gap-3">
                      <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">200</Badge>
                      <div className="flex-1">
                        <p className="font-medium text-sm">OK</p>
                        <p className="text-xs text-muted-foreground">Request succeeded</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200">400</Badge>
                      <div className="flex-1">
                        <p className="font-medium text-sm">Bad Request</p>
                        <p className="text-xs text-muted-foreground">Invalid request parameters</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">401</Badge>
                      <div className="flex-1">
                        <p className="font-medium text-sm">Unauthorized</p>
                        <p className="text-xs text-muted-foreground">Invalid or missing API key</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">403</Badge>
                      <div className="flex-1">
                        <p className="font-medium text-sm">Forbidden</p>
                        <p className="text-xs text-muted-foreground">Insufficient permissions</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">404</Badge>
                      <div className="flex-1">
                        <p className="font-medium text-sm">Not Found</p>
                        <p className="text-xs text-muted-foreground">Resource does not exist</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-200">429</Badge>
                      <div className="flex-1">
                        <p className="font-medium text-sm">Too Many Requests</p>
                        <p className="text-xs text-muted-foreground">Rate limit exceeded</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">500</Badge>
                      <div className="flex-1">
                        <p className="font-medium text-sm">Internal Server Error</p>
                        <p className="text-xs text-muted-foreground">Server encountered an error</p>
                      </div>
                    </div>
                  </div>
                </div>

                <Separator className="my-4" />

                {/* Error Response Format */}
                <div className="space-y-4 mb-8">
                  <h4 className="font-medium">Error Response Format</h4>
                  <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
{`{
  "error": "Invalid request",
  "message": "Missing required field: what",
  "code": "VALIDATION_ERROR"
}`}
                  </pre>
                </div>

                <Separator className="my-4" />

                {/* Rate Limiting */}
                <div className="space-y-4">
                  <h4 className="font-medium">Rate Limiting</h4>
                  <p className="text-sm text-muted-foreground mb-2">
                    API requests are rate-limited per endpoint and API key:
                  </p>
                  <ul className="list-disc list-inside text-sm space-y-1 text-muted-foreground">
                    <li>60 requests per minute</li>
                    <li>1,000 requests per hour</li>
                    <li>10,000 requests per day</li>
                  </ul>
                  <p className="text-sm text-muted-foreground mt-2">
                    When rate limited, the response includes a <code className="text-xs bg-muted px-1 py-0.5 rounded">Retry-After</code> header indicating seconds to wait.
                  </p>

                  <div>
                    <h5 className="font-medium text-sm mb-2">Handling Rate Limits</h5>
                    <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
{`async function makeRequestWithRetry(url, options, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    const response = await fetch(url, options);
    
    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After');
      const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : 60000;
      
      console.log(\`Rate limited. Waiting \${waitTime}ms...\`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      continue;
    }
    
    return response;
  }
  
  throw new Error('Max retries exceeded');
}`}
                    </pre>
                  </div>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
