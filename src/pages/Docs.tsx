import { useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { 
  Book, Code, Shield, Zap, Webhook, AlertCircle, Copy, Check, 
  ArrowRight, ExternalLink, FileText, CheckCircle
} from "lucide-react";
import { toast } from "sonner";
import { PublicPageLayout } from "@/components/PublicPageLayout";
import { useCrossDomainUrls } from "@/components/HostnameRouter";

const API_BASE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

function CodeBlock({ code, language = "bash" }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false);

  const copyToClipboard = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    toast.success("Copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative group">
      <pre className="bg-muted/50 border border-border/50 p-4 rounded-lg overflow-x-auto text-sm font-mono">
        <code>{code}</code>
      </pre>
      <Button
        variant="ghost"
        size="icon"
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity h-8 w-8"
        onClick={copyToClipboard}
      >
        {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
      </Button>
    </div>
  );
}

export default function Docs() {
  const { getAuthUrl, isPreview } = useCrossDomainUrls();
  
  // Helper for cross-domain auth links
  const AuthLink = ({ children, className, asChild }: { children: React.ReactNode; className?: string; asChild?: boolean }) => {
    const authUrl = getAuthUrl();
    if (isPreview) {
      return <Link to="/auth" className={className}>{children}</Link>;
    }
    return <a href={authUrl} className={className}>{children}</a>;
  };

  return (
    <PublicPageLayout>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* Hero Section */}
        <div className="mb-8 sm:mb-12 text-center">
          <Badge variant="outline" className="mb-4">Trade Request API</Badge>
          <h1 className="text-2xl sm:text-4xl font-bold mb-4">
            B2B Trade Matching with Tamper-Evident Records
          </h1>
          <p className="text-sm sm:text-lg text-muted-foreground max-w-2xl mx-auto mb-6">
            An information-only API for regulated B2B matching. Search for trading partners, 
            express interest, and create tamper-proofally-signed evidence records.
          </p>
          <Alert className="max-w-xl mx-auto border-amber-200 bg-amber-50 dark:bg-amber-950/50">
            <CheckCircle className="h-4 w-4 text-amber-600 shrink-0" />
            <AlertDescription className="text-amber-800 dark:text-amber-200 text-sm text-left">
              <strong>No payments. No contracts. No legal obligation.</strong> This API only records 
              trade request at a specific date/time.
            </AlertDescription>
          </Alert>
        </div>

        {/* Quick Start */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5" />
              Quick Start
            </CardTitle>
            <CardDescription>
              Initiate the Trade Request flow in three steps.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Step 1 */}
            <div className="flex gap-4">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold">
                1
              </div>
              <div className="flex-1">
                <h4 className="font-semibold mb-2">Create a Match</h4>
                <p className="text-sm text-muted-foreground mb-3">
                  Record a potential trade match between buyer and seller.
                </p>
                <CodeBlock language="bash" code={`curl -X POST "${API_BASE_URL}/match" \\
  -H "X-API-Key: $IZENZO_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "buyer": { "id": "buyer-123", "name": "Acme Corp" },
    "seller": { "id": "seller-456", "name": "Supply Co" },
    "commodity": "Copper cathode",
    "quantity": { "amount": 100, "unit": "tons" },
    "price": { "amount": 850000, "currency": "USD" },
    "terms": "CIF Rotterdam, 30 days"
  }'`} />
              </div>
            </div>

            <Separator />

            {/* Step 2 */}
            <div className="flex gap-4">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold">
                2
              </div>
              <div className="flex-1">
                <h4 className="font-semibold mb-2">Send Trade Request</h4>
                <p className="text-sm text-muted-foreground mb-3">
                  When ready, confirm interest to create an immutable evidence record.
                </p>
                <CodeBlock language="bash" code={`curl -X POST "${API_BASE_URL}/match/{match_id}/settle" \\
  -H "X-API-Key: $IZENZO_KEY" \\
  -H "Content-Type: application/json"`} />
                <Alert className="mt-3 border-primary/20 bg-primary/5">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription className="text-sm">
                    This triggers <code className="bg-muted px-1 rounded">intent.confirmed</code> webhook 
                    and creates an audit log with tamper-proof hash.
                  </AlertDescription>
                </Alert>
              </div>
            </div>

            <Separator />

            {/* Step 3 */}
            <div className="flex gap-4">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold">
                3
              </div>
              <div className="flex-1">
                <h4 className="font-semibold mb-2">Get Evidence Pack</h4>
                <p className="text-sm text-muted-foreground mb-3">
                  Retrieve the complete audit trail and hash chain for compliance.
                </p>
                <CodeBlock language="bash" code={`curl -X GET "${API_BASE_URL}/evidence-pack/{match_id}" \\
  -H "X-API-Key: $IZENZO_KEY"`} />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Main Documentation */}
        <Tabs defaultValue="auth" className="space-y-6">
          <TabsList className="flex flex-wrap h-auto gap-1 p-1 w-full">
            <TabsTrigger value="auth" className="flex-1 min-w-[60px] text-xs sm:text-sm">Auth</TabsTrigger>
            <TabsTrigger value="match" className="flex-1 min-w-[60px] text-xs sm:text-sm">Match</TabsTrigger>
            <TabsTrigger value="confirm" className="flex-1 min-w-[60px] text-xs sm:text-sm">Confirm</TabsTrigger>
            <TabsTrigger value="webhooks" className="flex-1 min-w-[70px] text-xs sm:text-sm">Webhooks</TabsTrigger>
            <TabsTrigger value="evidence" className="flex-1 min-w-[70px] text-xs sm:text-sm">Evidence</TabsTrigger>
          </TabsList>

          {/* Authentication Tab */}
          <TabsContent value="auth">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Shield className="h-5 w-5" />
                  Authentication
                </CardTitle>
                <CardDescription>
                  All API requests authenticate via the X-API-Key header
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div>
                  <h4 className="font-semibold mb-2">Header Format</h4>
                  <CodeBlock code={`X-API-Key: sk_live_...`} />
                </div>

                <div>
                  <h4 className="font-semibold mb-2">Python Example</h4>
                  <CodeBlock language="python" code={`import requests

API_KEY = "your_api_key_here"
BASE_URL = "${API_BASE_URL}"

headers = {
    "X-API-Key": API_KEY,
    "Content-Type": "application/json"
}

# List your matches
response = requests.get(f"{BASE_URL}/match", headers=headers)
matches = response.json()
print(f"Found {len(matches.get('items', []))} matches")`} />
                </div>

                <div>
                  <h4 className="font-semibold mb-2">Node.js Example</h4>
                  <CodeBlock language="javascript" code={`const API_KEY = 'your_api_key_here';
const BASE_URL = '${API_BASE_URL}';

async function listMatches() {
  const response = await fetch(\`\${BASE_URL}/match\`, {
    headers: {
      'X-API-Key': API_KEY,
      'Content-Type': 'application/json'
    }
  });
  
  const data = await response.json();
  console.log('Matches:', data.items);
  return data;
}`} />
                </div>

                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    <strong>API Key Security:</strong> Never expose your API key in client-side code or public repositories.
                    Get your API key from the <Link to="/dashboard" className="underline">Dashboard</Link>.
                  </AlertDescription>
                </Alert>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Match API Tab */}
          <TabsContent value="match">
            <Card>
              <CardHeader>
                <CardTitle>Match API</CardTitle>
                <CardDescription>
                  Create and manage trade matches between buyers and sellers
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-8">
                {/* POST /match */}
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <Badge className="bg-green-600">POST</Badge>
                    <code className="font-mono text-sm">/match</code>
                  </div>
                  <p className="text-sm text-muted-foreground mb-4">
                    Create a new match record. Returns a unique match ID and tamper-proof hash.
                  </p>
                  
                  <h5 className="font-medium mb-2 text-sm">Request Body</h5>
                  <CodeBlock code={`{
  "buyer": {
    "id": "string",      // Unique buyer identifier
    "name": "string"     // Display name
  },
  "seller": {
    "id": "string",      // Unique seller identifier  
    "name": "string"     // Display name
  },
  "commodity": "string",   // Product/commodity name
  "quantity": {
    "amount": number,      // Quantity value
    "unit": "string"       // Unit (kg, tons, units, etc.)
  },
  "price": {
    "amount": number,      // Price value
    "currency": "string"   // ISO currency code (USD, EUR, etc.)
  },
  "terms": "string",       // Optional: delivery/payment terms
  "metadata": {}           // Optional: additional data
}`} />

                  <h5 className="font-medium mb-2 mt-4 text-sm">Response (201 Created)</h5>
                  <CodeBlock code={`{
  "id": "uuid",
  "hash": "sha256_hash_of_match_data",
  "status": "matched",
  "buyer_id": "string",
  "buyer_name": "string",
  "seller_id": "string",
  "seller_name": "string",
  "commodity": "string",
  "quantity_amount": number,
  "quantity_unit": "string",
  "price_amount": number,
  "price_currency": "string",
  "terms": "string",
  "created_at": "ISO8601 timestamp"
}`} />
                </div>

                <Separator />

                {/* GET /match */}
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <Badge variant="outline">GET</Badge>
                    <code className="font-mono text-sm">/match</code>
                  </div>
                  <p className="text-sm text-muted-foreground mb-4">
                    List all matches for your organisation.
                  </p>
                  
                  <h5 className="font-medium mb-2 text-sm">Query Parameters</h5>
                  <div className="space-y-2 text-sm mb-4">
                    <div className="flex gap-2">
                      <code className="bg-muted px-2 py-1 rounded">limit</code>
                      <span className="text-muted-foreground">Number of results (default: 50)</span>
                    </div>
                    <div className="flex gap-2">
                      <code className="bg-muted px-2 py-1 rounded">offset</code>
                      <span className="text-muted-foreground">Pagination offset</span>
                    </div>
                    <div className="flex gap-2">
                      <code className="bg-muted px-2 py-1 rounded">status</code>
                      <span className="text-muted-foreground">"matched" or "settled"</span>
                    </div>
                    <div className="flex gap-2">
                      <code className="bg-muted px-2 py-1 rounded">commodity</code>
                      <span className="text-muted-foreground">Filter by commodity name</span>
                    </div>
                  </div>
                </div>

                <Separator />

                {/* GET /match/:id */}
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <Badge variant="outline">GET</Badge>
                    <code className="font-mono text-sm">/match/:id</code>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Retrieve a specific match by ID.
                  </p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Trade Request Tab */}
          <TabsContent value="confirm">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CheckCircle className="h-5 w-5" />
                  Send Trade Request
                </CardTitle>
                <CardDescription>
                  Signal serious interest and create tamper-evident audit records
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <Alert className="border-amber-200 bg-amber-50 dark:bg-amber-950/50">
                  <AlertCircle className="h-4 w-4 text-amber-600" />
                  <AlertDescription className="text-amber-800 dark:text-amber-200">
                    <strong>Important:</strong> Confirming intent does NOT create any legal obligation, 
                    payment commitment, or binding contract. It only records that at a specific date/time, 
                    a user expressed interest in a potential trade.
                  </AlertDescription>
                </Alert>

                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <Badge className="bg-green-600">POST</Badge>
                    <code className="font-mono text-sm">/match/:id/settle</code>
                  </div>
                  <p className="text-sm text-muted-foreground mb-4">
                    Send a trade request for a match. This is idempotent - calling it multiple times 
                    returns the same result.
                  </p>
                </div>

                <div>
                  <h4 className="font-semibold mb-2">cURL Example</h4>
                  <CodeBlock code={`curl -X POST "${API_BASE_URL}/match/YOUR_MATCH_ID/settle" \\
  -H "X-API-Key: $IZENZO_KEY" \\
  -H "Content-Type: application/json"`} />
                </div>

                <div>
                  <h4 className="font-semibold mb-2">Python Example</h4>
                  <CodeBlock language="python" code={`import requests

def send_trade_request(match_id: str, api_key: str):
    """
    Send a trade request for a match.
    
    This creates an immutable audit record proving that at this
    moment in time, serious interest was expressed.
    
    No payment, contract, or legal obligation is created.
    """
    response = requests.post(
        f"${API_BASE_URL}/match/{match_id}/settle",
        headers={
            "X-API-Key": api_key,
            "Content-Type": "application/json"
        }
    )
    
    if response.status_code == 200:
        result = response.json()
        print(f"Intent confirmed at: {result['settled_at']}")
        print(f"Evidence hash: {result['hash']}")
        return result
    else:
        raise Exception(f"Error: {response.status_code} - {response.text}")

# Usage
match = send_trade_request("your-match-id", "your-api-key")`} />
                </div>

                <div>
                  <h4 className="font-semibold mb-2">Node.js Example</h4>
                  <CodeBlock language="javascript" code={`async function sendTradeRequest(matchId, apiKey) {
  /**
   * Send a trade request for a match.
   * 
   * Creates an immutable audit record proving interest
   * was expressed at this specific date/time.
   * 
   * No payment, contract, or legal obligation.
   */
  const response = await fetch(
    \`${API_BASE_URL}/match/\${matchId}/settle\`,
    {
      method: 'POST',
      headers: {
        'X-API-Key': apiKey,
        'Content-Type': 'application/json'
      }
    }
  );
  
  if (!response.ok) {
    throw new Error(\`HTTP \${response.status}: \${await response.text()}\`);
  }
  
  const result = await response.json();
  console.log('Intent confirmed at:', result.settled_at);
  console.log('Evidence hash:', result.hash);
  return result;
}

// Usage
sendTradeRequest('your-match-id', 'your-api-key')
  .then(match => console.log('Confirmed:', match.id))
  .catch(err => console.error(err));`} />
                </div>

                <div>
                  <h4 className="font-semibold mb-2">Response</h4>
                  <CodeBlock code={`{
  "id": "match-uuid",
  "status": "settled",
  "settled_at": "2024-12-06T12:00:00.000Z",
  "hash": "sha256_tamper-proof_hash",
  "buyer_id": "buyer-123",
  "buyer_name": "Acme Corp",
  "seller_id": "seller-456", 
  "seller_name": "Supply Co",
  "commodity": "Copper cathode",
  "quantity_amount": 100,
  "quantity_unit": "tons",
  "price_amount": 850000,
  "price_currency": "USD"
}`} />
                </div>

                <div className="bg-muted/50 p-4 rounded-lg border">
                  <h4 className="font-semibold mb-2">What Happens When You Send a Trade Request</h4>
                  <ul className="text-sm text-muted-foreground space-y-2">
                    <li className="flex items-start gap-2">
                      <ArrowRight className="h-4 w-4 mt-0.5 text-primary" />
                      <span>Match status changes from "matched" to "settled"</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <ArrowRight className="h-4 w-4 mt-0.5 text-primary" />
                      <span>An immutable audit log entry is created with tamper-proof hash</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <ArrowRight className="h-4 w-4 mt-0.5 text-primary" />
                      <span>A hash-chained event is recorded in the evidence timeline</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <ArrowRight className="h-4 w-4 mt-0.5 text-primary" />
                      <span>Webhook notifications are sent to registered endpoints</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <ArrowRight className="h-4 w-4 mt-0.5 text-primary" />
                      <span>Trading partner receives real-time notification of your interest</span>
                    </li>
                  </ul>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Webhooks Tab */}
          <TabsContent value="webhooks">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Webhook className="h-5 w-5" />
                  Webhooks
                </CardTitle>
                <CardDescription>
                  Receive real-time notifications when events occur
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div>
                  <h4 className="font-semibold mb-3">Available Events</h4>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="border rounded-lg p-3">
                      <Badge variant="outline" className="mb-2">match.created</Badge>
                      <p className="text-xs text-muted-foreground">New match recorded</p>
                    </div>
                    <div className="border rounded-lg p-3">
                      <Badge variant="outline" className="mb-2">intent.confirmed</Badge>
                      <p className="text-xs text-muted-foreground">Interest confirmed (triggers audit)</p>
                    </div>
                    <div className="border rounded-lg p-3">
                      <Badge variant="outline" className="mb-2">signal.created</Badge>
                      <p className="text-xs text-muted-foreground">New buyer/seller signal</p>
                    </div>
                    <div className="border rounded-lg p-3">
                      <Badge variant="outline" className="mb-2">option.selected</Badge>
                      <p className="text-xs text-muted-foreground">Option chosen from results</p>
                    </div>
                  </div>
                </div>

                <Separator />

                <div>
                  <h4 className="font-semibold mb-2">Create Webhook Endpoint</h4>
                  <div className="flex items-center gap-2 mb-3">
                    <Badge className="bg-green-600">POST</Badge>
                    <code className="font-mono text-sm">/webhooks</code>
                  </div>
                  <CodeBlock code={`curl -X POST "${API_BASE_URL}/webhooks" \\
  -H "X-API-Key: $IZENZO_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "url": "https://your-server.com/webhook",
    "events": ["match.created", "intent.confirmed"],
    "secret": "your_webhook_signing_secret"
  }'`} />
                </div>

                <Separator />

                <div>
                  <h4 className="font-semibold mb-2">Webhook Payload (intent.confirmed)</h4>
                  <CodeBlock code={`{
  "event": "intent.confirmed",
  "timestamp": "2024-12-06T12:00:00.000Z",
  "orgId": "your-org-id",
  "data": {
    "matchId": "match-uuid",
    "hash": "sha256_evidence_hash",
    "confirmedAt": "2024-12-06T12:00:00.000Z",
    "commodity": "Copper cathode",
    "quantity": 100,
    "note": "Intent confirmation signals interest only - no payment or legal obligation"
  }
}`} />
                </div>

                <Separator />

                <div>
                  <h4 className="font-semibold mb-2">Verify Webhook Signature</h4>
                  <p className="text-sm text-muted-foreground mb-3">
                    All webhooks include an <code className="bg-muted px-1 rounded">X-Webhook-Signature</code> header. 
                    Verify it using HMAC-SHA256.
                  </p>
                  <CodeBlock language="javascript" code={`const crypto = require('crypto');

function verifyWebhookSignature(payload, signature, secret) {
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
  
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

// In your webhook handler
app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const signature = req.headers['x-webhook-signature'];
  const payload = req.body.toString();
  
  if (!verifyWebhookSignature(payload, signature, process.env.WEBHOOK_SECRET)) {
    return res.status(401).send('Invalid signature');
  }
  
  const event = JSON.parse(payload);
  
  if (event.event === 'intent.confirmed') {
    console.log('Intent confirmed for match:', event.data.matchId);
    // Notify your trading partner, update your CRM, etc.
  }
  
  res.status(200).send('OK');
});`} />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Evidence Tab */}
          <TabsContent value="evidence">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  Evidence Pack
                </CardTitle>
                <CardDescription>
                  Retrieve tamper-proofally-signed audit trails for compliance
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <Badge variant="outline">GET</Badge>
                    <code className="font-mono text-sm">/evidence-pack/:matchId</code>
                  </div>
                  <p className="text-sm text-muted-foreground mb-4">
                    Retrieve a complete evidence pack for a confirmed match, including the full 
                    event timeline and hash chain verification.
                  </p>
                </div>

                <CodeBlock code={`curl -X GET "${API_BASE_URL}/evidence-pack/YOUR_MATCH_ID" \\
  -H "X-API-Key: $IZENZO_KEY"`} />

                <div>
                  <h4 className="font-semibold mb-2">Response Structure</h4>
                  <CodeBlock code={`{
  "metadata": {
    "generated_at": "2024-12-06T12:00:00.000Z",
    "match_id": "match-uuid",
    "org_id": "org-uuid"
  },
  "match": {
    "id": "match-uuid",
    "hash": "original_match_hash",
    "status": "settled",
    "settled_at": "2024-12-06T12:00:00.000Z",
    "buyer": { "id": "buyer-123", "name": "Acme Corp" },
    "seller": { "id": "seller-456", "name": "Supply Co" },
    "commodity": "Copper cathode",
    "quantity": { "amount": 100, "unit": "tons" },
    "price": { "amount": 850000, "currency": "USD" }
  },
  "timeline": [
    {
      "event_type": "match.created",
      "created_at": "2024-12-05T10:00:00.000Z",
      "payload_hash": "hash1",
      "previous_event_hash": null
    },
    {
      "event_type": "intent.confirmed", 
      "created_at": "2024-12-06T12:00:00.000Z",
      "payload_hash": "hash2",
      "previous_event_hash": "hash1"
    }
  ],
  "hash_chain_verification": {
    "valid": true,
    "events_verified": 2
  },
  "verification": {
    "can_verify_at": "https://api.trade.izenzo.co.za/verify",
    "instructions": "Submit the match hash to independently verify this record"
  }
}`} />
                </div>

                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    The hash chain provides tamper-evident proof. Each event's hash includes 
                    the previous event's hash, creating an immutable timeline that can be 
                    tamper-proofally verified.
                  </AlertDescription>
                </Alert>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

      </div>
    </PublicPageLayout>
  );
}
